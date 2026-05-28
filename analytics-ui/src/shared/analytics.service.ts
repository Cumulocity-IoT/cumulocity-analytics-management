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

  private cachedCepOperationObjectId: Promise<string> | null = null;
  private cachedCepStatus: Promise<CepStatusObject> | null = null;
  private cachedDeployedBlocks: Promise<CepBlock[]> | null = null;
  private cachedDeployedExtensions: Promise<IManagedObject[]> | null = null;
  private cachedBackendAvailability: Promise<boolean> | null = null;

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
      const filter = {
        pageSize: this.DEFAULT_PAGE_SIZE,
        withTotalPages: true,
        fragmentType: 'pas_extension'
      };

      const { data } = await this.inventoryService.list(filter);

      if (data.length >= this.DEFAULT_PAGE_SIZE) {
        console.warn('Extensions may be paginated. Consider implementing full pagination.');
      }

      return data;
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
    if (this.cachedDeployedExtensions) {
      return this.cachedDeployedExtensions;
    }

    try {
      const [inventoryExtensions, deployedMetadata, diagnostics] = await Promise.all([
        this.getExtensionsFromInventory(),
        this.getDeployedExtensionsMetadata(),
        this.getExtensionNamesFromCep()
      ]);

      const enriched = await Promise.all(
        inventoryExtensions.map(ext =>
          this.addDeploymentStatus(ext, deployedMetadata, diagnostics)
        )
      );

      this.cachedDeployedExtensions = Promise.resolve(enriched);
      return enriched;
    } catch (error) {
      this.cachedDeployedExtensions = null;
      throw this.handleError(
        error,
        'Failed to enrich extensions with deployment status',
        true,
        gettext('Could not load extension details. Please refresh.')
      );
    }
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
          gettext(`Could not upload extension "${extension.name}". Please try again.`)
        );
      }

      this.invalidateExtensionCaches();
      this.extensionChanged$.emit(result.data as IManagedObject);

      return result.data;
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to upload extension ${extension.name}`,
        true,
        error instanceof CepError 
          ? error.userMessage 
          : gettext(`Error uploading extension "${extension.name}". Please try again.`)
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
        `Failed to delete extension ${extension.name}`,
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
        `Failed to download extension ${extension.name}`,
        true,
        gettext(`Failed to download extension "${extension.name}". Please try again.`)
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
    if (event.lengthComputable) {
      const currentProgress = this.uploadProgress$.value || 0;
      const newProgress = currentProgress + (event.loaded / event.total) * (95 - currentProgress);
      this.uploadProgress$.next(newProgress);
    }
  }

  // ============================================================================
  // Public API - Blocks (Cep Deployed)
  // ============================================================================

  async getDeployedBlocks(): Promise<CepBlock[]> {
    if (this.cachedDeployedBlocks) {
      return this.cachedDeployedBlocks;
    }

    try {
      const metadata = await this.getDeployedExtensionsMetadata();

      if (!metadata?.metadatas?.length) {
        this.cachedDeployedBlocks = Promise.resolve([]);
        return [];
      }

      const extensions = await Promise.all(
        metadata.metadatas.map(async (metadataFile) => {
          const extensionName = removeFileExtension(metadataFile);
          const ext = await this.getDeployedExtensionDetails(extensionName);
          if (ext && ext.analytics) {
            return ext.analytics.map(block => this.addBlockMetadata(block, ext.name));
          }
          return [];
        })
      );

      const blocks = extensions
        .filter((ext: any) => Array.isArray(ext) && ext.length > 0)
        .flatMap(ext => ext);

      this.cachedDeployedBlocks = Promise.resolve(blocks);
      return blocks;
    } catch (error) {
      this.cachedDeployedBlocks = null;
      throw this.handleError(
        error,
        'Failed to load deployed blocks',
        true,
        gettext('Could not load deployed blocks. Please refresh.')
      );
    }
  }

  // ============================================================================
  // Public API - Cep Status & Control
  // ============================================================================

  async getCepStatus(): Promise<CepStatusObject> {
    if (this.cachedCepStatus) {
      return this.cachedCepStatus;
    }

    try {
      const isBackendAvailable = await this.isBackendServiceAvailable();
      const url = isBackendAvailable
        ? `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/status`
        : `${CEP_PATH_STATUS}`;

      const status = await this.fetchJSON<CepStatusObject>(url);
      this.cachedCepStatus = Promise.resolve(status);
      return status;
    } catch (error) {
      this.cachedCepStatus = null;
      throw this.handleError(
        error,
        'Failed to get Cep status',
        false // Don't show alert, let caller handle
      );
    }
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
    if (this.cachedBackendAvailability) {
      return this.cachedBackendAvailability;
    }

    try {
      const result = await this.applicationService.isAvailable(
        APPLICATION_ANALYTICS_BUILDER_SERVICE
      );

      const isAvailable = result?.data ?? false;
      this.cachedBackendAvailability = Promise.resolve(isAvailable);
      return isAvailable;
    } catch (error) {
      // console.warn('Failed to check backend service availability:', error);
      return false; // Fail gracefully, don't throw
    }
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
    try {
      const data = await this.fetchJSON<CepExtension>(`${CEP_PATH_EN}/${extensionName}.json`);
      return { ...data, name: extensionName };
    } catch (error) {
      console.warn(`Failed to get extension details for ${extensionName}:`, error);
      return null; // Return null instead of throwing for individual extension failures
    }
  }

  async getCepOperationObjectId(): Promise<string | undefined> {
    if (this.cachedCepOperationObjectId) {
      return this.cachedCepOperationObjectId;
    }

    try {
      const isBackendAvailable = await this.isBackendServiceAvailable();
      const id = isBackendAvailable
        ? await this.fetchOperationIdFromBackend()
        : await this.fetchOperationIdFromCepStatus();

      if (id) {
        this.cachedCepOperationObjectId = Promise.resolve(id);
        return id;
      }

      this.showCepUnavailableWarning(isBackendAvailable);
      return undefined;
    } catch (error) {
      this.handleError(error, 'Failed to get Cep operation object ID', false);
      const isBackendAvailable = await this.isBackendServiceAvailable();
      this.showCepUnavailableWarning(isBackendAvailable);
      return undefined;
    }
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
    const cleanName = extension.name;
    const metadataKey = cleanName + CEP_METADATA_FILE_EXTENSION_1;
    const diagnosticsKey = cleanName + CEP_METADATA_FILE_EXTENSION_2;

    const isDeployedViaMetadata = deployedMetadata?.metadatas?.some(
      name => metadataKey.includes(name)
    );
    const isDeployedViaDiagnostics = diagnostics?.hasOwnProperty(diagnosticsKey);
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
      repositoryId: blockObj.repositoryId || ''
    };
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
      name: extension.name,
      pas_extension: extension.name
    };
  }

  // ============================================================================
  // Private Methods - Cache Management
  // ============================================================================

  private invalidateExtensionCaches(): void {
    this.cachedDeployedExtensions = null;
    this.cachedDeployedBlocks = null;
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
      const dataObj = payloadObj.data as Record<string, unknown> | undefined;
      managedObject = dataObj?.data;
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
    const c8yStatus = managedObjTyped.c8y_Status as Record<string, unknown> | undefined;
    if (c8yStatus?.status === 'Up') {
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
      const message = errorObj.message;
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