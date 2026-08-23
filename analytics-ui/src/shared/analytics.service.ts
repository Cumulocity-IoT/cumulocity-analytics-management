import { EventEmitter, Injectable } from '@angular/core';
import {
  IManagedObject,
  IManagedObjectBinary,
  IResult,
} from '@c8y/client';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  CepBlock,
  CepExtension,
  CepExtensionsMetadata,
  CepStatusObject,
  UploadMode,
} from './analytics.model';
import { CepRestartService } from './cep-restart.service';
import { CepStatusService } from './cep-status.service';
import { ExtensionEnrichmentService } from './extension-enrichment.service';
import { ExtensionInventoryService } from './extension-inventory.service';

/**
 * Public facade for everything Streaming Analytics (Cep) related. Callers
 * throughout the app only ever depend on this service; it delegates actual
 * work to focused services and owns the few things that are genuinely
 * cross-cutting between them:
 *
 * - `CepRestartService` — the restart lifecycle (single status toast,
 *   down->up detection, the shared "restart window" transient-error grace
 *   period).
 * - `CepStatusService` — the CEP operation-object realtime stream, derived
 *   status, backend-microservice availability, and the restart trigger.
 * - `ExtensionInventoryService` — extension binary CRUD against inventory.
 * - `ExtensionEnrichmentService` — cross-references inventory extensions
 *   against what the CEP correlator has actually deployed (loaded state,
 *   block counts, deployed blocks).
 *
 * `uploadExtension`/`deleteExtension` are the one place this facade does
 * more than delegate: an inventory change must invalidate the enrichment
 * service's caches, and coordinating that here avoids a circular dependency
 * between the two (enrichment already depends on inventory to list
 * extensions).
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  // ============================================================================
  // Public Observables & Events
  // ============================================================================

  readonly extensionChanged$: EventEmitter<IManagedObject>;
  readonly uploadProgress$: BehaviorSubject<number | null>;
  readonly restarting$: BehaviorSubject<boolean>;

  private readonly cacheReloadRequest$ = new Subject<boolean>();

  constructor(
    private readonly cepRestartService: CepRestartService,
    private readonly cepStatusService: CepStatusService,
    private readonly extensionInventoryService: ExtensionInventoryService,
    private readonly extensionEnrichmentService: ExtensionEnrichmentService
  ) {
    this.extensionChanged$ = this.extensionInventoryService.extensionChanged$;
    this.uploadProgress$ = this.extensionInventoryService.uploadProgress$;
    this.restarting$ = this.cepRestartService.restarting$;
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

  /** Whether a CEP/Apama restart is currently known to be in progress. */
  isRestarting(): boolean {
    return this.cepRestartService.isRestarting();
  }

  clearAllCaches(): void {
    this.cepStatusService.clearCache();
    this.extensionEnrichmentService.invalidateCache();
  }

  async reinitializeMonitoring(): Promise<void> {
    return this.cepStatusService.reinitializeMonitoring();
  }

  // ============================================================================
  // Public API - Extensions (Inventory)
  // ============================================================================

  async getExtensionsFromInventory(): Promise<IManagedObject[]> {
    return this.extensionInventoryService.getExtensionsFromInventory();
  }

  async getEnrichedExtensions(): Promise<IManagedObject[]> {
    return this.extensionEnrichmentService.getEnrichedExtensions();
  }

  async uploadExtension(
    file: File,
    extension: IManagedObject,
    mode: UploadMode
  ): Promise<IManagedObjectBinary> {
    const result = await this.extensionInventoryService.uploadExtension(file, extension, mode);
    this.extensionEnrichmentService.invalidateCache();
    return result;
  }

  async deleteExtension(
    extension: IManagedObject,
    showSuccessMessage: boolean = true
  ): Promise<IResult<null>> {
    const result = await this.extensionInventoryService.deleteExtension(extension, showSuccessMessage);
    this.extensionEnrichmentService.invalidateCache();
    return result;
  }

  async downloadExtension(extension: IManagedObject): Promise<ArrayBuffer> {
    return this.extensionInventoryService.downloadExtension(extension);
  }

  cancelExtensionCreation(extension: Partial<IManagedObject>): void {
    this.extensionInventoryService.cancelExtensionCreation(extension);
  }

  updateUploadProgress(event: ProgressEvent): void {
    this.extensionInventoryService.updateUploadProgress(event);
  }

  // ============================================================================
  // Public API - Blocks (Cep Deployed)
  // ============================================================================

  async getDeployedBlocks(): Promise<CepBlock[]> {
    return this.extensionEnrichmentService.getDeployedBlocks();
  }

  // ============================================================================
  // Public API - Cep Status & Control
  // ============================================================================

  async getCepStatus(): Promise<CepStatusObject> {
    return this.cepStatusService.getCepStatus();
  }

  getCepOperationObjectStream$(): Observable<IManagedObject> {
    return this.cepStatusService.getCepOperationObjectStream$();
  }

  async restartCepEngine(): Promise<void> {
    return this.cepStatusService.restartCepEngine();
  }

  /**
   * Whether we are in the restart window — actively restarting, or within the
   * grace period right after. Transient backend errors (500/502, missing
   * operation object, unavailable microservice) are expected here and should
   * not raise toasts or console errors.
   */
  isRestartWindow(): boolean {
    return this.cepRestartService.isRestartWindow();
  }

  /**
   * Whether an error is an expected, self-recovering backend condition that
   * should be logged quietly without alarming the user.
   */
  isExpectedTransientError(error: unknown): boolean {
    return this.cepRestartService.isExpectedTransientError(error);
  }

  async isBackendServiceAvailable(): Promise<boolean> {
    return this.cepStatusService.isBackendServiceAvailable();
  }

  // ============================================================================
  // Public API - Cep Metadata (Read-only)
  // ============================================================================

  async getExtensionNamesFromCep(): Promise<CepExtensionsMetadata> {
    return this.extensionEnrichmentService.getExtensionNamesFromCep();
  }

  async getDeployedExtensionDetails(extensionName: string): Promise<CepExtension | null> {
    return this.extensionEnrichmentService.getDeployedExtensionDetails(extensionName);
  }

  async getCepOperationObjectId(): Promise<string | undefined> {
    return this.cepStatusService.getCepOperationObjectId();
  }
}
