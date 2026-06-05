import { EventEmitter, Injectable, OnDestroy } from '@angular/core';
import {
  ApplicationService,
  FetchClient,
  IFetchOptions,
  IManagedObject,
  IManagedObjectBinary,
  InventoryBinaryService,
  InventoryService,
  IResult,
  Realtime,
} from '@c8y/client';
import { Alert, AlertService, AlertType } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import { BehaviorSubject, Observable, ReplaySubject, Subject } from 'rxjs';
import {
  APPLICATION_ANALYTICS_BUILDER_SERVICE,
  BACKEND_PATH_BASE,
  Category,
  CepBlock,
  CEP_ENDPOINT,
  CepExtension,
  CepExtensionsMetadata,
  CEP_METADATA_FILE_EXTENSION_1,
  CEP_METADATA_FILE_EXTENSION_2,
  CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES,
  CEP_PATH_EN,
  CEP_PATH_METADATA_EN,
  CEP_PATH_STATUS,
  CepStatusObject,
  RawCepBlock,
  UploadMode,
} from './analytics.model';
import { isCustomCepBlock, removeFileExtension } from './utils';

/**
 * Custom error class for Cep-related errors
 */
class CepError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly originalError?: Error,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'CepError';
  }
}

/**
 * Service for managing Streaming Analytics (Cep) extensions and blocks
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService implements OnDestroy {
  // ============================================================================
  // Public Observables & Events
  // ============================================================================

  readonly extensionChanged$ = new EventEmitter<IManagedObject>();
  readonly uploadProgress$ = new BehaviorSubject<number | null>(null);
  readonly cepOperationObjectStream$ = new ReplaySubject<IManagedObject>(1);
  readonly cacheReloadRequest$ = new Subject<boolean>();
  /** Emits true while a CEP/Apama restart is known to be in progress. */
  readonly restarting$ = new BehaviorSubject<boolean>(false);

  // ============================================================================
  // Private State - Cached Promises
  // ============================================================================

  private cachedCepOperationObjectId: Promise<string | undefined> | null = null;
  private cachedCepStatus: Promise<CepStatusObject> | null = null;
  private cachedDeployedBlocks: Promise<CepBlock[]> | null = null;
  private cachedDeployedExtensions: Promise<IManagedObject[]> | null = null;
  private cachedDeployedExtensionsMetadata: Promise<CepExtensionsMetadata> | null = null;
  private cachedExtensionNames: Promise<CepExtensionsMetadata> | null = null;
  private cachedBackendAvailability: Promise<boolean> | null = null;
  private cachedExtensionDetails = new Map<string, Promise<CepExtension | null>>();

  // The single, self-replacing toast used for CEP lifecycle/availability status.
  // Keeping a reference lets us update the status in place instead of stacking
  // a new toast for every phase (restarting -> in progress -> done/failed).
  private cepStatusAlert: Alert | null = null;
  private restartSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  // Wall-clock time until which restart-related transient errors are suppressed.
  private suppressErrorsUntil = 0;
  // Whether the engine has been observed going down since the restart began.
  // Guards against treating the stale pre-restart 'Up' event as completion.
  private restartSawEngineDown = false;

  // ============================================================================
  // Private Dependencies
  // ============================================================================

  private readonly realtime: Realtime;
  private readonly destroy$ = new Subject<void>();

  // ============================================================================
  // Constants
  // ============================================================================

  private readonly DEFAULT_PAGE_SIZE = 100;
  // Auto-dismiss timeout (ms) for transient CEP warning/error toasts.
  private readonly ERROR_TIMEOUT = 8000;
  // Safety net: clear the "restarting" state even if no 'Up' event arrives.
  private readonly RESTART_MAX_DURATION = 90000;
  // Keep suppressing transient errors for a moment after a restart finishes:
  // late 500/502 responses from in-flight status polls can still land.
  private readonly RESTART_GRACE_PERIOD = 10000;
  // Gateway statuses meaning "engine unreachable / still starting" — transient,
  // self-recovering, and not worth alarming the user over.
  private readonly TRANSIENT_GATEWAY_STATUSES = new Set([502, 503, 504]);
  private readonly JSON_HEADERS = {
    accept: 'application/json',
    'content-type': 'application/json'
  };

  constructor(
    private readonly alertService: AlertService,
    private readonly inventoryService: InventoryService,
    private readonly inventoryBinaryService: InventoryBinaryService,
    private readonly fetchClient: FetchClient,
    private readonly applicationService: ApplicationService,
  ) {
    this.realtime = new Realtime(this.fetchClient);
    this.initializeMonitoring();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.restartSafetyTimer) {
      clearTimeout(this.restartSafetyTimer);
      this.restartSafetyTimer = null;
    }
  }

  // ============================================================================
  // Public API - Cache Management
  // ============================================================================

  /**
   * Memoize an in-flight/resolved promise in a single-slot cache, evicting the
   * slot on failure so the next call retries. Concurrent callers share the same
   * in-flight promise. `onError` maps/handles the rejection and the returned (or
   * rethrown) error propagates to every awaiter.
   *
   * Only used by getters that reject on failure. The recovering getters
   * (`getCepOperationObjectId`, `isBackendServiceAvailable`) resolve to a
   * fallback value instead of rejecting, so they keep their bespoke caching.
   */
  private memoizeOnce<T>(
    get: () => Promise<T> | null,
    set: (value: Promise<T> | null) => void,
    loader: () => Promise<T>,
    onError: (error: unknown) => Error
  ): Promise<T> {
    const existing = get();
    if (existing) return existing;

    const created = loader().catch(error => {
      set(null);
      throw onError(error);
    });
    set(created);
    return created;
  }

  triggerCacheReload(clearCache: boolean): void {
    this.cacheReloadRequest$.next(clearCache);
  }

  getCacheReloadRequests$(): Observable<boolean> {
    return this.cacheReloadRequest$.asObservable();
  }

  /** Whether a CEP/Apama restart is currently known to be in progress. */
  isRestarting(): boolean {
    return this.restarting$.value;
  }

  clearAllCaches(): void {
    this.cachedDeployedBlocks = null;
    this.cachedDeployedExtensions = null;
    this.cachedDeployedExtensionsMetadata = null;
    this.cachedExtensionNames = null;
    this.cachedCepOperationObjectId = null;
    this.cachedCepStatus = null;
    this.cachedExtensionDetails.clear();
    // Don't clear backend availability cache as it rarely changes
  }

  async reinitializeMonitoring(): Promise<void> {
    try {
      await this.subscribeToOperationObjectUpdates();
    } catch (error) {
      this.handleError(error, 'Failed to reinitialize monitoring', false);
    }
  }

  // ============================================================================
  // Public API - Extensions (Inventory)
  // ============================================================================

  async getExtensionsFromInventory(): Promise<IManagedObject[]> {
    try {
      const all: IManagedObject[] = [];
      let currentPage = 1;

      while (true) {
        const { data, paging } = await this.inventoryService.list({
          pageSize: this.DEFAULT_PAGE_SIZE,
          withTotalPages: true,
          fragmentType: 'pas_extension',
          currentPage
        });

        all.push(...data);

        // Stop when the server indicates no further page, or when a short page comes back
        if (!paging?.nextPage || data.length < this.DEFAULT_PAGE_SIZE) break;
        currentPage++;
      }

      return all;
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to fetch extensions from inventory',
        true,
        gettext('Could not load extensions. Please try again.')
      );
    }
  }

  async getEnrichedExtensions(): Promise<IManagedObject[]> {
    return this.memoizeOnce(
      () => this.cachedDeployedExtensions,
      value => (this.cachedDeployedExtensions = value),
      () => this.loadEnrichedExtensions(),
      // Don't surface a toast here: the caller (extension grid) owns a single,
      // restart-aware, auto-dismissing message so we don't stack two alerts
      // for one failure.
      error => this.handleError(error, 'Failed to enrich extensions with deployment status', false)
    );
  }

  private async loadEnrichedExtensions(): Promise<IManagedObject[]> {
    const [inventoryExtensions, deployedMetadata, diagnostics] = await Promise.all([
      this.getExtensionsFromInventory(),
      this.getDeployedExtensionsMetadata(),
      this.getExtensionNamesFromCep()
    ]);

    return Promise.all(
      inventoryExtensions.map(ext =>
        this.addDeploymentStatus(ext, deployedMetadata, diagnostics)
      )
    );
  }

  async uploadExtension(
    file: File,
    extension: IManagedObject,
    mode: UploadMode
  ): Promise<IManagedObjectBinary> {
    try {
      const extensionToCreate = mode === 'update'
        ? await this.prepareExtensionForUpdate(extension)
        : extension;

      const result = await this.inventoryBinaryService.create(file, extensionToCreate);

      if (!result.res.ok) {
        throw new CepError(
          `Upload failed with status ${result.res.status}`,
          gettext(`Could not upload extension "${extension['name']}". Please try again.`)
        );
      }

      this.invalidateExtensionCaches();
      this.extensionChanged$.emit(result.data as IManagedObject);

      return result.data;
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to upload extension ${extension['name']}`,
        true,
        error instanceof CepError 
          ? error.userMessage 
          : gettext(`Error uploading extension "${extension['name']}". Please try again.`)
      );
    }
  }

  async deleteExtension(
    extension: IManagedObject,
    showSuccessMessage: boolean = true
  ): Promise<IResult<null>> {
    try {
      const result = await this.inventoryBinaryService.delete(extension.id);

      this.invalidateExtensionCaches();

      if (showSuccessMessage) {
        this.alertService.success(gettext('Extension deleted successfully.'));
      }

      this.extensionChanged$.emit(extension);
      return result;
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to delete extension ${extension['name']}`,
        true,
        gettext('Failed to delete extension. Please try again.')
      );
    }
  }

  async downloadExtension(extension: IManagedObject): Promise<ArrayBuffer> {
    try {
      const response = await this.inventoryBinaryService.download(extension);
      return await response.arrayBuffer();
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to download extension ${extension['name']}`,
        true,
        gettext(`Failed to download extension "${extension['name']}". Please try again.`)
      );
    }
  }

  cancelExtensionCreation(extension: Partial<IManagedObject>): void {
    if (extension?.id) {
      this.inventoryBinaryService.delete(extension).catch(error => {
        console.warn('Failed to cleanup extension:', error);
      });
    }
  }

  updateUploadProgress(event: ProgressEvent): void {
    if (!event.lengthComputable || event.total === 0) return;
    // Cap at 95% so the final 5% can be reserved for server-side processing
    const progress = Math.min(95, (event.loaded / event.total) * 95);
    this.uploadProgress$.next(progress);
  }

  // ============================================================================
  // Public API - Blocks (Cep Deployed)
  // ============================================================================

  async getDeployedBlocks(): Promise<CepBlock[]> {
    return this.memoizeOnce(
      () => this.cachedDeployedBlocks,
      value => (this.cachedDeployedBlocks = value),
      () => this.loadDeployedBlocks(),
      error => this.handleError(
        error,
        'Failed to load deployed blocks',
        true,
        gettext('Could not load deployed blocks. Please refresh.')
      )
    );
  }

  private async loadDeployedBlocks(): Promise<CepBlock[]> {
    const metadata = await this.getDeployedExtensionsMetadata();
    if (!metadata?.metadatas?.length) return [];

    // The metadata list can carry both "<name>.json" and "<name>.zip" entries
    // for the same extension; collapse them so each extension is fetched and
    // mapped once (otherwise its blocks would appear twice).
    const extensionNames = [...new Set(metadata.metadatas.map(removeFileExtension))];

    const perExtensionBlocks = await Promise.all(
      extensionNames.map(async (extensionName) => {
        // Shares the per-name memo with addDeploymentStatus — no duplicate HTTP fetch
        const ext = await this.getDeployedExtensionDetails(extensionName);
        if (!ext?.analytics?.length) return [];
        // Drop malformed blocks instead of failing the whole load.
        return ext.analytics
          .map(block => this.addBlockMetadata(block, ext.name))
          .filter((block): block is CepBlock => block !== null);
      })
    );

    return perExtensionBlocks.flat();
  }

  // ============================================================================
  // Public API - Cep Status & Control
  // ============================================================================

  async getCepStatus(): Promise<CepStatusObject> {
    return this.memoizeOnce(
      () => this.cachedCepStatus,
      value => (this.cachedCepStatus = value),
      () => this.loadCepStatus(),
      error => this.handleError(error, 'Failed to get Cep status', false)
    );
  }

  private async loadCepStatus(): Promise<CepStatusObject> {
    return this.fetchJSON<CepStatusObject>(await this.resolveCepStatusUrl());
  }

  /**
   * Resolve which endpoint serves CEP status / operation-object data.
   *
   * Path selection across this service follows one rule: status and
   * operation-object reads go through the backend microservice when it is
   * deployed, and fall back to the CEP correlator diagnostics endpoints when it
   * is not. (Deployed-block and extension-metadata reads, by contrast, always
   * hit the CEP correlator directly — they have no backend equivalent.)
   */
  private async resolveCepStatusUrl(): Promise<string> {
    const isBackendAvailable = await this.isBackendServiceAvailable();
    return isBackendAvailable
      ? `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/status`
      : `${CEP_PATH_STATUS}`;
  }

  getCepOperationObjectStream$(): Observable<IManagedObject> {
    return this.cepOperationObjectStream$.asObservable();
  }

  async restartCepEngine(): Promise<void> {
    this.beginRestart();
    try {
      await this.fetchJSON('/service/cep/restart', {
        method: 'PUT',
        body: '{}'
      });

      this.clearAllCaches();
      await this.reinitializeMonitoring();

      // The "restarting…" toast from beginRestart() stays visible;
      // handleCepOperationObjectUpdate replaces it with a success toast once
      // the engine reports 'Up' again. No intermediate message in between.
    } catch (error) {
      this.endRestart();
      this.setCepStatusAlert(
        gettext('Failed to restart Streaming Analytics. Please try again.'),
        'danger',
        this.ERROR_TIMEOUT
      );
      // Alert already surfaced above; just log and propagate.
      throw this.handleError(error, 'Failed to restart Cep engine', false);
    }
  }

  private beginRestart(): void {
    this.restarting$.next(true);
    // Reset down-detection: we must see the engine actually go down before a
    // later 'Up' counts as the restart completing.
    this.restartSawEngineDown = false;
    // A single, persistent "in progress" toast that stays until the engine
    // reports 'Up' (replaced by a success toast) — no intermediate messages.
    this.setCepStatusAlert(
      gettext('Streaming Analytics is restarting. This may take a moment.'),
      'info'
    );

    // Safety net: if the engine never reports 'Up' (e.g. realtime update missed),
    // drop out of the restarting state and clear the lingering toast so it
    // doesn't hang forever.
    if (this.restartSafetyTimer) {
      clearTimeout(this.restartSafetyTimer);
    }
    this.restartSafetyTimer = setTimeout(() => {
      this.endRestart();
      if (this.cepStatusAlert) {
        this.alertService.remove(this.cepStatusAlert);
        this.cepStatusAlert = null;
      }
    }, this.RESTART_MAX_DURATION);
  }

  private endRestart(): void {
    if (this.restartSafetyTimer) {
      clearTimeout(this.restartSafetyTimer);
      this.restartSafetyTimer = null;
    }
    if (this.restarting$.value) {
      this.restarting$.next(false);
      // Keep suppressing for a short grace period: in-flight status polls that
      // were fired while the engine was down can still resolve with 500/502
      // just after we flip back to "up".
      this.suppressErrorsUntil = Date.now() + this.RESTART_GRACE_PERIOD;
    }
  }

  /**
   * Whether we are in the restart window — actively restarting, or within the
   * grace period right after. Transient backend errors (500/502, missing
   * operation object, unavailable microservice) are expected here and should
   * not raise toasts or console errors.
   */
  isRestartWindow(): boolean {
    return this.isRestarting() || Date.now() < this.suppressErrorsUntil;
  }

  /**
   * Whether an error is an expected, self-recovering backend condition that
   * should be logged quietly without alarming the user: either we are in a
   * restart window, or the engine returned a transient gateway error
   * (502/503/504) because the streaming-analytics microservice is unreachable
   * or still starting up.
   */
  isExpectedTransientError(error: unknown): boolean {
    return this.isRestartWindow() || this.isTransientGatewayError(error);
  }

  private isTransientGatewayError(error: unknown): boolean {
    return error instanceof CepError && this.TRANSIENT_GATEWAY_STATUSES.has(error.status ?? 0);
  }

  async isBackendServiceAvailable(): Promise<boolean> {
    if (!this.cachedBackendAvailability) {
      this.cachedBackendAvailability = this.applicationService
        .isAvailable(APPLICATION_ANALYTICS_BUILDER_SERVICE)
        .then(result => result?.data ?? false)
        .catch(() => {
          // Allow retry on next call
          this.cachedBackendAvailability = null;
          return false;
        });
    }
    return this.cachedBackendAvailability;
  }

  // ============================================================================
  // Public API - Cep Metadata (Read-only)
  // ============================================================================

  async getExtensionNamesFromCep(): Promise<CepExtensionsMetadata> {
    return this.memoizeOnce(
      () => this.cachedExtensionNames,
      value => (this.cachedExtensionNames = value),
      () => this.fetchJSON<CepExtensionsMetadata>(`/${CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES}`),
      error => this.handleError(error, 'Failed to get extension names from Cep', false)
    );
  }

  async getDeployedExtensionDetails(extensionName: string): Promise<CepExtension | null> {
    const cached = this.cachedExtensionDetails.get(extensionName);
    if (cached) return cached;

    const inflight = (async () => {
      try {
        const data = await this.fetchJSON<CepExtension>(`${CEP_PATH_EN}/${extensionName}.json`);
        return { ...data, name: extensionName };
      } catch (error) {
        console.warn(`Failed to get extension details for ${extensionName}:`, error);
        // Evict failed result so a future call can retry
        this.cachedExtensionDetails.delete(extensionName);
        return null;
      }
    })();

    this.cachedExtensionDetails.set(extensionName, inflight);
    return inflight;
  }

  async getCepOperationObjectId(): Promise<string | undefined> {
    if (!this.cachedCepOperationObjectId) {
      this.cachedCepOperationObjectId = this.loadCepOperationObjectId().catch(async error => {
        this.handleError(error, 'Failed to get Cep operation object ID', false);
        // Don't cache failures — clear so a later call can retry
        this.cachedCepOperationObjectId = null;
        const isBackendAvailable = await this.isBackendServiceAvailable();
        this.showCepUnavailableWarning(isBackendAvailable);
        return undefined;
      });
    }
    return this.cachedCepOperationObjectId;
  }

  private async loadCepOperationObjectId(): Promise<string | undefined> {
    const isBackendAvailable = await this.isBackendServiceAvailable();
    const id = isBackendAvailable
      ? await this.fetchOperationIdFromBackend()
      : await this.fetchOperationIdFromCepStatus();

    if (id) return id;

    // Treat missing id as a non-cacheable miss
    this.cachedCepOperationObjectId = null;
    this.showCepUnavailableWarning(isBackendAvailable);
    return undefined;
  }

  // ============================================================================
  // Private Methods - Initialization
  // ============================================================================

  private async initializeMonitoring(): Promise<void> {
    try {
      await this.subscribeToOperationObjectUpdates();
    } catch (error) {
      this.handleError(error, 'Failed to initialize monitoring', false);
    }
  }

  // ============================================================================
  // Private Methods - Extension Enrichment
  // ============================================================================

  private async addDeploymentStatus(
    extension: IManagedObject,
    deployedMetadata: CepExtensionsMetadata,
    diagnostics: CepExtensionsMetadata
  ): Promise<IManagedObject> {
    // Use the name directly - it's already clean (no .zip extension) when stored in inventory
    const cleanName = extension['name'];
    const metadataKey = cleanName + CEP_METADATA_FILE_EXTENSION_1;
    const diagnosticsKey = cleanName + CEP_METADATA_FILE_EXTENSION_2;

    // Direction-agnostic match: handles entries returned as either "foo.json"
    // (exact) or "foo" (extension stripped). Matching only one direction is
    // fragile against API drift; this catches both shapes explicitly.
    const isDeployedViaMetadata = deployedMetadata?.metadatas?.some(
      name => name === metadataKey || removeFileExtension(name) === cleanName
    );
    const isDeployedViaDiagnostics = !!diagnostics && diagnosticsKey in (diagnostics as unknown as Record<string, unknown>);
    const isDeployed = isDeployedViaMetadata || isDeployedViaDiagnostics;

    let blockCount = 0;
    if (isDeployed) {
      const details = await this.getDeployedExtensionDetails(cleanName);
      blockCount = details?.analytics?.length || 0;
    }

    return {
      ...extension,
      name: cleanName,
      loaded: isDeployed,
      extensionType: isDeployedViaDiagnostics ? 'zip' : undefined,
      blocksCount: blockCount
    };
  }

  /**
   * Normalize a raw correlator block into a {@link CepBlock}, or return `null`
   * if it is unusable. A block without an `id` and `name` is meaningless (and
   * would crash `isCustomCepBlock`), so it is skipped rather than defaulted to
   * empty strings. `repositoryName`/`repositoryId` are intentionally omitted:
   * deployed blocks have no originating repository.
   */
  private addBlockMetadata(block: RawCepBlock | null | undefined, extensionName: string): CepBlock | null {
    const id = block?.id?.trim() ?? '';
    const name = block?.name?.trim() ?? '';
    if (!block || typeof block !== 'object' || !id || !name) {
      console.warn('Skipping deployed block with missing id/name:', block);
      return null;
    }

    return {
      id,
      name,
      file: block.file ?? '',
      type: block.type ?? '',
      installed: block.installed,
      producesOutput: block.producesOutput,
      description: block.description,
      url: block.url ?? '',
      downloadUrl: block.downloadUrl ?? '',
      path: block.path,
      custom: isCustomCepBlock({ id }),
      extension: extensionName,
      resultingExtension: block.resultingExtension,
      category: block.category ?? this.determineBlockCategory(block)
    };
  }

  // Order matters: first match wins. UTILITY also serves as the default fallback.
  private static readonly CATEGORY_KEYWORDS: ReadonlyArray<readonly [Category, readonly string[]]> = [
    [Category.INPUT,             ['input', 'trigger', 'measurement', 'event']],
    [Category.OUTPUT,            ['output', 'send', 'http', 'email', 'alarm']],
    [Category.AGGREGATE,         ['sum', 'count', 'average', 'mean', 'aggregate', 'statistics', 'discrete']],
    [Category.CALCULATION,       ['math', 'calculation', 'operation', 'base', 'multiply', 'divide', 'limit']],
    [Category.LOGIC,             ['if', 'compare', 'filter', 'logic', 'condition', 'anomaly']],
    [Category.FLOW_MANIPULATION, ['delay', 'rate', 'throttle', 'flow', 'state']],
    [Category.UTILITY,           ['random', 'generator', 'constant', 'noise', 'walk']],
  ];

  private determineBlockCategory(block: Partial<CepBlock>): Category {
    const text = `${block.name ?? ''} ${block.description ?? ''}`.toLowerCase();
    for (const [category, keywords] of AnalyticsService.CATEGORY_KEYWORDS) {
      if (keywords.some(kw => text.includes(kw))) return category;
    }
    return Category.UTILITY;
  }

  private async getDeployedExtensionsMetadata(): Promise<CepExtensionsMetadata> {
    // Memoized because both loadEnrichedExtensions() and loadDeployedBlocks()
    // need it; without the cache a screen showing both grids fetches
    // block-metadata.json twice.
    return this.memoizeOnce(
      () => this.cachedDeployedExtensionsMetadata,
      value => (this.cachedDeployedExtensionsMetadata = value),
      () => this.fetchJSON<CepExtensionsMetadata>(`/${CEP_PATH_METADATA_EN}`),
      error => this.handleError(error, 'Failed to get deployed extensions metadata', false)
    );
  }

  // ============================================================================
  // Private Methods - Extension Update
  // ============================================================================

  private async prepareExtensionForUpdate(
    extension: IManagedObject
  ): Promise<Partial<IManagedObject>> {
    await this.deleteExtension(extension, false);

    return {
      name: extension['name'],
      pas_extension: extension['name']
    };
  }

  // ============================================================================
  // Private Methods - Cache Management
  // ============================================================================

  private invalidateExtensionCaches(): void {
    this.cachedDeployedExtensions = null;
    this.cachedDeployedBlocks = null;
    this.cachedDeployedExtensionsMetadata = null;
    this.cachedExtensionNames = null;
    this.cachedExtensionDetails.clear();
  }

  // ============================================================================
  // Private Methods - Cep Operation Object
  // ============================================================================

  private async fetchOperationIdFromBackend(): Promise<string> {
    const data = await this.fetchJSON<{ id: string }>(
      `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/id`
    );
    return data.id;
  }

  private async fetchOperationIdFromCepStatus(): Promise<string> {
    const statusData = await this.fetchJSON<any>(`${CEP_PATH_STATUS}`);
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

  // ============================================================================
  // Private Methods - Monitoring
  // ============================================================================

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

    if (this.isRestarting()) {
      if (!isUp) {
        // The engine has gone down as part of the restart. Only after we've
        // observed this can a subsequent 'Up' be trusted as "restart complete".
        this.restartSawEngineDown = true;
      } else if (this.restartSawEngineDown) {
        // Genuine down -> up transition: the restart really finished.
        this.endRestart();
        this.setCepStatusAlert(
          gettext('Streaming Analytics restarted successfully.'),
          'success'
        );
      }
    }
  }

  // ============================================================================
  // Private Methods - Error Handling
  // ============================================================================

  /**
   * Centralized error handling
   * @param error - The error to handle
   * @param logMessage - Message for console logging
   * @param showAlert - Whether to show user alert
   * @param userMessage - Optional custom user message
   * @returns The error (for re-throwing)
   */
  private handleError(
    error: unknown,
    logMessage: string,
    showAlert: boolean = false,
    userMessage?: string
  ): Error {
    // Expected, self-recovering backend conditions (mid-restart, or a transient
    // 502/503/504 because the engine is unreachable / still starting) are kept
    // out of the error stream and don't raise user-facing alerts.
    if (this.isExpectedTransientError(error)) {
      console.warn(`[AnalyticsService] ${logMessage} (transient backend unavailable):`, error);
    } else {
      console.error(`[AnalyticsService] ${logMessage}:`, error);

      // Show user alert if requested
      if (showAlert) {
        const message = userMessage || this.getErrorMessage(error);
        this.alertService.danger(message);
      }
    }

    // Return or create appropriate error
    if (error instanceof CepError) {
      return error;
    }

    return new CepError(
      logMessage,
      userMessage || this.getErrorMessage(error),
      error instanceof Error ? error : undefined
    );
  }

  /**
   * Extract user-friendly error message
   */
  private getErrorMessage(error: unknown): string {
    if (error instanceof CepError) {
      return error.userMessage;
    }

    if (error && typeof error === 'object' && 'message' in error) {
      const errorObj = error as Record<string, unknown>;
      const message = errorObj['message'];
      if (typeof message === 'string') {
        return message;
      }
    }

    return gettext('An unexpected error occurred. Please try again.');
  }

  // ============================================================================
  // Private Methods - Warnings
  // ============================================================================

  private showCepUnavailableWarning(isBackendAvailable: boolean): void {
    // During (and just after) a restart, transient unavailability is expected
    // and the lifecycle toast already covers it. Suppress both the "restarting"
    // and the "not deployed" warnings here — mid-restart the availability probe
    // can briefly report the microservice as down even though it is only
    // restarting, which would otherwise show a misleading "not deployed" toast.
    if (this.isRestartWindow()) {
      return;
    }

    const message = isBackendAvailable
      ? gettext('Streaming Analytics is restarting. Please retry in a moment.')
      : gettext('The supporting microservice for Analytics Management is not deployed. Some features may be unavailable.');

    this.setCepStatusAlert(message, 'warning', this.ERROR_TIMEOUT);
  }

  /**
   * Shows a CEP lifecycle/availability toast in a single, self-replacing slot.
   * Replacing the previous status toast (instead of adding a new one) keeps the
   * user looking at one coherent message that updates in place, and an optional
   * timeout lets transient states clear themselves.
   */
  private setCepStatusAlert(
    text: string,
    type: AlertType,
    timeout = 0
  ): void {
    // Remove the previous status toast; remove() is a no-op if it already
    // auto-dismissed, so this is always safe.
    if (this.cepStatusAlert) {
      this.alertService.remove(this.cepStatusAlert);
    }

    const alert: Alert = timeout ? { text, type, timeout } : { text, type };
    this.alertService.add(alert);
    this.cepStatusAlert = alert;
  }

  // ============================================================================
  // Private Methods - HTTP
  // ============================================================================

  private async fetchJSON<T>(
    url: string,
    options: Partial<IFetchOptions> = {}
  ): Promise<T> {
    try {
      const response = await this.fetchClient.fetch(url, {
        headers: this.JSON_HEADERS,
        method: 'GET',
        ...options
      });

      if (!response.ok) {
        throw new CepError(
          `API call failed: ${response.status} ${response.statusText}`,
          gettext(`Network request failed (${response.status}). Please check your connection and try again.`),
          undefined,
          response.status
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof CepError) {
        throw error;
      }

      throw new CepError(
        `Failed to fetch from ${url}`,
        gettext('Network error. Please check your connection and try again.'),
        error
      );
    }
  }
}