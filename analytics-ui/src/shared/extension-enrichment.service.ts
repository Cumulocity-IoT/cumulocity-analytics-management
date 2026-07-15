import { Injectable } from '@angular/core';
import { FetchClient, IManagedObject } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import {
  Category,
  CEP_METADATA_FILE_EXTENSION_1,
  CEP_METADATA_FILE_EXTENSION_2,
  CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES,
  CEP_PATH_EN,
  CEP_PATH_METADATA_EN,
  CepBlock,
  CepExtension,
  CepExtensionsMetadata,
  RawCepBlock
} from './analytics.model';
import { CepError, fetchCepJSON } from './cep-error';
import { ExtensionInventoryService } from './extension-inventory.service';
import { isCustomCepBlock, removeFileExtension } from './utils';

/**
 * Cross-references inventory extensions against what the CEP correlator has
 * actually deployed: enriched extension list (loaded/blocksCount), deployed
 * blocks, and the correlator's raw metadata/diagnostics endpoints those
 * derive from.
 */
@Injectable({ providedIn: 'root' })
export class ExtensionEnrichmentService {
  private cachedDeployedBlocks: Promise<CepBlock[]> | null = null;
  private cachedDeployedExtensions: Promise<IManagedObject[]> | null = null;
  private cachedDeployedExtensionsMetadata: Promise<CepExtensionsMetadata> | null = null;
  private cachedExtensionNames: Promise<CepExtensionsMetadata> | null = null;
  private cachedExtensionDetails = new Map<string, Promise<CepExtension | null>>();

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

  constructor(
    private readonly alertService: AlertService,
    private readonly fetchClient: FetchClient,
    private readonly extensionInventoryService: ExtensionInventoryService
  ) {}

  /** Clears every cache invalidated by an extension being added/updated/deleted. */
  invalidateCache(): void {
    this.cachedDeployedExtensions = null;
    this.cachedDeployedBlocks = null;
    this.cachedDeployedExtensionsMetadata = null;
    this.cachedExtensionNames = null;
    this.cachedExtensionDetails.clear();
  }

  async getEnrichedExtensions(): Promise<IManagedObject[]> {
    if (!this.cachedDeployedExtensions) {
      this.cachedDeployedExtensions = this.loadEnrichedExtensions().catch(error => {
        this.cachedDeployedExtensions = null;
        // Don't surface a toast here: the caller (extension grid) owns a single,
        // restart-aware, auto-dismissing message so we don't stack two alerts
        // for one failure.
        throw this.handleError(error, 'Failed to enrich extensions with deployment status', false);
      });
    }
    return this.cachedDeployedExtensions;
  }

  private async loadEnrichedExtensions(): Promise<IManagedObject[]> {
    const [inventoryExtensions, deployedMetadata, diagnostics] = await Promise.all([
      this.extensionInventoryService.getExtensionsFromInventory(),
      this.getDeployedExtensionsMetadata(),
      this.getExtensionNamesFromCep()
    ]);

    return Promise.all(
      inventoryExtensions.map(ext =>
        this.addDeploymentStatus(ext, deployedMetadata, diagnostics)
      )
    );
  }

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

  async getExtensionNamesFromCep(): Promise<CepExtensionsMetadata> {
    if (!this.cachedExtensionNames) {
      this.cachedExtensionNames = fetchCepJSON<CepExtensionsMetadata>(
        this.fetchClient,
        `/${CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES}`
      ).catch(error => {
        this.cachedExtensionNames = null;
        throw this.handleError(error, 'Failed to get extension names from Cep', false);
      });
    }
    return this.cachedExtensionNames;
  }

  async getDeployedExtensionDetails(extensionName: string): Promise<CepExtension | null> {
    const cached = this.cachedExtensionDetails.get(extensionName);
    if (cached) return cached;

    const inflight = (async () => {
      try {
        const data = await fetchCepJSON<CepExtension>(this.fetchClient, `${CEP_PATH_EN}/${extensionName}.json`);
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

  private async getDeployedExtensionsMetadata(): Promise<CepExtensionsMetadata> {
    // Memoized because both loadEnrichedExtensions() and loadDeployedBlocks()
    // need it; without the cache a screen showing both grids fetches
    // block-metadata.json twice.
    if (!this.cachedDeployedExtensionsMetadata) {
      this.cachedDeployedExtensionsMetadata = fetchCepJSON<CepExtensionsMetadata>(
        this.fetchClient,
        `/${CEP_PATH_METADATA_EN}`
      ).catch(error => {
        this.cachedDeployedExtensionsMetadata = null;
        throw this.handleError(error, 'Failed to get deployed extensions metadata', false);
      });
    }
    return this.cachedDeployedExtensionsMetadata;
  }

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

  private determineBlockCategory(block: Partial<CepBlock>): Category {
    const text = `${block.name ?? ''} ${block.description ?? ''}`.toLowerCase();
    for (const [category, keywords] of ExtensionEnrichmentService.CATEGORY_KEYWORDS) {
      if (keywords.some(kw => text.includes(kw))) return category;
    }
    return Category.UTILITY;
  }

  private handleError(
    error: unknown,
    logMessage: string,
    showAlert: boolean = false,
    userMessage?: string
  ): Error {
    console.error(`[ExtensionEnrichmentService] ${logMessage}:`, error);

    if (showAlert) {
      this.alertService.danger(userMessage || this.getErrorMessage(error));
    }

    if (error instanceof CepError) {
      return error;
    }

    return new CepError(
      logMessage,
      userMessage || this.getErrorMessage(error),
      error instanceof Error ? error : undefined
    );
  }

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
}
