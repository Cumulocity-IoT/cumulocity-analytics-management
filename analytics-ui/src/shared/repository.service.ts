import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { FetchClient, IFetchResponse } from '@c8y/client';
import { AlertService, gettext } from '@c8y/ngx-components';
import * as jsyaml from 'js-yaml';
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  combineLatest,
  forkJoin,
  from,
  of,
  throwError
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
  CEP_Block,
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
  githubWebUrlToContentApi,
  removeFileExtension,
  uuidCustom
} from './utils';

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
    private readonly httpClient: HttpClient,
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

  /**
   * Get current repositories as observable
   */
  getRepositories(): Observable<Repository[]> {
    return this.repositories$;
  }

  /**
   * Add a new repository and save to backend
   */
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
      this.handleError('Failed to add repository', error);
      throw error;
    }
  }

  /**
   * Update repository details and save to backend
   */
  async updateRepository(updatedRepository: Repository): Promise<void> {
    const state = this.state$.value;
    const index = state.repositories.findIndex(r => r.id === updatedRepository.id);

    if (index === -1) {
      throw new Error('Repository not found');
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
      this.handleError('Failed to update repository', error);
      throw error;
    }
  }

  /**
   * Toggle repository enabled status (local only, not saved)
   * When enabling a repository, disables all others
   */
  toggleRepositoryEnabled(repositoryId: string): void {
    const state = this.state$.value;
    const targetRepo = state.repositories.find(r => r.id === repositoryId);

    if (!targetRepo) {
      console.error('Repository not found:', repositoryId);
      return;
    }

    const newEnabledState = !targetRepo.enabled;
    const updated = state.repositories.map(repo => {
      if (repo.id === repositoryId) {
        return { ...repo, enabled: newEnabledState };
      }
      // Disable other repos when enabling target
      if (newEnabledState && repo.enabled) {
        return { ...repo, enabled: false };
      }
      return repo;
    });

    this.updateState({ repositories: updated });
    this.invalidateCache();
  }

  /**
   * Save all repository states (including enabled status) to backend
   */
  async saveAllRepositories(): Promise<void> {
    const state = this.state$.value;

    try {
      await this.saveRepositoriesToBackend(state.repositories);
      this.updateState({
        savedRepositories: [...state.repositories]
      });
      this.alertService.success(gettext('Repositories saved successfully'));
    } catch (error) {
      this.handleError('Failed to save repositories', error);
      throw error;
    }
  }

  /**
   * Check if there are unsaved changes
   */
  hasUnsavedChanges(state?: RepositoryState): boolean {
    const currentState = state || this.state$.value;
    return currentState.repositories.some(repo => {
      const saved = currentState.savedRepositories.find(sr => sr.id === repo.id);
      return saved && saved.enabled !== repo.enabled;
    });
  }

  /**
   * Revert to last saved state
   */
  cancelChanges(): void {
    const state = this.state$.value;
    this.updateState({
      repositories: [...state.savedRepositories]
    });
    this.invalidateCache();
  }

  /**
   * Delete a repository and save to backend
   */
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
      this.handleError('Failed to delete repository', error);
      throw error;
    }
  }

  /**
   * Test repository connection without saving
   */
  async testRepository(repository: Repository): Promise<RepositoryTestResult> {
    const headers = new HttpHeaders({
      'Accept': 'application/vnd.github.v3.raw',
      'Authorization': `Bearer ${repository.accessToken}`
    });

    const testUrl = githubWebUrlToContentApi(repository.url);

    try {
      const response = await this.httpClient
        .get(testUrl, {
          headers,
          observe: 'response',
          responseType: 'text'
        })
        .toPromise();

      return {
        success: true,
        message: 'Successfully connected to repository',
        status: response?.status
      };
    } catch (error) {
      return this.handleTestError(error);
    }
  }

  /**
   * Reload repositories from backend
   */
  async refreshRepositories(): Promise<void> {
    try {
      await this.loadRepositoriesFromBackend()
        .pipe(take(1))
        .toPromise();
      this.invalidateCache();
      this.alertService.success(gettext('Repositories refreshed successfully'));
    } catch (error) {
      this.handleError('Failed to refresh repositories', error);
      throw error;
    }
  }

  // ============================================================================
  // Public API - Repository Items
  // ============================================================================

  /**
   * Get filtered repository items
   */
  getRepositoryItems(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      map(blocks => this.filterRepositoryItems(blocks))
    );
  }

  /**
   * Get analyzed repository items (with YAML sections processed)
   */
  getRepositoryItemsAnalyzed(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      switchMap(items => this.analyzeRepositoryItems(items))
    );
  }

  /**
   * Update hide installed filter
   */
  updateHideInstalledFilter(hideInstalled: boolean): void {
    this.updateState({ hideInstalled });
  }

  /**
   * Get content of a repository item
   */
  getRepositoryItemContent(
    block: RepositoryItem,
    useBackend: boolean = true,
    extractFQN: boolean = false
  ): Observable<string> {
    if (useBackend) {
      return this.getItemContentFromBackend(block, extractFQN);
    }
    return this.getItemContentDirectly(block, extractFQN);
  }

  /**
   * Get sections from extension YAML
   */
  private getSectionsFromExtensionYAML(item: RepositoryItem): Observable<string[]> {
    return this.getRepositoryItemContent(item, true, false).pipe(
      map(content => this.parseYamlSections(content)),
      catchError(error => {
        console.error(`Error processing ${DESCRIPTOR_YAML}:`, error);
        return of([]);
      })
    );
  }

  // ============================================================================
  // Public API - Extension Creation
  // ============================================================================

  /**
   * Create extension from list of monitors
   */
  async createExtensionFromList(
    name: string,
    monitors: RepositoryItem[],
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false
  ): Promise<IFetchResponse> {
    const request: CreateExtensionFromListRequest = {
      extension_name: name,
      monitors,
      repository,
      upload,
      deploy
    };

    return this.createExtension('list', request);
  }

  /**
   * Create extension from YAML
   */
  async createExtensionFromYaml(
    name: string,
    yaml: RepositoryItem,
    sections: string[],
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false
  ): Promise<IFetchResponse> {
    const request: CreateExtensionFromYamlRequest = {
      extension_name: name,
      yaml,
      sections,
      repository,
      upload,
      deploy
    };

    return this.createExtension('yaml', request);
  }

  /**
   * Create extension from entire repository
   */
  async createExtensionFromRepository(
    name: string,
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false
  ): Promise<IFetchResponse> {
    const request: CreateExtensionRequest = {
      extension_name: name,
      repository,
      upload,
      deploy
    };

    return this.createExtension('repository', request);
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
        this.handleError('Failed to load repositories', error);
        return of([]);
      })
    );
  }

  private async fetchRepositoriesFromBackend(): Promise<Repository[]> {
    const response = await this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${REPOSITORY_CONFIGURATION_ENDPOINT}`,
      {
        headers: { 'content-type': 'application/json' },
        method: 'GET'
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch repositories');
    }

    return response.json();
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
      from(this.analyticsService.getDeployedBlocks())
    ]).pipe(
      switchMap(([repos, loaded]) => 
        this.processRepositoryItems(repos, loaded, hideInstalled)
      )
    );
  }

  private processRepositoryItems(
    repos: Repository[],
    loaded: CEP_Block[],
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
      )
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
        this.handleError(`Failed to fetch items from ${repository.name}`, error);
        return EMPTY;
      })
    );
  }

  private async getGitHubContent(repository: Repository): Promise<any[]> {
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
      throw new Error(errorMessage);
    }

    return response.json();
  }

  private async extractErrorMessage(response: IFetchResponse): Promise<string> {
    try {
      const errorData = await response.json();
      return errorData.message || errorData.error || JSON.stringify(errorData);
    } catch {
      return await response.text();
    }
  }

  private processGitHubContent(
    data: any,
    repository: Repository
  ): Observable<RepositoryItem[]> {
    const items = Object.values(data)
      .filter((item: any) => getFileExtension(item.name) !== '.json')
      .map((item: any) => this.createRepositoryItem(item, repository));

    return forkJoin(
      items.map(item => this.enrichRepositoryItem(item))
    );
  }

  private enrichRepositoryItem(item: RepositoryItem): Observable<RepositoryItem> {
    if (item.type === 'file' && item.file.endsWith('.mon')) {
      return this.getRepositoryItemContent(item, true, true).pipe(
        map(fqn => ({ ...item, id: fqn }))
      );
    }
    return of({ ...item, id: item.file });
  }

  private createRepositoryItem(item: any, repository: Repository): RepositoryItem {
    if (!item.name || !item.url) {
      throw new Error('Missing required properties in GitHub item');
    }

    return {
      id: '',
      repositoryName: repository.name,
      repositoryId: repository.id,
      name: removeFileExtension(item.name),
      file: item.name,
      type: item.type,
      custom: true,
      downloadUrl: item.download_url,
      url: item.url
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
    loaded: CEP_Block[],
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
      ).then(resp => resp.text())
    );
  }

  private getItemContentDirectly(
    block: RepositoryItem,
    extractFQN: boolean
  ): Observable<string> {
    return this.httpClient.get(block.downloadUrl, {
      headers: {
        'Content-type': 'application/text',
        Accept: 'application/vnd.github.raw'
      },
      responseType: 'text'
    }).pipe(
      map(content => extractFQN ? this.extractFQN(content, block) : content)
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
    throw new Error('Could not extract FQN from content');
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
      console.error(`Error parsing ${DESCRIPTOR_YAML}:`, error);
      return [];
    }
  }

  // ============================================================================
  // Private Methods - Backend Operations
  // ============================================================================

  private async saveRepositoriesToBackend(
    repositories: Repository[]
  ): Promise<void> {
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
      throw new Error(errorText || 'Failed to save repositories');
    }
  }

  private async createExtension(
    endpoint: string,
    request: any
  ): Promise<IFetchResponse> {
    console.log(`Creating extension from ${endpoint}:`, request.extension_name);
    
    return this.fetchClient.fetch(
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
  }

  // ============================================================================
  // Private Methods - Error Handling
  // ============================================================================

  private handleError(message: string, error: any): void {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error(message, error);
    this.alertService.danger(`${message}: ${errorMessage}`);
  }

  private handleTestError(error: any): RepositoryTestResult {
    if (error instanceof HttpErrorResponse) {
      switch (error.status) {
        case 401:
          return {
            success: false,
            message: 'Authentication failed. Please check your access token.',
            status: error.status
          };
        case 404:
          return {
            success: false,
            message: 'Repository not found. Please check the URL.',
            status: error.status
          };
        default:
          return {
            success: false,
            message: `Failed to connect. Status: ${error.status}`,
            status: error.status
          };
      }
    }

    return {
      success: false,
      message: 'Failed to connect. Please check your connection and try again.'
    };
  }
}