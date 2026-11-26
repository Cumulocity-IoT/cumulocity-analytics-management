import { Injectable } from '@angular/core';
import { FetchClient, IManagedObject } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import {
  Category,
  CEP_DIAGNOSTICS_ZIP_SUFFIX,
  CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES,
  CEP_PATH_EN,
  CEP_PATH_METADATA_EN,
  CepBlock,
  CepExtension,
  CepExtensionsMetadata,
  RawCepBlock
} from './analytics.model';
import { CepError, fetchCepJSON } from './cep-error';
import { CepRestartService } from './cep-restart.service';
import { ExtensionInventoryService } from './extension-inventory.service';
import {
  isCustomCepBlock,
  removeFileExtension,
  removeZipSuffix,
  splitExtensionVersion
} from './utils';

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
  private static readonly CATEGORY_KEYWORDS: ReadonlyArray<readonly [Category, readonly string[]]> =
    [
      [Category.INPUT, ['input', 'trigger', 'measurement', 'event']],
      [Category.OUTPUT, ['output', 'send', 'http', 'email', 'alarm']],
      [
        Category.AGGREGATE,
        ['sum', 'count', 'average', 'mean', 'aggregate', 'statistics', 'discrete']
      ],
      [
        Category.CALCULATION,
        ['math', 'calculation', 'operation', 'base', 'multiply', 'divide', 'limit']
      ],
      [Category.LOGIC, ['if', 'compare', 'filter', 'logic', 'condition', 'anomaly']],
      [Category.FLOW_MANIPULATION, ['delay', 'rate', 'throttle', 'flow', 'state']],
      [Category.UTILITY, ['random', 'generator', 'constant', 'noise', 'walk']]
    ];

  constructor(
    private readonly alertService: AlertService,
    private readonly fetchClient: FetchClient,
    private readonly extensionInventoryService: ExtensionInventoryService,
    private readonly cepRestartService: CepRestartService
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
      inventoryExtensions.map(ext => this.addDeploymentStatus(ext, deployedMetadata, diagnostics))
    );
  }

  async getDeployedBlocks(): Promise<CepBlock[]> {
    if (!this.cachedDeployedBlocks) {
      this.cachedDeployedBlocks = this.loadDeployedBlocks().catch(error => {
        this.cachedDeployedBlocks = null;
        // While the engine restarts, the blocks cannot be read. That is expected and passes
        // by itself, and the restart toast already says so: no "could not load" error.
        const expected = this.cepRestartService.isExpectedTransientError(error);
        throw this.handleError(
          error,
          'Failed to load deployed blocks',
          !expected,
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

    let failedExtensions = 0;
    const perExtensionBlocks = await Promise.all(
      extensionNames.map(async extensionName => {
        // Shares the per-name memo with addDeploymentStatus — no duplicate HTTP fetch
        const ext = await this.getDeployedExtensionDetails(extensionName);
        if (!ext) {
          failedExtensions++;
          return [];
        }
        if (!ext.analytics?.length) return [];
        // Drop malformed blocks instead of failing the whole load.
        return ext.analytics
          .map(block => this.addBlockMetadata(block, ext.name))
          .filter((block): block is CepBlock => block !== null);
      })
    );

    if (failedExtensions > 0) {
      // A list built without some extensions must not be memoized: it would hide
      // their blocks until the next explicit cache invalidation. The next caller
      // retries (the failed details are already evicted from their own memo).
      this.cachedDeployedBlocks = null;
      console.warn(
        `Deployed blocks are incomplete: ${failedExtensions} extension(s) could not be read.`
      );
    }

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
        // The engine keeps an uploaded extension's metadata under "<name>-<version>", while the
        // extension itself is stored without the version.
        const metadata = await this.getDeployedExtensionsMetadata().catch(() => undefined);
        const metadataName = this.resolveMetadataName(extensionName, metadata) ?? extensionName;
        const data = await fetchCepJSON<CepExtension>(
          this.fetchClient,
          `${CEP_PATH_EN}/${encodeURIComponent(metadataName)}.json`
        );
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

  /**
   * The name the engine registered an extension's blocks under: the name itself, or the one
   * entry that is the name plus a version ("Abs" is "Abs-1.0.1"). Null when it is not deployed.
   */
  private resolveMetadataName(
    name: string,
    metadata: CepExtensionsMetadata | undefined
  ): string | null {
    const registered = (metadata?.metadatas ?? []).map(removeFileExtension);
    if (registered.includes(name)) {
      return name;
    }
    const versioned = registered.filter(entry => splitExtensionVersion(entry).name === name);
    return versioned.length === 1 ? versioned[0] : null;
  }

  private async addDeploymentStatus(
    extension: IManagedObject,
    deployedMetadata: CepExtensionsMetadata,
    diagnostics: CepExtensionsMetadata
  ): Promise<IManagedObject> {
    // Some inventory entries keep the ".zip" suffix in their name; normalize
    // it so lookups against the correlator (which never uses ".zip") match.
    // Only ".zip": an extension named "Abs-1.0.1" must not lose its ".1" and so its match.
    const cleanName = removeZipSuffix(extension['name']);
    const diagnosticsKey = cleanName + CEP_DIAGNOSTICS_ZIP_SUFFIX;

    // Direction-agnostic match: handles entries returned as either "foo.json"
    // (exact) or "foo" (extension stripped). Matching only one direction is
    // fragile against API drift; this catches both shapes explicitly.
    const metadataName = this.resolveMetadataName(cleanName, deployedMetadata);
    const isDeployedViaMetadata = metadataName !== null;
    const isDeployedViaDiagnostics =
      !!diagnostics && diagnosticsKey in (diagnostics as unknown as Record<string, unknown>);
    const isDeployed = isDeployedViaMetadata || isDeployedViaDiagnostics;

    let blockCount = 0;
    if (isDeployed) {
      const details = await this.getDeployedExtensionDetails(metadataName ?? cleanName);
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
  private addBlockMetadata(
    block: RawCepBlock | null | undefined,
    extensionName: string
  ): CepBlock | null {
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

  /**
   * Whole-word matching on the words of the name and description (camelCase is
   * split). A substring test would classify "Notification" as Logic because it
   * contains "if", or "Prevent" as Input because it contains "event".
   */
  private determineBlockCategory(block: Partial<CepBlock>): Category {
    const text = `${block.name ?? ''} ${block.description ?? ''}`;
    const words = new Set(
      text
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    );
    for (const [category, keywords] of ExtensionEnrichmentService.CATEGORY_KEYWORDS) {
      if (keywords.some(kw => words.has(kw) || words.has(`${kw}s`))) return category;
    }
    return Category.UTILITY;
  }

  private handleError(
    error: unknown,
    logMessage: string,
    showAlert: boolean = false,
    userMessage?: string
  ): Error {
    if (this.cepRestartService.isExpectedTransientError(error)) {
      console.warn(
        `[ExtensionEnrichmentService] ${logMessage} (expected while the engine restarts):`,
        error
      );
    } else {
      console.error(`[ExtensionEnrichmentService] ${logMessage}:`, error);
    }

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
      const { message } = errorObj;
      if (typeof message === 'string') {
        return message;
      }
    }

    return gettext('An unexpected error occurred. Please try again.');
  }
}
