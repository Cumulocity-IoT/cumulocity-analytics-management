import { Injectable, OnDestroy } from '@angular/core';
import {
  ApplicationService,
  FetchClient,
  IManagedObject,
  InventoryService,
  Realtime
} from '@c8y/client';
import { gettext } from '@c8y/ngx-components/gettext';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import {
  APPLICATION_ANALYTICS_BUILDER_SERVICE,
  BACKEND_PATH_BASE,
  CEP_ENDPOINT,
  CEP_PATH_STATUS,
  CepStatusObject
} from './analytics.model';
import { CepError, fetchCepJSON } from './cep-error';
import { CepRestartService } from './cep-restart.service';

/**
 * Owns the CEP/Apama operation-object realtime stream, its derived status,
 * backend-microservice availability, and the restart trigger itself. Every
 * other Cep-related service that needs "is the engine up?" or "what's its
 * operation object id?" goes through here.
 */
@Injectable({ providedIn: 'root' })
export class CepStatusService implements OnDestroy {
  readonly cepOperationObjectStream$ = new ReplaySubject<IManagedObject>(1);

  private cachedCepOperationObjectId: Promise<string | undefined> | null = null;
  private cachedCepStatus: Promise<CepStatusObject> | null = null;
  private cachedBackendAvailability: Promise<boolean> | null = null;

  private readonly realtime: Realtime;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly fetchClient: FetchClient,
    private readonly applicationService: ApplicationService,
    private readonly cepRestartService: CepRestartService
  ) {
    this.realtime = new Realtime(this.fetchClient);
    this.initializeMonitoring();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Clears the caches invalidated by a generic "reload everything" request. */
  clearCache(): void {
    this.cachedCepOperationObjectId = null;
    this.cachedCepStatus = null;
    // Don't clear backend availability cache as it rarely changes
  }

  getCepOperationObjectStream$(): Observable<IManagedObject> {
    return this.cepOperationObjectStream$.asObservable();
  }

  async reinitializeMonitoring(): Promise<void> {
    try {
      await this.subscribeToOperationObjectUpdates();
    } catch (error) {
      this.handleError(error, 'Failed to reinitialize monitoring', false);
    }
  }

  async getCepStatus(): Promise<CepStatusObject> {
    if (!this.cachedCepStatus) {
      this.cachedCepStatus = this.loadCepStatus().catch(error => {
        this.cachedCepStatus = null;
        throw this.handleError(error, 'Failed to get Cep status', false);
      });
    }
    return this.cachedCepStatus;
  }

  private async loadCepStatus(): Promise<CepStatusObject> {
    return fetchCepJSON<CepStatusObject>(this.fetchClient, await this.resolveCepStatusUrl());
  }

  /**
   * Resolve which endpoint serves CEP status / operation-object data.
   *
   * Path selection across this service follows one rule: status and
   * operation-object reads go through the backend microservice when it is
   * deployed, and fall back to the CEP correlator diagnostics endpoints when it
   * is not.
   */
  private async resolveCepStatusUrl(): Promise<string> {
    const isBackendAvailable = await this.isBackendServiceAvailable();
    return isBackendAvailable
      ? `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/status`
      : `${CEP_PATH_STATUS}`;
  }

  async restartCepEngine(): Promise<void> {
    this.cepRestartService.beginRestart();
    try {
      await fetchCepJSON(this.fetchClient, '/service/cep/restart', {
        method: 'PUT',
        body: '{}'
      });

      await this.reinitializeMonitoring();

      // The "restarting…" toast from beginRestart() stays visible;
      // handleCepOperationObjectUpdate replaces it with a success toast once
      // the engine reports 'Up' again. No intermediate message in between.
    } catch (error) {
      this.cepRestartService.restartFailed();
      // Alert already surfaced above; just log and propagate.
      throw this.handleError(error, 'Failed to restart Cep engine', false);
    }
  }

  /**
   * Whether the `analytics-service` backend is actually usable right now.
   *
   * `applicationService.isAvailable()` alone is NOT enough — per its own
   * doc comment, it only reports whether the microservice is *subscribed*
   * to the tenant (can the current user see it), not whether it has an
   * actually-running, responding instance. A subscribed-but-not-running
   * microservice still makes every real request 404 with Cumulocity's own
   * routing error ("Microservice ... not found"), which is indistinguishable
   * from a healthy one at the subscription-check level. So: use the
   * subscription check as a fast first filter, then confirm with a real
   * liveness probe against the microservice's own REST surface before
   * reporting it as available. Cached per session (checked once).
   */
  async isBackendServiceAvailable(): Promise<boolean> {
    if (!this.cachedBackendAvailability) {
      this.cachedBackendAvailability = this.checkBackendServiceAvailable().catch(() => {
        // Allow retry on next call
        this.cachedBackendAvailability = null;
        return false;
      });
    }
    return this.cachedBackendAvailability;
  }

  private async checkBackendServiceAvailable(): Promise<boolean> {
    const subscribed = await this.applicationService
      .isAvailable(APPLICATION_ANALYTICS_BUILDER_SERVICE)
      .then(result => result?.data ?? false);
    if (!subscribed) {
      return false;
    }

    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/status`,
        { method: 'GET' }
      );
      // A 404 here is Cumulocity's platform-level "no such microservice
      // instance" routing error, not an application-level status response —
      // analytics-service always returns valid JSON for this endpoint when
      // it's actually running, so any 404 means it isn't.
      return response.status !== 404;
    } catch {
      return false;
    }
  }

  async getCepOperationObjectId(): Promise<string | undefined> {
    if (!this.cachedCepOperationObjectId) {
      this.cachedCepOperationObjectId = this.loadCepOperationObjectId().catch(async error => {
        this.handleError(error, 'Failed to get Cep operation object ID', false);
        // Don't cache failures — clear so a later call can retry
        this.cachedCepOperationObjectId = null;
        const isBackendAvailable = await this.isBackendServiceAvailable();
        if (isBackendAvailable) {
          this.cepRestartService.showCepUnavailableWarning();
        } else {
          this.cepRestartService.showBackendNotDeployedWarning();
        }
        return undefined;
      });
    }
    return this.cachedCepOperationObjectId;
  }

  private async loadCepOperationObjectId(): Promise<string | undefined> {
    const isBackendAvailable = await this.isBackendServiceAvailable();

    let id: string | undefined;
    if (isBackendAvailable) {
      try {
        id = await this.fetchOperationIdFromBackend();
      } catch (error) {
        console.warn(
          '[CepStatusService] fetchOperationIdFromBackend failed, falling back to CEP status endpoint:',
          error
        );
        id = await this.fetchOperationIdFromCepStatus();
      }
    } else {
      id = await this.fetchOperationIdFromCepStatus();
    }

    if (id) return id;

    // Treat missing id as a non-cacheable miss
    this.cachedCepOperationObjectId = null;
    if (isBackendAvailable) {
      this.cepRestartService.showCepUnavailableWarning();
    } else {
      this.cepRestartService.showBackendNotDeployedWarning();
    }
    return undefined;
  }

  private async fetchOperationIdFromBackend(): Promise<string> {
    const url = `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/id`;
    let data: { id?: string };
    try {
      data = await fetchCepJSON<{ id?: string }>(this.fetchClient, url);
    } catch (error) {
      throw new CepError(
        `fetchOperationIdFromBackend: request to ${url} failed — ${error instanceof CepError ? error.message : String(error)}`,
        error instanceof CepError
          ? error.userMessage
          : gettext('Failed to retrieve the Streaming Analytics operation object ID from the backend service.'),
        error instanceof Error ? error : undefined,
        error instanceof CepError ? error.status : undefined
      );
    }

    if (!data?.id) {
      throw new CepError(
        `fetchOperationIdFromBackend: ${url} returned no id (response body: ${JSON.stringify(data)})`,
        gettext('The backend service returned an unexpected response when requesting the Streaming Analytics operation object ID.')
      );
    }

    return data.id;
  }

  private async fetchOperationIdFromCepStatus(): Promise<string> {
    const statusData = await fetchCepJSON<any>(this.fetchClient, `${CEP_PATH_STATUS}`);
    const { microservice_name, microservice_application_id } = statusData;

    const { data } = await this.inventoryService.listQuery(
      { name: microservice_name, applicationId: microservice_application_id },
      { pageSize: 100, withTotalPages: true }
    );

    if (!data || data.length !== 1) {
      throw new CepError(
        'Unexpected ctrl-microservice query result',
        gettext('Could not find Streaming Analytics control microservice.')
      );
    }

    return data[0].id;
  }

  private async initializeMonitoring(): Promise<void> {
    try {
      await this.subscribeToOperationObjectUpdates();
    } catch (error) {
      this.handleError(error, 'Failed to initialize monitoring', false);
    }
  }

  private async subscribeToOperationObjectUpdates(): Promise<any> {
    const operationObjectId = await this.getCepOperationObjectId();

    if (!operationObjectId) {
      return null;
    }

    try {
      const { data } = await this.inventoryService.detail(operationObjectId);
      this.cepOperationObjectStream$.next(data);

      return this.realtime.subscribe(
        `/managedobjects/${operationObjectId}`,
        this.handleCepOperationObjectUpdate.bind(this)
      );
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to subscribe to operation object updates',
        false
      );
    }
  }

  private handleCepOperationObjectUpdate(payload: unknown): void {
    let managedObject: unknown;

    // Navigate nested data structure safely
    if (payload && typeof payload === 'object') {
      const payloadObj = payload as Record<string, unknown>;
      const dataObj = payloadObj['data'] as Record<string, unknown> | undefined;
      managedObject = dataObj?.['data'];
    }

    if (!managedObject) {
      console.warn('Received invalid operation object update:', payload);
      return;
    }

    // Type narrowing for managedObject
    if (typeof managedObject !== 'object' || managedObject === null) {
      console.warn('Received invalid operation object update:', payload);
      return;
    }

    this.cepOperationObjectStream$.next(managedObject as IManagedObject);

    const managedObjTyped = managedObject as Record<string, unknown>;
    const c8yStatus = managedObjTyped['c8y_Status'] as Record<string, unknown> | undefined;
    const rawStatus = c8yStatus?.['status'];
    const isUp = typeof rawStatus === 'string' && rawStatus.toLowerCase() === 'up';

    if (isUp) {
      this.cachedCepStatus = null;
      this.getCepStatus().catch(err =>
        console.warn('Failed to refresh Cep status:', err)
      );
    }

    if (this.cepRestartService.isRestarting()) {
      if (!isUp) {
        // The engine has gone down as part of the restart. Only after we've
        // observed this can a subsequent 'Up' be trusted as "restart complete".
        this.cepRestartService.recordEngineDown();
      } else if (this.cepRestartService.hasSeenEngineDown()) {
        // Genuine down -> up transition: the restart really finished.
        this.cepRestartService.restartSucceeded();
      }
    }
  }

  private handleError(error: unknown, logMessage: string, showAlert: boolean = false): Error {
    // Expected, self-recovering backend conditions (mid-restart, or a transient
    // 502/503/504 because the engine is unreachable / still starting) are kept
    // out of the error stream and don't raise user-facing alerts.
    if (this.cepRestartService.isExpectedTransientError(error)) {
      console.warn(`[CepStatusService] ${logMessage} (transient backend unavailable):`, error);
    } else {
      console.error(`[CepStatusService] ${logMessage}:`, error);
    }

    if (error instanceof CepError) {
      return error;
    }

    return new CepError(
      logMessage,
      error instanceof Error ? error.message : gettext('An unexpected error occurred. Please try again.'),
      error instanceof Error ? error : undefined
    );
  }
}
