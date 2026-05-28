import { Injectable, OnDestroy } from '@angular/core';
import { FetchClient, IFetchResponse } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import * as jsyaml from 'js-yaml';
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  forkJoin,
  from,
  lastValueFrom,
  of,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  tap
} from 'rxjs/operators';
import {
  BACKEND_PATH_BASE,
  CepBlock,
  DESCRIPTOR_YAML,
  EXTENSION_ENDPOINT,
  Repository,
  REPOSITORY_CONFIGURATION_ENDPOINT,
  REPOSITORY_CONTENT_ENDPOINT,
  REPOSITORY_CONTENT_LIST_ENDPOINT,
  RepositoryItem,
  RepositoryTestResult
} from './analytics.model';
import { AnalyticsService } from './analytics.service';
import {
  getFileExtension,
  removeFileExtension,
  uuidCustom
} from './utils';
import { gettext } from '@c8y/ngx-components/gettext';

/**
 * Custom error class for repository-related errors
 */
class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

interface RepositoryState {
  repositories: Repository[];
  savedRepositories: Repository[];
  hideInstalled: boolean;
}

interface CreateExtensionRequest {
  extension_name: string;
  upload: boolean;
  deploy: boolean;
  repository: Repository;
  rebuild: boolean;
}

interface CreateExtensionFromListRequest extends CreateExtensionRequest {
  monitors: RepositoryItem[];
}

interface CreateExtensionFromYamlRequest extends CreateExtensionRequest {
  yaml: RepositoryItem;
  sections: string[];
}

@Injectable({
  providedIn: 'root'
})
export class RepositoryService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();

  // State management
  private readonly state$ = new BehaviorSubject<RepositoryState>({
    repositories: [],
    savedRepositories: [],
    hideInstalled: false
  });

  // Cache management
  private readonly blockCache = new Map<string, Observable<RepositoryItem[]>>();
  private readonly fqnCache = new Map<string, Observable<string>>();
  private readonly reloadTrigger$ = new BehaviorSubject<void>(undefined);

  // Public observables
  readonly repositories$ = this.state$.pipe(
    map(state => state.repositories),
    distinctUntilChanged((a, b) => this.areRepositoriesEqual(a, b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly repositoryItems$ = combineLatest([
    this.reloadTrigger$,
    this.state$
  ]).pipe(
    switchMap(([_, state]) =>
      this.loadRepositoryItemsWithStatus(state.hideInstalled)
    ),
    shareReplay({ bufferSize: 1, refCount: true }),
    takeUntil(this.destroy$)
  );

  readonly hasUnsavedChanges$ = this.state$.pipe(
    map(state => this.hasUnsavedChanges(state)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly alertService: AlertService,
    private readonly fetchClient: FetchClient
  ) {
    this.initializeRepositories();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.clearCache();
  }

  // ============================================================================
  // Public API - Repository Management
  // ============================================================================

  getRepositories(): Observable<Repository[]> {
    return this.repositories$;
  }

  async addRepository(repository: Repository): Promise<void> {
    const state = this.state$.value;
    const updated = [...state.repositories, repository];

    try {
      await this.saveRepositoriesToBackend(updated);
      this.updateState({
        repositories: updated,
        savedRepositories: [...updated]
      });
      this.invalidateCache();
      this.alertService.success(gettext('Repository added successfully'));
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to add repository',
        true,
        gettext('Failed to add repository. Please try again.')
      );
    }
  }

  async updateRepository(updatedRepository: Repository): Promise<void> {
    const state = this.state$.value;
    const index = state.repositories.findIndex(r => r.id === updatedRepository.id);

    if (index === -1) {
      throw new RepositoryError(
        'Repository not found',
        gettext('Repository not found.')
      );
    }

    const updated = [
      ...state.repositories.slice(0, index),
      updatedRepository,
      ...state.repositories.slice(index + 1)
    ];

    try {
      await this.saveRepositoriesToBackend(updated);
      this.updateState({
        repositories: updated,
        savedRepositories: [...updated]
      });
      this.invalidateCache();
      this.alertService.success(gettext('Repository updated successfully'));
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to update repository',
        true,
        gettext('Failed to update repository. Please try again.')
      );
    }
  }

  toggleRepositoryEnabled(repositoryId: string): void {
    const state = this.state$.value;
    const targetRepo = state.repositories.find(r => r.id === repositoryId);

    if (!targetRepo) {
      this.handleError(
        new Error('Repository not found'),
        `Repository not found: ${repositoryId}`,
        false
      );
      return;
    }

    const newEnabledState = !targetRepo.enabled;
    const updated = state.repositories.map(repo => {
      if (repo.id === repositoryId) {
        return { ...repo, enabled: newEnabledState };
      }
      if (newEnabledState && repo.enabled) {
        return { ...repo, enabled: false };
      }
      return repo;
    });

    this.updateState({ repositories: updated });
    this.invalidateCache();
  }

  async saveAllRepositories(): Promise<void> {
    const state = this.state$.value;

    try {
      await this.saveRepositoriesToBackend(state.repositories);
      this.updateState({
        savedRepositories: [...state.repositories]
      });
      this.alertService.success(gettext('Repositories saved successfully'));
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to save repositories',
        true,
        gettext('Failed to save repositories. Please try again.')
      );
    }
  }

  hasUnsavedChanges(state?: RepositoryState): boolean {
    const currentState = state || this.state$.value;
    return currentState.repositories.some(repo => {
      const saved = currentState.savedRepositories.find(sr => sr.id === repo.id);
      return saved && saved.enabled !== repo.enabled;
    });
  }

  cancelChanges(): void {
    const state = this.state$.value;
    this.updateState({
      repositories: [...state.savedRepositories]
    });
    this.invalidateCache();
  }

  async deleteRepository(repositoryId: string): Promise<void> {
    const state = this.state$.value;
    const updated = state.repositories.filter(r => r.id !== repositoryId);

    try {
      await this.saveRepositoriesToBackend(updated);
      this.updateState({
        repositories: updated,
        savedRepositories: [...updated]
      });
      this.invalidateCache();
      this.alertService.success(gettext('Repository deleted successfully'));
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to delete repository',
        true,
        gettext('Failed to delete repository. Please try again.')
      );
    }
  }

  async testRepository(repository: Repository): Promise<RepositoryTestResult> {
    // Route through the backend so the request honors tenant CSP and reuses the
    // existing content-list proxy. The PAT is passed in a custom header (not a
    // query param) so it doesn't land in HTTP access logs or browser history;
    // this also lets draft (unsaved) repositories be tested before persisting.
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (repository.accessToken) {
        headers['X-Repository-Access-Token'] = repository.accessToken;
      }

      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONTENT_LIST_ENDPOINT}`,
        {
          headers,
          params: {
            url: encodeURIComponent(repository.url),
            repository_id: repository.id
          },
          method: 'GET'
        }
      );

      if (response.ok) {
        return {
          success: true,
          message: gettext('Successfully connected to repository'),
          status: response.status
        };
      }
      return this.mapTestStatusToResult(response.status);
    } catch (error) {
      return this.handleTestError(error);
    }
  }

  private mapTestStatusToResult(status: number): RepositoryTestResult {
    switch (status) {
      case 401:
        return { success: false, status, message: gettext('Authentication failed. Please check your access token.') };
      case 403:
        return { success: false, status, message: gettext('Access denied. Please check your permissions.') };
      case 404:
        return { success: false, status, message: gettext('Repository not found. Please check the URL.') };
      default:
        return { success: false, status, message: gettext(`Connection failed (status: ${status}). Please try again.`) };
    }
  }

  async refreshRepositories(): Promise<void> {
    try {
      await lastValueFrom(this.loadRepositoriesFromBackend()
        .pipe(take(1)));
      this.invalidateCache();
      this.alertService.success(gettext('Repositories refreshed successfully'));
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to refresh repositories',
        true,
        gettext('Failed to refresh repositories. Please try again.')
      );
    }
  }

  // ============================================================================
  // Public API - Cache and Reload
  // ============================================================================

  /**
   * Reload repository items (clears cache and triggers refresh)
   */
  reload(): void {
    this.invalidateCache();
  }

  /**
   * Reload repositories and items from backend
   */
  reloadAll(): Promise<void> {
    return this.refreshRepositories();
  }

  // ============================================================================
  // Public API - Repository Items
  // ============================================================================

  getRepositoryItems(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      map(blocks => this.filterRepositoryItems(blocks))
    );
  }

  getRepositoryItemsAnalyzed(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      switchMap(items => this.analyzeRepositoryItems(items)),
      catchError(error => {
        this.handleError(
          error,
          'Failed to analyze repository items',
          true,
          gettext('Failed to analyze repository items. Please try again.')
        );
        return of([]);
      })
    );
  }

  updateHideInstalledFilter(hideInstalled: boolean): void {
    this.updateState({ hideInstalled });
  }

  getRepositoryItemContent(
    block: RepositoryItem,
    useBackend: boolean = true,
    extractFQN: boolean = false
  ): Observable<string> {
    const content$ = useBackend
      ? this.getItemContentFromBackend(block, extractFQN)
      : this.getItemContentDirectly(block, extractFQN);

    return content$.pipe(
      catchError(error => {
        const errorMsg = extractFQN
          ? gettext('Failed to extract block information')
          : gettext('Failed to load content');

        throw this.handleError(
          error,
          `Failed to get content for ${block.name}`,
          true,
          errorMsg
        );
      })
    );
  }

  // ============================================================================
  // Public API - Extension Creation
  // ============================================================================

  async createExtensionFromList(
    name: string,
    monitors: RepositoryItem[],
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    const request: CreateExtensionFromListRequest = {
      extension_name: name,
      monitors,
      repository,
      upload,
      deploy,
      rebuild
    };

    try {
      return await this.createExtension('list', request);
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to create extension from list: ${name}`,
        true,
        gettext(`Failed to create extension "${name}". Please try again.`)
      );
    }
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
    const request: CreateExtensionFromYamlRequest = {
      extension_name: name,
      yaml,
      sections,
      repository,
      upload,
      deploy,
      rebuild
    };

    try {
      return await this.createExtension('yaml', request);
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to create extension from YAML: ${name}`,
        true,
        gettext(`Failed to create extension "${name}". Please try again.`)
      );
    }
  }

  async createExtensionFromRepository(
    name: string,
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    const request: CreateExtensionRequest = {
      extension_name: name,
      repository,
      upload,
      deploy,
      rebuild
    };

    try {
      return await this.createExtension('repository', request);
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to create extension from repository: ${name}`,
        true,
        gettext(`Failed to create extension "${name}". Please try again.`)
      );
    }
  }

  // ============================================================================
  // Private Methods - Initialization
  // ============================================================================

  private initializeRepositories(): void {
    this.loadRepositoriesFromBackend()
      .pipe(takeUntil(this.destroy$))
      .subscribe();
  }

  private loadRepositoriesFromBackend(): Observable<Repository[]> {
    return from(this.fetchRepositoriesFromBackend()).pipe(
      tap(repos => {
        this.updateState({
          repositories: repos,
          savedRepositories: [...repos]
        });
      }),
      catchError(error => {
        this.handleError(
          error,
          'Failed to load repositories from backend',
          true,
          gettext('Failed to load repositories. Please refresh the page.')
        );
        return of([]);
      })
    );
  }

  private async fetchRepositoriesFromBackend(): Promise<Repository[]> {
    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONFIGURATION_ENDPOINT}`,
        {
          headers: { 'content-type': 'application/json' },
          method: 'GET'
        }
      );

      if (!response.ok) {
        throw new RepositoryError(
          `Failed to fetch repositories: ${response.status}`,
          gettext('Failed to load repositories from server.')
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to fetch repositories',
        gettext('Failed to connect to server. Please check your connection.'),
        error
      );
    }
  }

  // ============================================================================
  // Private Methods - State Management
  // ============================================================================

  private updateState(partial: Partial<RepositoryState>): void {
    const current = this.state$.value;
    this.state$.next({ ...current, ...partial });
  }

  private invalidateCache(): void {
    this.clearCache();
    this.reloadTrigger$.next();
  }

  private clearCache(): void {
    this.blockCache.clear();
    this.fqnCache.clear();
  }

  private areRepositoriesEqual(a: Repository[], b: Repository[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((repo, index) =>
      repo.id === b[index].id &&
      repo.enabled === b[index].enabled &&
      repo.name === b[index].name &&
      repo.url === b[index].url
    );
  }

  // ============================================================================
  // Private Methods - Repository Items
  // ============================================================================

  private loadRepositoryItemsWithStatus(
    hideInstalled: boolean
  ): Observable<RepositoryItem[]> {
    return combineLatest([
      this.repositories$,
      from(this.analyticsService.getDeployedBlocks()).pipe(
        catchError(error => {
          console.warn('Failed to get deployed blocks:', error);
          return of([]);
        })
      )
    ]).pipe(
      switchMap(([repos, loaded]) =>
        this.processRepositoryItems(repos, loaded, hideInstalled)
      )
    );
  }

  private processRepositoryItems(
    repos: Repository[],
    loaded: CepBlock[],
    hideInstalled: boolean
  ): Observable<RepositoryItem[]> {
    const enabledRepos = repos.filter(repo => repo.enabled);

    if (!enabledRepos.length) {
      return of([]);
    }

    return forkJoin(
      enabledRepos.map(repo => this.getCachedRepositoryItems(repo))
    ).pipe(
      map(blocks =>
        this.addInstallationStatus(blocks.flat(), loaded, hideInstalled)
      ),
      catchError(error => {
        this.handleError(
          error,
          'Failed to process repository items',
          true,
          gettext('Failed to load repository items. Please try again.')
        );
        return of([]);
      })
    );
  }

  private getCachedRepositoryItems(
    repository: Repository
  ): Observable<RepositoryItem[]> {
    if (!this.blockCache.has(repository.id)) {
      const items$ = this.fetchRepositoryItems(repository).pipe(
        shareReplay({ bufferSize: 1, refCount: true })
      );
      this.blockCache.set(repository.id, items$);
    }
    return this.blockCache.get(repository.id)!;
  }

  private fetchRepositoryItems(
    repository: Repository
  ): Observable<RepositoryItem[]> {
    return from(this.getGitHubContent(repository)).pipe(
      switchMap(data => this.processGitHubContent(data, repository)),
      catchError(error => {
        this.handleError(
          error,
          `Failed to fetch items from repository: ${repository.name}`,
          true,
          gettext(`Failed to load items from repository "${repository.name}".`)
        );
        return of([]);
      })
    );
  }

  private async getGitHubContent(repository: Repository): Promise<any[]> {
    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONTENT_LIST_ENDPOINT}`,
        {
          headers: { 'content-type': 'application/json' },
          params: {
            url: encodeURIComponent(repository.url),
            repository_id: repository.id
          },
          method: 'GET'
        }
      );

      if (!response.ok) {
        const errorMessage = await this.extractErrorMessage(response);
        throw new RepositoryError(
          `Failed to get GitHub content: ${response.status}`,
          errorMessage
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to fetch GitHub content',
        gettext('Failed to connect to GitHub. Please check your connection and repository settings.'),
        error
      );
    }
  }

  private async extractErrorMessage(response: IFetchResponse): Promise<string> {
    try {
      const errorData = await response.json();
      return errorData.message || errorData.error || JSON.stringify(errorData);
    } catch {
      return await response.text() || gettext('Unknown error occurred');
    }
  }

  private processGitHubContent(
    data: unknown,
    repository: Repository
  ): Observable<RepositoryItem[]> {
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
      throw this.handleError(
        error,
        'Failed to process GitHub content',
        false
      );
    }
  }

  private enrichRepositoryItem(item: RepositoryItem): Observable<RepositoryItem> {
    if (item.type !== 'file' || !item.file.endsWith('.mon')) {
      return of({ ...item, id: item.file });
    }

    const cacheKey = `${item.repositoryId}::${item.url}`;
    let fqn$ = this.fqnCache.get(cacheKey);
    if (!fqn$) {
      fqn$ = this.getRepositoryItemContent(item, true, true).pipe(
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

  private filterRepositoryItems(blocks: RepositoryItem[]): RepositoryItem[] {
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

  private analyzeRepositoryItems(items: RepositoryItem[]): Observable<RepositoryItem[]> {
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

  private getSectionsFromExtensionYAML(item: RepositoryItem): Observable<string[]> {
    return this.getRepositoryItemContent(item, true, false).pipe(
      map(content => this.parseYamlSections(content)),
      catchError(error => {
        console.warn(`Error processing ${DESCRIPTOR_YAML}:`, error);
        return of([]);
      })
    );
  }

  private createYamlSectionItems(
    sectionNames: string[],
    yamlItem: RepositoryItem
  ): RepositoryItem[] {
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

  // ============================================================================
  // Private Methods - Content Retrieval
  // ============================================================================

  private getItemContentFromBackend(
    block: RepositoryItem,
    extractFQN: boolean
  ): Observable<string> {
    return from(
      this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONTENT_ENDPOINT}`,
        {
          headers: { 'content-type': 'text/plain' },
          params: {
            url: encodeURIComponent(block.url),
            extract_fqn_cep_block: extractFQN.toString(),
            repository_id: block.repositoryId,
            cep_block_name: block.name
          },
          method: 'GET'
        }
      ).then(resp => {
        if (!resp.ok) {
          throw new RepositoryError(
            `Failed to fetch content: ${resp.status}`,
            gettext('Failed to load content from server.')
          );
        }
        return resp.text();
      })
    );
  }

  private getItemContentDirectly(
    block: RepositoryItem,
    extractFQN: boolean
  ): Observable<string> {
    return from(
      fetch(block.downloadUrl, {
        method: 'GET',
        headers: {
          'Content-type': 'application/text',
          'Accept': 'application/vnd.github.raw'
        }
      }).then(async response => {
        if (!response.ok) {
          throw new RepositoryError(
            `Failed to fetch content: ${response.status}`,
            gettext('Failed to download content from GitHub.')
          );
        }
        return response.text();
      })
    ).pipe(
      map(content => extractFQN ? this.extractFQN(content, block) : content),
      catchError(error => {
        throw new RepositoryError(
          'Failed to fetch content directly',
          gettext('Failed to download content from GitHub.'),
          error
        );
      })
    );
  }

  private extractFQN(content: string, block: RepositoryItem): string {
    const regex = /(?<=^package\s)(.*?)(?=;)/gm;
    const match = content.match(regex);

    if (match && match[0]) {
      const packageName = match[0].trim();
      const className = block.name.slice(0, -4);
      return `${packageName}.${className}`;
    }

    throw new RepositoryError(
      'Could not extract FQN from content',
      gettext('Failed to extract block information from file.')
    );
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
        error
      );
    }
  }

  // ============================================================================
  // Private Methods - Backend Operations
  // ============================================================================

  private async saveRepositoriesToBackend(
    repositories: Repository[]
  ): Promise<void> {
    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONFIGURATION_ENDPOINT}`,
        {
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify(repositories),
          method: 'POST'
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new RepositoryError(
          `Failed to save repositories: ${response.status}`,
          errorText || gettext('Failed to save repositories to server.')
        );
      }
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to save repositories',
        gettext('Failed to connect to server. Please check your connection.'),
        error
      );
    }
  }

  private async createExtension(
    endpoint: string,
    request: unknown
  ): Promise<IFetchResponse> {
    // Type narrowing for request
    if (!request || typeof request !== 'object') {
      throw new RepositoryError(
        'Invalid extension request',
        gettext('Invalid extension data provided.')
      );
    }

    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${EXTENSION_ENDPOINT}/${endpoint}`,
        {
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify(request),
          method: 'POST',
          responseType: 'blob'
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new RepositoryError(
          `Failed to create extension: ${response.status}`,
          errorText || gettext('Failed to create extension on server.')
        );
      }

      return response;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to create extension',
        gettext('Failed to create extension. Please try again.'),
        error
      );
    }
  }

  // ============================================================================
  // Private Methods - Error Handling
  // ============================================================================

  /**
   * Centralized error handling
   */
  private handleError(
    error: unknown,
    logMessage: string,
    showAlert: boolean = false,
    userMessage?: string
  ): Error {
    console.error(`[RepositoryService] ${logMessage}:`, error);

    if (showAlert) {
      const message = userMessage || this.getErrorMessage(error);
      this.alertService.danger(message);
    }

    if (error instanceof RepositoryError) {
      return error;
    }

    return new RepositoryError(
      logMessage,
      userMessage || this.getErrorMessage(error),
      error instanceof Error ? error : undefined
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof RepositoryError) {
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

  private handleTestError(_error: unknown): RepositoryTestResult {
    // fetch() only rejects on network errors (DNS, CORS, abort); status-code mapping
    // happens in mapTestStatusToResult against response.status.
    return {
      success: false,
      message: gettext('Failed to connect to repository. Please check your connection and try again.')
    };
  }
}