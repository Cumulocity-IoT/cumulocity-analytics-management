import { Injectable } from '@angular/core';
import { IFetchResponse, IManagedObject } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import JSZip from 'jszip';
import { buildBlockMessagesEvt, buildBlockMetadataEvt, ParsedBlockMetadata, parseApamaBlockMetadata } from './apama-block-metadata';
import { Repository, RepositoryItem } from './analytics.model';
import { AnalyticsService } from './analytics.service';
import { GitHubContentService } from './github-content.service';
import { RepositoryBackendService } from './repository-backend.service';
import { RepositoryError } from './repository-error';
import { RepositoryModeService } from './repository-mode.service';

/**
 * Builds an extension zip from selected repository items and uploads it —
 * dispatching to the backend or a client-side JSZip build per
 * `RepositoryModeService`. Only the "build from a list of selected files"
 * path (the common case: flat, one file per block) has a browser-mode
 * implementation so far; `extensions.yaml` sections and whole-repository
 * builds still require the backend.
 */
@Injectable({
  providedIn: 'root'
})
export class ExtensionBuilderService {
  constructor(
    private readonly repositoryModeService: RepositoryModeService,
    private readonly gitHubContentService: GitHubContentService,
    private readonly repositoryBackendService: RepositoryBackendService,
    private readonly analyticsService: AnalyticsService,
    private readonly alertService: AlertService
  ) {}

  /**
   * Builds one extension zip from a list of already-selected repository
   * items (typically flat `.mon` files — one file = one block).
   */
  async createExtensionFromList(
    name: string,
    monitors: RepositoryItem[],
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    return (await this.repositoryModeService.isBackendMode())
      ? this.repositoryBackendService.createExtensionFromList(name, monitors, repository, upload, deploy, rebuild)
      : this.createExtensionFromListDirect(name, monitors, deploy);
  }

  async createExtensionFromYaml(
    name: string,
    yaml: RepositoryItem,
    sections: string[],
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    if (!(await this.repositoryModeService.isBackendMode())) {
      return this.rejectUnsupportedInBrowserMode(name, 'extensions.yaml sections');
    }
    return this.repositoryBackendService.createExtensionFromYaml(name, yaml, sections, repository, upload, deploy, rebuild);
  }

  async createExtensionFromRepository(
    name: string,
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    if (!(await this.repositoryModeService.isBackendMode())) {
      return this.rejectUnsupportedInBrowserMode(name, 'a whole repository path');
    }
    return this.repositoryBackendService.createExtensionFromRepository(name, repository, upload, deploy, rebuild);
  }

  /**
   * Builds the extension zip client-side (fetch each selected file's raw
   * content directly from GitHub, zip with JSZip applying the SDK's
   * exclude-list) and uploads it via the same `AnalyticsService.uploadExtension`
   * path used everywhere else in the app — no backend involved. Never
   * throws: mirrors the backend path's `IFetchResponse`-shaped result so
   * callers (e.g. `ExtensionCreateComponent`) don't need to branch on mode.
   */
  private async createExtensionFromListDirect(
    name: string,
    monitors: RepositoryItem[],
    deploy: boolean
  ): Promise<IFetchResponse> {
    try {
      const file = await this.buildExtensionZip(name, monitors);
      const extension = this.buildExtensionManagedObject(name, monitors);

      await this.analyticsService.uploadExtension(file, extension as IManagedObject, 'add');

      if (deploy) {
        await this.analyticsService.restartCepEngine();
      }

      // No success alert here — matches the backend path's convention: this
      // service only alerts on failure, the caller (ExtensionCreateComponent)
      // owns the success toast.
      return { status: 200 } as unknown as IFetchResponse;
    } catch (error) {
      console.error(`[ExtensionBuilderService] Failed to create extension from list: ${name}:`, error);
      this.alertService.danger(
        error instanceof RepositoryError
          ? error.userMessage
          : gettext(`Failed to create extension "${name}". Please try again.`)
      );
      return { status: 500 } as unknown as IFetchResponse;
    }
  }

  /**
   * Zips the given repository items as-is (client-side, JSZip), applying
   * the block SDK's documented build-extension exclude-list — see
   * docs/features/block-marketplace/CONCEPT.md. Directories aren't
   * supported by this path yet (only flat, individually-selected files).
   *
   * Every real extension zip (both GitHub Release assets and apama-ctrl's
   * own correlator logs, e.g. "Extracting AsyncSignal.zip/files/AsyncSignal.mon")
   * nests its content under a top-level `files/` folder — apama-ctrl's
   * `copyExtensions` looks specifically there, so a flat zip is silently
   * skipped (no error, the extension just never loads). CONCEPT.md's
   * "all files in that directory" description of the CLI build turned out
   * to describe an input directory that already contains a `files/`
   * subfolder, not a flat layout — confirmed by unzipping a real published
   * extension.
   *
   * Also generates `files/events/<name>_metadata.evt`/`_messages.evt` (see
   * apama-block-metadata.ts) — a real CLI build produces these from the
   * `.mon` file's doc-comment annotations, and without them the correlator
   * has nothing to register the block's name/category/parameters under.
   */
  private async buildExtensionZip(name: string, monitors: RepositoryItem[]): Promise<File> {
    const EXCLUDED_EXTENSIONS = ['.log', '.classpath', '.dependencies', '.project', '.deploy', '.launch', '.out', '.o'];
    const zip = new JSZip();
    const files = zip.folder('files')!;
    const blocks: ParsedBlockMetadata[] = [];

    for (const item of monitors) {
      if (item.type === 'dir') {
        continue;
      }
      const lowerFile = item.file.toLowerCase();
      if (EXCLUDED_EXTENSIONS.some(ext => lowerFile.endsWith(ext))) {
        continue;
      }
      if (item.file.startsWith('.git/') || item.file.startsWith('.github/')) {
        continue;
      }
      const content = await this.gitHubContentService.getItemContent(item, false);
      files.file(item.file, content);

      if (lowerFile.endsWith('.mon')) {
        const packageMatch = /^package\s+(.*?);/m.exec(content);
        if (packageMatch) {
          blocks.push(...parseApamaBlockMetadata(content, packageMatch[1].trim()));
        }
      }
    }

    if (blocks.length > 0) {
      const events = files.folder('events')!;
      events.file(`${name}_metadata.evt`, buildBlockMetadataEvt(name, blocks));
      events.file(`${name}_messages.evt`, buildBlockMessagesEvt(name, blocks));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    return new File([blob], `${name}.zip`, { type: 'application/zip' });
  }

  /**
   * Minimal `build_information` for a freshly client-side-built zip. The
   * zip itself now includes real `.evt` metadata (see `buildExtensionZip`
   * above, via apama-block-metadata.ts) — this managed-object fragment is
   * just the inventory-side bookkeeping and doesn't need to duplicate it.
   * Matches the shape `ExtensionAddComponent.analyzeZipContent` falls back
   * to when no metadata file is found for a monitor.
   */
  private buildExtensionManagedObject(name: string, monitors: RepositoryItem[]): Partial<IManagedObject> {
    const monitorsMetadata = monitors
      .filter(item => item.type !== 'dir' && item.file.toLowerCase().endsWith('.mon'))
      .map(item => ({
        custom: true,
        file: item.file,
        id: item.id || item.name,
        name: item.name,
        type: 'file'
      }));

    return {
      pas_extension: name,
      name,
      build_information: {
        build_type: 'external',
        monitors: monitorsMetadata,
        files: []
      }
    };
  }

  private rejectUnsupportedInBrowserMode(name: string, what: string): IFetchResponse {
    this.alertService.danger(
      gettext(`Could not create "${name}": building an extension from ${what} isn't supported yet without the analytics-service backend. Select individual files instead, or deploy the backend.`)
    );
    return { status: 501 } as unknown as IFetchResponse;
  }
}
