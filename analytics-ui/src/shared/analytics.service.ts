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
import { AlertService, gettext } from '@c8y/ngx-components';
import { BehaviorSubject, Observable, ReplaySubject, Subject } from 'rxjs';
import {
  CEP_Block,
  CEP_Extension,
  CEP_ExtensionsMetadata,
  CEP_PATH_EN,
  CEP_PATH_METADATA_EN,
  CEP_PATH_STATUS,
  BACKEND_PATH_BASE,
  APPLICATION_ANALYTICS_BUILDER_SERVICE,
  CEP_METADATA_FILE_EXTENSION_1,
  CEP_ENDPOINT,
  CEPStatusObject,
  UploadMode,
  CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES,
  CEP_METADATA_FILE_EXTENSION_2,
} from './analytics.model';
import { isCustomCEP_Block, removeFileExtension } from './utils';

/**
 * Service for managing Streaming Analytics (CEP) extensions and blocks
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService implements OnDestroy {
  // ============================================================================
  // Public Observables & Events
  // ============================================================================

  /**
   * Emits when an extension is created, updated, or deleted
   */
  readonly extensionChanged$ = new EventEmitter<IManagedObject>();

  /**
   * Upload progress percentage (0-100)
   */
  readonly uploadProgress$ = new BehaviorSubject<number | null>(null);

  /**
   * Stream of CEP operation object updates
   */
  readonly cepOperationObjectStream$ = new ReplaySubject<IManagedObject>(1);

  /**
   * Trigger for external cache reload requests
   */
  readonly cacheReloadRequest$ = new Subject<boolean>();

  // ============================================================================
  // Private State - Cached Promises
  // ============================================================================

  private cachedCepOperationObjectId: Promise<string> | null = null;
  private cachedCepStatus: Promise<CEPStatusObject> | null = null;
  private cachedDeployedBlocks: Promise<CEP_Block[]> | null = null;
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

  /**
   * Trigger a cache reload from external components
   * @param clearCache - Whether to clear all caches before reload
   */
  triggerCacheReload(clearCache: boolean): void {
    this.cacheReloadRequest$.next(clearCache);
  }

  /**
   * Get observable for cache reload requests
   */
  getCacheReloadRequests$(): Observable<boolean> {
    return this.cacheReloadRequest$.asObservable();
  }

  /**
   * Clear all cached data and reinitialize monitoring
   */
  async clearAllCaches(): Promise<void> {
    this.cachedDeployedBlocks = null;
    this.cachedDeployedExtensions = null;
    this.cachedCepOperationObjectId = null;
    this.cachedCepStatus = null;
    // Don't clear backend availability cache
    await this.subscribeToOperationObjectUpdates();
  }

  // ============================================================================
  // Public API - Extensions (Inventory)
  // ============================================================================

  /**
   * Get all extension metadata from Cumulocity inventory
   * @returns Array of extension managed objects
   */
  async getExtensionsFromInventory(): Promise<IManagedObject[]> {
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
  }

  /**
   * Get extensions enriched with deployment status and block counts
   * @returns Extensions with loaded status and block counts
   */
  async getEnrichedExtensions(): Promise<IManagedObject[]> {
    if (!this.cachedDeployedExtensions) {
      const [
        inventoryExtensions,
        deployedExtensionsMetadata,
        diagnosticsExtensions
      ] = await Promise.all([
        this.getExtensionsFromInventory(),
        this.getDeployedExtensionsMetadata(),
        this.getExtensionNamesFromCep()
      ]);

      const enriched = await Promise.all(
        inventoryExtensions.map(ext =>
          this.addDeploymentStatus(ext, deployedExtensionsMetadata, diagnosticsExtensions)
        )
      );

      this.cachedDeployedExtensions = Promise.resolve(enriched);
    }
    return this.cachedDeployedExtensions;
  }

  /**
   * Upload a new extension or update existing one
   */
  async uploadExtension(
    file: File,
    extension: IManagedObject,
    mode: UploadMode
  ): Promise<IManagedObjectBinary | null> {
    try {
      const extensionToCreate = mode === 'update'
        ? await this.prepareExtensionForUpdate(extension)
        : extension;

      const result = await this.inventoryBinaryService.create(file, extensionToCreate);

      if (!result.res.ok) {
        this.alertService.warning(`Could not upload ${extension.name}`);
        return null;
      }

      this.invalidateExtensionCaches();
      this.alertService.success(`Extension ${extension.name} uploaded successfully`);
      this.extensionChanged$.emit(result.data as IManagedObject);

      return result.data;
    } catch (error) {
      console.error(`Failed to upload extension ${extension.name}:`, error);
      this.alertService.danger(`Error uploading extension: ${error.message}`);
      return null;
    }
  }

  /**
   * Delete an extension from inventory
   */
  async deleteExtension(
    extension: IManagedObject,
    showSuccessMessage: boolean = true
  ): Promise<IResult<null>> {
    try {
      const result = await this.inventoryBinaryService.delete(extension.id);

      this.invalidateExtensionCaches();

      if (showSuccessMessage) {
        this.alertService.success(gettext('Extension deleted.'));
      }

      this.extensionChanged$.emit(extension);
      return result;
    } catch (error) {
      this.alertService.danger(gettext('Failed to delete extension.'));
      throw error;
    }
  }

  /**
   * Download an extension as ArrayBuffer
   */
  async downloadExtension(extension: IManagedObject): Promise<ArrayBuffer> {
    try {
      const response = await this.inventoryBinaryService.download(extension);
      return await response.arrayBuffer();
    } catch (error) {
      console.error(`Failed to download extension ${extension.name}:`, error);
      this.alertService.danger(`Failed to download extension: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cancel extension creation (cleanup)
   */
  cancelExtensionCreation(extension: Partial<IManagedObject>): void {
    if (extension?.id) {
      this.inventoryBinaryService.delete(extension);
    }
  }

  /**
   * Update upload progress (for progress bar)
   */
  updateUploadProgress(event: ProgressEvent): void {
    if (event.lengthComputable) {
      const currentProgress = this.uploadProgress$.value || 0;
      const newProgress = currentProgress + (event.loaded / event.total) * (95 - currentProgress);
      this.uploadProgress$.next(newProgress);
    }
  }

  // ============================================================================
  // Public API - Blocks (CEP Deployed)
  // ============================================================================

  /**
   * Get all blocks currently deployed in CEP engine
   * @returns Array of deployed blocks with metadata
   */
  async getDeployedBlocks(): Promise<CEP_Block[]> {
    if (!this.cachedDeployedBlocks) {
      try {
        const metadata = await this.getDeployedExtensionsMetadata();

        if (!metadata?.metadatas?.length) {
          this.cachedDeployedBlocks = Promise.resolve([]);
          return [];
        }

        const extensions = await Promise.all(
          metadata.metadatas.map(async (metadataFile) => {
            const extensionName = removeFileExtension(metadataFile);
            return this.getDeployedExtensionDetails(extensionName);
          })
        );

        const blocks = extensions
          .filter(ext => ext?.analytics)
          .flatMap(ext =>
            ext.analytics.map(block => this.addBlockMetadata(block, ext.name))
          );

        this.cachedDeployedBlocks = Promise.resolve(blocks);
      } catch (error) {
        console.error('Failed to load deployed blocks:', error);
        this.cachedDeployedBlocks = null;
        throw error;
      }
    }

    return this.cachedDeployedBlocks;
  }


  // ============================================================================
  // Public API - CEP Status & Control
  // ============================================================================

  /**
   * Get CEP engine status
   */
  async getCepStatus(): Promise<CEPStatusObject> {
    if (this.cachedCepStatus) {
      return this.cachedCepStatus;
    }

    try {
      const isBackendAvailable = await this.isBackendServiceAvailable();
      const url = isBackendAvailable
        ? `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/status`
        : `${CEP_PATH_STATUS}`;

      const status = await this.fetchJSON<CEPStatusObject>(url);
      this.cachedCepStatus = Promise.resolve(status);
      return status;
    } catch (error) {
      console.error('Failed to get CEP status:', error);
      throw error;
    }
  }

  /**
   * Get observable stream of CEP operation object updates
   */
  getCepOperationObjectStream$(): Observable<IManagedObject> {
    return this.cepOperationObjectStream$.asObservable();
  }

  /**
   * Restart the CEP engine
   */
  async restartCepEngine(): Promise<void> {
    const url = '/service/cep/restart';

    try {
      await this.fetchJSON(url, {
        method: 'PUT',
        body: '{}'
      });

      this.alertService.success(gettext('CEP restart initiated'));
      await this.clearAllCaches();
    } catch (error) {
      console.error('Failed to restart CEP:', error);
      this.alertService.danger(gettext('Failed to restart CEP. Please try again.'));
      throw error;
    }
  }

  /**
   * Check if backend analytics service is available
   */
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
      console.error('Failed to check backend service availability:', error);
      return false;
    }
  }

  // ============================================================================
  // Public API - CEP Metadata (Read-only)
  // ============================================================================

  /**
   * Get metadata of all deployed extensions from CEP
   */
  async getDeployedExtensionsMetadata(): Promise<CEP_ExtensionsMetadata> {
    return this.fetchJSON<CEP_ExtensionsMetadata>(`/${CEP_PATH_METADATA_EN}`);
  }

  /**
   * Get extension names from CEP diagnostics
   */
  async getExtensionNamesFromCep(): Promise<CEP_ExtensionsMetadata> {
    return this.fetchJSON<CEP_ExtensionsMetadata>(`/${CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES}`);
  }

  /**
   * Get detailed information about a deployed extension
   * @param extensionName - Name of the extension (without file extension)
   */
  async getDeployedExtensionDetails(extensionName: string): Promise<CEP_Extension | null> {
    try {
      const data = await this.fetchJSON<CEP_Extension>(`${CEP_PATH_EN}/${extensionName}.json`);
      return { ...data, name: extensionName };
    } catch (error) {
      console.warn(`Failed to get extension details for ${extensionName}:`, error);
      return null;
    }
  }

  public async getCepOperationObjectId(): Promise<string | undefined> {
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
    } catch (error) {
      console.error('Failed to get CEP operation object ID:', error);
    }

    this.showCepUnavailableWarning(await this.isBackendServiceAvailable());
    return undefined;
  }

  // ============================================================================
  // Private Methods - Initialization
  // ============================================================================

  private async initializeMonitoring(): Promise<void> {
    try {
      await this.subscribeToOperationObjectUpdates();
    } catch (error) {
      console.error('Failed to initialize monitoring:', error);
    }
  }

  // ============================================================================
  // Private Methods - Extension Enrichment
  // ============================================================================

  /**
   * Add deployment status and block count to extension
   */
  private async addDeploymentStatus(
    extension: IManagedObject,
    deployedMetadata: CEP_ExtensionsMetadata,
    diagnostics: CEP_ExtensionsMetadata
  ): Promise<IManagedObject> {
    const cleanName = removeFileExtension(extension.name);
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

  /**
   * Add metadata to a block (extension name, custom flag)
   */
  private addBlockMetadata(block: any, extensionName: string): CEP_Block {
    return {
      ...block,
      custom: isCustomCEP_Block(block),
      extension: extensionName
    } as CEP_Block;
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
  // Private Methods - CEP Operation Object
  // ============================================================================


  private async fetchOperationIdFromBackend(): Promise<string> {
    const data = await this.fetchJSON<{ id: string }>(
      `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/id`
    );
    return data.id;
  }

  private async fetchOperationIdFromCepStatus(): Promise<string | undefined> {
    const statusData = await this.fetchJSON<any>(`${CEP_PATH_STATUS}`);
    const { microservice_name, microservice_application_id } = statusData;

    const { data } = await this.inventoryService.listQuery(
      { name: microservice_name, applicationId: microservice_application_id },
      { pageSize: 100, withTotalPages: true }
    );

    if (!data || data.length !== 1) {
      console.error('Unexpected ctrl-microservice query result:', statusData, data);
      throw new Error('Could not find unique ctrl-microservice for Streaming Analytics');
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

    const { data } = await this.inventoryService.detail(operationObjectId);
    this.cepOperationObjectStream$.next(data);

    return this.realtime.subscribe(
      `/managedobjects/${operationObjectId}`,
      this.handleCepOperationObjectUpdate.bind(this)
    );
  }

  private handleCepOperationObjectUpdate(payload: any): void {
    const managedObject = payload?.data?.data;

    if (!managedObject) {
      console.warn('Received invalid operation object update:', payload);
      return;
    }

    this.cepOperationObjectStream$.next(managedObject);

    if (managedObject.c8y_Status?.status === 'Up') {
      this.cachedCepStatus = null;
      this.getCepStatus().catch(err =>
        console.error('Failed to refresh CEP status:', err)
      );
    }

    console.log('CEP operation object updated:', managedObject);
  }

  // ============================================================================
  // Private Methods - Warnings
  // ============================================================================

  private showCepUnavailableWarning(isBackendAvailable: boolean): void {
    const message = isBackendAvailable
      ? gettext('Streaming Analytics is restarting. Please retry later...')
      : gettext('The supporting microservice for Analytics Management is not deployed. Not all features are available...');

    this.alertService.warning(message);
  }

  // ============================================================================
  // Private Methods - HTTP
  // ============================================================================

  private async fetchJSON<T>(
    url: string,
    options: Partial<IFetchOptions> = {}
  ): Promise<T> {
    const response = await this.fetchClient.fetch(url, {
      headers: this.JSON_HEADERS,
      method: 'GET',
      ...options
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}