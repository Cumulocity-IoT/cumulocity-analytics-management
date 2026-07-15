import { Injectable } from '@angular/core';
import { AlertService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import * as jsyaml from 'js-yaml';
import { Observable, forkJoin, from, of } from 'rxjs';
import { catchError, map, shareReplay, switchMap } from 'rxjs/operators';
import {
  CepBlock,
  DESCRIPTOR_YAML,
  Repository,
  RepositoryItem
} from './analytics.model';
import { GitHubContentService } from './github-content.service';
import { RepositoryBackendService } from './repository-backend.service';
import { RepositoryError } from './repository-error';
import { RepositoryModeService } from './repository-mode.service';
import { getFileExtension, removeFileExtension, uuidCustom } from './utils';

/**
 * Fetches, enriches, and caches a repository's items (`.mon` files,
 * directories, `extensions.yaml` sections) — dispatching each content
 * operation to the backend or direct-to-GitHub per `RepositoryModeService`.
 */
@Injectable({
  providedIn: 'root'
})
export class RepositoryItemsService {
  private readonly blockCache = new Map<string, Observable<RepositoryItem[]>>();
  private readonly fqnCache = new Map<string, Observable<string>>();

  constructor(
    private readonly repositoryModeService: RepositoryModeService,
    private readonly gitHubContentService: GitHubContentService,
    private readonly repositoryBackendService: RepositoryBackendService,
    private readonly alertService: AlertService
  ) {}

  invalidateCache(): void {
    this.blockCache.clear();
    this.fqnCache.clear();
  }

  /**
   * Items for every enabled repository, combined and given "installed"
   * status against the currently deployed blocks.
   */
  getItemsForRepositories(
    repos: Repository[],
    deployedBlocks: CepBlock[],
    hideInstalled: boolean
  ): Observable<RepositoryItem[]> {
    const enabledRepos = repos.filter(repo => repo.enabled);

    if (!enabledRepos.length) {
      return of([]);
    }

    return forkJoin(
      enabledRepos.map(repo => this.getCachedRepositoryItems(repo))
    ).pipe(
      map(blocks => this.addInstallationStatus(blocks.flat(), deployedBlocks, hideInstalled)),
      catchError(error => {
        this.handleError(
          error,
          'Failed to process repository items',
          gettext('Failed to load repository items. Please try again.')
        );
        return of([]);
      })
    );
  }

  filterRepositoryItems(blocks: RepositoryItem[]): RepositoryItem[] {
    const hasExtensionsYaml = blocks.some(
      block => block.type !== 'dir' &&
        block.file?.toLowerCase() === DESCRIPTOR_YAML
    );

    if (hasExtensionsYaml) {
      return blocks.filter(
        block => block.type !== 'dir' &&
          block.file?.toLowerCase() === DESCRIPTOR_YAML
      );
    }

    return blocks.filter(
      block => (block.type === 'dir' && !block.file.startsWith('.')) ||
        (block.file?.toLowerCase().endsWith('.mon'))
    );
  }

  analyzeRepositoryItems(items: RepositoryItem[]): Observable<RepositoryItem[]> {
    const yamlItems = items.filter(
      block => block.type !== 'dir' &&
        block.file?.toLowerCase() === DESCRIPTOR_YAML
    );

    if (yamlItems.length > 0) {
      const yamlItem = yamlItems[0];
      return this.getSectionsFromExtensionYAML(yamlItem).pipe(
        map(sectionNames => this.createYamlSectionItems(sectionNames, yamlItem))
      );
    }

    return of(
      items.filter(
        item => (item.type === 'dir' && !item.file.startsWith('.')) ||
          (item.file?.toLowerCase().endsWith('.mon'))
      )
    );
  }

  /**
   * Callers decide whether a failure here is user-facing: this never shows
   * an alert itself (only logs), since it's used both for explicit actions
   * (e.g. "View Source", where the caller should surface a failure) and for
   * automatic background enrichment during listing (FQN extraction for
   * every `.mon` file), where one flaky/rate-limited item among many is
   * expected and already handled gracefully by the caller's own fallback —
   * see `enrichRepositoryItem`.
   */
  getItemContent(
    block: RepositoryItem,
    extractFQN: boolean = false
  ): Observable<string> {
    const content$ = from(this.repositoryModeService.isBackendMode()).pipe(
      switchMap(backendMode => backendMode
        ? from(this.repositoryBackendService.getItemContent(block, extractFQN))
        : from(this.gitHubContentService.getItemContent(block, extractFQN))
      )
    );

    return content$.pipe(
      catchError(error => {
        const errorMsg = extractFQN
          ? gettext('Failed to extract block information')
          : gettext('Failed to load content');

        throw this.handleError(error, `Failed to get content for ${block.name}`, errorMsg, false);
      })
    );
  }

  /** Dispatches to the backend or a direct GitHub call per `RepositoryModeService`. */
  private async getContent(repository: Repository): Promise<any[]> {
    return (await this.repositoryModeService.isBackendMode())
      ? this.repositoryBackendService.getContent(repository)
      : this.gitHubContentService.getContent(repository);
  }

  private getCachedRepositoryItems(repository: Repository): Observable<RepositoryItem[]> {
    if (!this.blockCache.has(repository.id)) {
      const items$ = this.fetchRepositoryItems(repository).pipe(
        shareReplay({ bufferSize: 1, refCount: true })
      );
      this.blockCache.set(repository.id, items$);
    }
    return this.blockCache.get(repository.id)!;
  }

  private fetchRepositoryItems(repository: Repository): Observable<RepositoryItem[]> {
    return from(this.getContent(repository)).pipe(
      switchMap(data => this.processGitHubContent(data, repository)),
      catchError(error => {
        // Surface GitHub's specific reason (rate limit / bad token / bad
        // path) instead of a generic message, so the cause is diagnosable.
        // A 404 here is a real "not found" (from GitHub or the backend),
        // not a missing microservice — it should be shown, not swallowed.
        const detail = error instanceof RepositoryError ? error.userMessage : '';
        this.handleError(
          error,
          `Failed to fetch items from repository: ${repository.name}`,
          detail
            ? gettext(`Failed to load items from "${repository.name}": ${detail}`)
            : gettext(`Failed to load items from repository "${repository.name}".`)
        );
        return of([]);
      })
    );
  }

  private processGitHubContent(data: unknown, repository: Repository): Observable<RepositoryItem[]> {
    try {
      const items: RepositoryItem[] = [];

      if (data && typeof data === 'object') {
        const dataObj = data as Record<string, unknown>;
        for (const item of Object.values(dataObj)) {
          if (!item || typeof item !== 'object') continue;
          const name = (item as Record<string, unknown>)['name'] as string | undefined;
          if (name && getFileExtension(name) !== '.json') {
            items.push(this.createRepositoryItem(item, repository));
          }
        }
      }

      if (items.length === 0) return of([]);
      return forkJoin(items.map(item => this.enrichRepositoryItem(item)));
    } catch (error) {
      throw this.handleError(error, 'Failed to process GitHub content', undefined, false);
    }
  }

  private enrichRepositoryItem(item: RepositoryItem): Observable<RepositoryItem> {
    if (item.type !== 'file' || !item.file.endsWith('.mon')) {
      return of({ ...item, id: item.file });
    }

    const cacheKey = `${item.repositoryId}::${item.url}`;
    let fqn$ = this.fqnCache.get(cacheKey);
    if (!fqn$) {
      fqn$ = this.getItemContent(item, true).pipe(
        catchError(error => {
          console.warn(`Failed to enrich item ${item.name}:`, error);
          this.fqnCache.delete(cacheKey); // allow retry
          return of(item.file);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );
      this.fqnCache.set(cacheKey, fqn$);
    }

    return fqn$.pipe(map(fqn => ({ ...item, id: fqn })));
  }

  private createRepositoryItem(item: unknown, repository: Repository): RepositoryItem {
    if (!item || typeof item !== 'object') {
      throw new RepositoryError(
        'Invalid GitHub item structure',
        gettext('Invalid repository item data received.')
      );
    }

    const itemObj = item as Record<string, unknown>;
    const name = itemObj['name'] as string | undefined;
    const url = itemObj['url'] as string | undefined;

    if (!name || !url) {
      throw new RepositoryError(
        'Invalid GitHub item structure',
        gettext('Invalid repository item data received.')
      );
    }

    return {
      id: '',
      repositoryName: repository.name,
      repositoryId: repository.id,
      name: removeFileExtension(name),
      file: name,
      type: (itemObj['type'] as string) || 'file',
      custom: true,
      downloadUrl: (itemObj['download_url'] as string) || url,
      url: url
    } as RepositoryItem;
  }

  private getSectionsFromExtensionYAML(item: RepositoryItem): Observable<string[]> {
    return this.getItemContent(item, false).pipe(
      map(content => this.parseYamlSections(content)),
      catchError(error => {
        console.warn(`Error processing ${DESCRIPTOR_YAML}:`, error);
        return of([]);
      })
    );
  }

  private createYamlSectionItems(sectionNames: string[], yamlItem: RepositoryItem): RepositoryItem[] {
    return sectionNames.map(name => ({
      ...yamlItem,
      id: uuidCustom(),
      name,
      isYamlSection: true,
      extensionsYamlItem: yamlItem
    }));
  }

  private addInstallationStatus(
    blocks: RepositoryItem[],
    loaded: CepBlock[],
    hideInstalled: boolean
  ): RepositoryItem[] {
    const loadedIds = new Set(loaded.map(block => block.id));

    if (hideInstalled) {
      return blocks.filter(block => !loadedIds.has(block.id));
    }

    return blocks.map(block => ({
      ...block,
      installed: loadedIds.has(block.id)
    }));
  }

  private parseYamlSections(content: string): string[] {
    try {
      const yamlContent = jsyaml.load(content);

      if (yamlContent && typeof yamlContent === 'object') {
        return Object.keys(yamlContent);
      }

      console.warn(`Invalid YAML content structure in ${DESCRIPTOR_YAML}`);
      return [];
    } catch (error) {
      throw new RepositoryError(
        `Error parsing ${DESCRIPTOR_YAML}`,
        gettext(`Failed to parse ${DESCRIPTOR_YAML}. Invalid format.`),
        error instanceof Error ? error : undefined
      );
    }
  }

  private handleError(
    error: unknown,
    logMessage: string,
    userMessage?: string,
    showAlert: boolean = true
  ): Error {
    console.error(`[RepositoryItemsService] ${logMessage}:`, error);

    if (showAlert && userMessage) {
      this.alertService.danger(userMessage);
    }

    if (error instanceof RepositoryError) {
      return error;
    }

    return new RepositoryError(
      logMessage,
      userMessage || gettext('An unexpected error occurred. Please try again.'),
      error instanceof Error ? error : undefined
    );
  }
}
