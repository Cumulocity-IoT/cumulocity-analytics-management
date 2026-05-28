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
import { AlertService } from '@c8y/ngx-components';
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
    public readonly originalError?: Error
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

  // ============================================================================
  // Private State - Cached Promises
  // ============================================================================

  private cachedCepOperationObjectId: Promise<string | undefined> | null = null;
  private cachedCepStatus: Promise<CepStatusObject> | null = null;
  private cachedDeployedBlocks: Promise<CepBlock[]> | null = null;
  private cachedDeployedExtensions: Promise<IManagedObject[]> | null = null;
  private cachedBackendAvailability: Promise<boolean> | null = null;
  private cachedExtensionDetails = new Map<string, Promise<CepExtension | null>>();

  // ============================================================================
  // Private Dependencies
  // ============================================================================

  private readonly realtime: Realtime;
  private readonly destroy$ = new Subject<void>();

  // ============================================================================
  // Constants
  // ============================================================================

  private readonly DEFAULT_PAGE_SIZE = 100;
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
  }

  // ============================================================================
  // Public API - Cache Management
  // ============================================================================

  triggerCacheReload(clearCache: boolean): void {
    this.cacheReloadRequest$.next(clearCache);
  }

  getCacheReloadRequests$(): Observable<boolean> {
    return this.cacheReloadRequest$.asObservable();
  }

  clearAllCaches(): void {
    this.cachedDeployedBlocks = null;
    this.cachedDeployedExtensions = null;
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
    if (!this.cachedDeployedExtensions) {
      this.cachedDeployedExtensions = this.loadEnrichedExtensions().catch(error => {
        this.cachedDeployedExtensions = null;
        throw this.handleError(
          error,
          'Failed to enrich extensions with deployment status',
          true,
          gettext('Could not load extension details. Please refresh.')
        );
      });
    }
    return this.cachedDeployedExtensions;
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
    if (!this.cachedDeployedBlocks) {
      this.cachedDeployedBlocks = this.loadDeployedBlocks().catch(error => {
        this.cachedDeployedBlocks = null;
        throw this.handleError(
          error,
          'Failed to load deployed blocks',
          true,
          gettext('Could not load deployed blocks. Please refresh.')
        );
      });
    }
    return this.cachedDeployedBlocks;
  }

  private async loadDeployedBlocks(): Promise<CepBlock[]> {
    const metadata = await this.getDeployedExtensionsMetadata();
    if (!metadata?.metadatas?.length) return [];

    const perExtensionBlocks = await Promise.all(
      metadata.metadatas.map(async (metadataFile) => {
        const extensionName = removeFileExtension(metadataFile);
        // Shares the per-name memo with addDeploymentStatus — no duplicate HTTP fetch
        const ext = await this.getDeployedExtensionDetails(extensionName);
        if (!ext?.analytics?.length) return [];
        return ext.analytics.map(block => this.addBlockMetadata(block, ext.name));
      })
    );

    return perExtensionBlocks.flat();
  }

  // ============================================================================
  // Public API - Cep Status & Control
  // ============================================================================

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
    const isBackendAvailable = await this.isBackendServiceAvailable();
    const url = isBackendAvailable
      ? `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/status`
      : `${CEP_PATH_STATUS}`;
    return this.fetchJSON<CepStatusObject>(url);
  }

  getCepOperationObjectStream$(): Observable<IManagedObject> {
    return this.cepOperationObjectStream$.asObservable();
  }

  async restartCepEngine(): Promise<void> {
    try {
      await this.fetchJSON('/service/cep/restart', {
        method: 'PUT',
        body: '{}'
      });

      this.clearAllCaches();
      await this.reinitializeMonitoring();
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to restart Cep engine',
        true,
        gettext('Failed to restart Streaming Analytics. Please try again.')
      );
    }
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
    try {
      return await this.fetchJSON<CepExtensionsMetadata>(`/${CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES}`);
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to get extension names from Cep',
        false
      );
    }
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

  private addBlockMetadata(block: unknown, extensionName: string): CepBlock {
    // Ensure block is an object with required CepBlock properties
    if (!block || typeof block !== 'object') {
      throw new Error('Invalid block object');
    }
    
    const blockObj = block as Partial<CepBlock>;
    return {
      id: blockObj.id || '',
      name: blockObj.name || '',
      file: blockObj.file || '',
      type: blockObj.type || '',
      installed: blockObj.installed,
      producesOutput: blockObj.producesOutput,
      description: blockObj.description,
      url: blockObj.url || '',
      downloadUrl: blockObj.downloadUrl || '',
      path: blockObj.path,
      custom: isCustomCepBlock(blockObj as CepBlock),
      extension: extensionName,
      resultingExtension: blockObj.resultingExtension,
      repositoryName: blockObj.repositoryName || '',
      repositoryId: blockObj.repositoryId || '',
      category: blockObj.category || this.determineBlockCategory(blockObj)
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
    try {
      return await this.fetchJSON<CepExtensionsMetadata>(`/${CEP_PATH_METADATA_EN}`);
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to get deployed extensions metadata',
        false
      );
    }
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
    if (c8yStatus?.['status'] === 'Up') {
      this.cachedCepStatus = null;
      this.getCepStatus().catch(err =>
        console.warn('Failed to refresh Cep status:', err)
      );
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
    // Log to console
    console.error(`[AnalyticsService] ${logMessage}:`, error);

    // Show user alert if requested
    if (showAlert) {
      const message = userMessage || this.getErrorMessage(error);
      this.alertService.danger(message);
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
    const message = isBackendAvailable
      ? gettext('Streaming Analytics is restarting. Please retry later.')
      : gettext('The supporting microservice for Analytics Management is not deployed. Some features may be unavailable.');

    this.alertService.warning(message);
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
          gettext(`Network request failed (${response.status}). Please check your connection and try again.`)
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