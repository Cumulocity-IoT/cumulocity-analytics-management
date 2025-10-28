// repository.service.ts

import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  FetchClient,
  IFetchResponse,
} from '@c8y/client';
import { AlertService, gettext } from '@c8y/ngx-components';
import * as _ from 'lodash';
import { BehaviorSubject, EMPTY, forkJoin, from, Observable, of } from 'rxjs';
import { catchError, combineLatestWith, map, shareReplay, switchMap, take, tap } from 'rxjs/operators';
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
import { getFileExtension, githubWebUrlToContentApi, removeFileExtension, uuidCustom } from './utils';
import * as jsyaml from 'js-yaml';

@Injectable({
  providedIn: 'root'
})
export class RepositoryService {
  private readonly currentRepositories$ = new BehaviorSubject<Repository[]>([]);
  private savedRepositories: Repository[] = []; // Keep track of saved state for enabled status comparison
  private readonly blockCache = new Map<string, Observable<RepositoryItem[]>>();
  private readonly reloadTrigger$ = new BehaviorSubject<void>(undefined);
  private hideInstalled = false;

  readonly repositoryItems$ = this.reloadTrigger$.pipe(
    switchMap(() => this.loadRepositoryItemsWithStatus()),
    shareReplay(1)
  );

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly alertService: AlertService,
    private readonly httpClient: HttpClient,
    private readonly fetchClient: FetchClient
  ) {
    this.initializeRepositories();
  }

  private initializeRepositories(): void {
    this.loadRepositoriesFromBackend().subscribe();
  }

  getRepositories(): Observable<Repository[]> {
    return this.currentRepositories$.asObservable();
  }

  /**
   * Add a new repository - calls backend immediately
   */
  async addRepository(repository: Repository): Promise<void> {
    try {
      const current = this.currentRepositories$.value;
      const updated = [...current, repository];
      
      await this.saveRepositoriesToBackend(updated);
      
      // Update both local and saved state after successful backend call
      this.currentRepositories$.next(updated);
      this.savedRepositories = _.cloneDeep(updated);
      this.clearCache();
      this.reloadTrigger$.next();
      
      this.alertService.success(gettext('Repository added successfully'));
    } catch (error) {
      this.alertService.danger('Failed to add repository', error.message);
      throw error;
    }
  }

  /**
   * Update an existing repository - calls backend immediately
   * Note: This is for updating repository details (name, url, token), not enabled status
   */
  async updateRepository(updatedRepository: Repository): Promise<void> {
    try {
      const current = this.currentRepositories$.value;
      const index = current.findIndex(repo => repo.id === updatedRepository.id);

      if (index === -1) {
        throw new Error('Repository not found');
      }

      const updated = [
        ...current.slice(0, index),
        updatedRepository,
        ...current.slice(index + 1)
      ];

      await this.saveRepositoriesToBackend(updated);
      
      // Update both local and saved state after successful backend call
      this.currentRepositories$.next(updated);
      this.savedRepositories = _.cloneDeep(updated);
      this.clearCache();
      this.reloadTrigger$.next();
      
      this.alertService.success(gettext('Repository updated successfully'));
    } catch (error) {
      this.alertService.danger('Failed to update repository', error.message);
      throw error;
    }
  }

  /**
   * Toggle repository enabled status - LOCAL ONLY (not saved to backend)
   * When enabling a repository, automatically disable all others
   */
  toggleRepositoryEnabled(repositoryId: string): void {
    const current = this.currentRepositories$.value;
    const targetRepo = current.find(repo => repo.id === repositoryId);
    
    if (!targetRepo) {
      console.error('Repository not found:', repositoryId);
      return;
    }

    const newEnabledState = !targetRepo.enabled;
    
    // Update all repositories: enable the target, disable all others if target is being enabled
    const updated = current.map(repo => {
      if (repo.id === repositoryId) {
        return { ...repo, enabled: newEnabledState };
      } else if (newEnabledState && repo.enabled) {
        // Disable other repositories when enabling the target
        return { ...repo, enabled: false };
      }
      return repo;
    });

    // Update only local state, do NOT save to backend
    this.currentRepositories$.next(updated);
    
    // Trigger repository items reload with new enabled state
    this.clearCache();
    this.reloadTrigger$.next();
  }

  /**
   * Save all current repository states (including enabled status) to backend
   */
  async saveAllRepositories(): Promise<void> {
    try {
      const current = this.currentRepositories$.value;
      await this.saveRepositoriesToBackend(current);
      
      // Update saved state to match current state
      this.savedRepositories = _.cloneDeep(current);
      
      this.alertService.success(gettext('Repositories saved successfully'));
    } catch (error) {
      this.alertService.danger('Failed to save repositories', error.message);
      throw error;
    }
  }

  /**
   * Check if there are unsaved changes in enabled status
   */
  hasUnsavedEnabledChanges(): boolean {
    const current = this.currentRepositories$.value;
    
    // Check if enabled states differ between current and saved
    return current.some(repo => {
      const savedRepo = this.savedRepositories.find(sr => sr.id === repo.id);
      return savedRepo && savedRepo.enabled !== repo.enabled;
    });
  }

  /**
   * Cancel unsaved enabled status changes and revert to last saved state
   */
  cancelEnabledChanges(): void {
    this.currentRepositories$.next(_.cloneDeep(this.savedRepositories));
    this.clearCache();
    this.reloadTrigger$.next();
  }

  /**
   * Delete a repository - calls backend immediately
   */
  async deleteRepository(repositoryId: string): Promise<void> {
    try {
      const current = this.currentRepositories$.value;
      const updated = current.filter(repo => repo.id !== repositoryId);

      await this.saveRepositoriesToBackend(updated);
      
      // Update both local and saved state after successful backend call
      this.currentRepositories$.next(updated);
      this.savedRepositories = _.cloneDeep(updated);
      this.clearCache();
      this.reloadTrigger$.next();
      
      this.alertService.success(gettext('Repository deleted successfully'));
    } catch (error) {
      this.alertService.danger('Failed to delete repository', error.message);
      throw error;
    }
  }

  /**
   * Test repository connection without saving
   */
  async testRepository(testRepository: Repository): Promise<RepositoryTestResult> {
    const headers = new HttpHeaders({
      'Accept': 'application/vnd.github.v3.raw',
      'Authorization': `Bearer ${testRepository.accessToken}`
    });

    const testUrl = githubWebUrlToContentApi(testRepository.url);
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
              message: `Failed to connect to repository. Status: ${error.status}`,
              status: error.status
            };
        }
      }

      return {
        success: false,
        message: 'Failed to connect to repository. Please check your connection and try again.'
      };
    }
  }

  /**
   * Reload repositories from backend (useful for refresh)
   */
  async refreshRepositories(): Promise<void> {
    try {
      await this.loadRepositoriesFromBackend().pipe(take(1)).toPromise();
      this.clearCache();
      this.reloadTrigger$.next();
      this.alertService.success(gettext('Repositories refreshed successfully'));
    } catch (error) {
      this.alertService.danger('Failed to refresh repositories', error.message);
      throw error;
    }
  }

  /**
   * Private method to save repositories to backend
   */
  private async saveRepositoriesToBackend(repositories: Repository[]): Promise<void> {
    const response = await this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${REPOSITORY_CONFIGURATION_ENDPOINT}`,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify(repositories),
        method: 'POST',
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || 'Failed to save repositories');
    }
  }

  /**
   * Load repositories from backend and update local state
   */
  private loadRepositoriesFromBackend(): Observable<Repository[]> {
    return from(this.fetchRepositoriesFromBackend()).pipe(
      tap(repos => {
        this.currentRepositories$.next(repos);
        this.savedRepositories = _.cloneDeep(repos); // Initialize saved state
      }),
      catchError(error => {
        this.alertService.danger('Failed to load repositories', error.message);
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

  /**
   * Clear the block cache when repositories change
   */
  private clearCache(): void {
    this.blockCache.clear();
  }

  getRepositoryItems(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      map(blocks => {
        const hasExtensionsYaml = blocks.some(block =>
          block.type !== 'dir' && block.file && block.file.toLowerCase() === DESCRIPTOR_YAML
        );

        if (hasExtensionsYaml) {
          return blocks.filter(block =>
            block.type !== 'dir' && block.file && block.file.toLowerCase() === DESCRIPTOR_YAML
          );
        } else {
          return blocks.filter(block =>
            block.type === 'dir' && !block.file.startsWith(".") ||
            (block.file && (
              block.file.toLowerCase().endsWith('.mon')
            ))
          );
        }
      })
    );
  }

  getRepositoryItemsAnalyzed(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      switchMap(items => {
        const itemExtensionsYaml = items.filter(block =>
          block.type !== 'dir' && block.file && block.file.toLowerCase() === DESCRIPTOR_YAML
        );

        if (itemExtensionsYaml && itemExtensionsYaml.length > 0) {
          const extensionsYamlItem = itemExtensionsYaml[0];
          return this.getSectionsFromExtensionYAML(extensionsYamlItem).pipe(
            map(sectionNames => {
              const uuids = sectionNames.map(() => uuidCustom());
              return sectionNames.map((name, index) => {
                return {
                  ...extensionsYamlItem,
                  id: uuids[index],
                  name: name,
                  isYamlSection: true,
                  extensionsYamlItem
                };
              });
            })
          );
        } else {
          return of(items.filter(item =>
            item.type === 'dir' && !item.file.startsWith(".") ||
            (item.file && (
              item.file.toLowerCase().endsWith('.mon')
            ))
          ));
        }
      })
    );
  }

  updateRepositoryItems(hideInstalled: boolean): void {
    this.hideInstalled = hideInstalled;
    this.reloadTrigger$.next();
  }

  // Helper methods to break down the logic
  private loadRepositoryItemsWithStatus() {
    return this.currentRepositories$.pipe(
      combineLatestWith(from(this.analyticsService.getLoadedBlocksFromCEP())),
      switchMap(([repos, loaded]) => this.processRepositoryItems(repos, loaded))
    );
  }

  private processRepositoryItems(repos: Repository[], loaded: any[]): Observable<RepositoryItem[]> {
    const enabledRepos = repos.filter(repo => repo.enabled);
    if (!enabledRepos.length) return of([]);

    return forkJoin(
      enabledRepos.map(repo => this.getCachedRepositoryItems(repo))
    ).pipe(
      map(blocks => this.processRepositoryItemsWithStatus(blocks.flat(), loaded))
    );
  }

  private getCachedRepositoryItems(repository: Repository): Observable<RepositoryItem[]> {
    if (!this.blockCache.has(repository.id)) {
      this.blockCache.set(
        repository.id,
        this.fetchRepositoryItems(repository).pipe(shareReplay(1))
      );
    }
    return this.blockCache.get(repository.id);
  }

  private fetchRepositoryItems(repository: Repository): Observable<RepositoryItem[]> {
    return from(this.getGitHubContent(repository)).pipe(
      // tap(qq => { console.log("Hello III", qq.flat()) }),
      switchMap(data => this.processGitHubContent(data, repository)),
      catchError(error => {
        this.handleError(error);
        return EMPTY;
      })
    );
  }

  private async getGitHubContent(repository: Repository): Promise<RepositoryItem[]> {
    const response = await this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${REPOSITORY_CONTENT_LIST_ENDPOINT}`,
      {
        headers: { 'content-type': 'application/json' },
        params: {
          url: encodeURIComponent(repository.url),
          repository_id: repository.id,
        },
        method: 'GET'
      }
    );

    if (!response.ok) {
      try {
        const errorData = await response.json();
        const errorMessage = errorData.message || errorData.error || JSON.stringify(errorData);
        throw new Error(errorMessage);
      } catch (parseError) {
        const errorText = parseError.message;
        throw new Error(errorText);
      }
    }

    return response.json();
  }

  private processGitHubContent(data: any, repository: Repository): Observable<RepositoryItem[]> {
    const blocks = Object.values(data)
      .filter(item => getFileExtension(item['name']) !== '.json')
      .map(item => this.createRepositoryItem(item, repository));

    return forkJoin(
      blocks.map(block => {
        if (block.type === 'file' && block.file.endsWith('.mon')) {
          return this.getRepositoryItemContent(block, true, true).pipe(
            map(fqn => ({ ...block, id: fqn }))
          );
        } else {
          return of({ ...block, id: block.file });
        }
      })
    );
  }

  getRepositoryItemContent(
    block: RepositoryItem,
    backend: boolean,
    extractFQN_CEP_Block: boolean
  ): Observable<string> {
    if (backend) {
      return from(this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONTENT_ENDPOINT}`,
        {
          headers: {
            'content-type': 'text/plain'
          },
          params: {
            url: encodeURIComponent(block.url),
            extract_fqn_cep_block: extractFQN_CEP_Block,
            repository_id: block.repositoryId,
            cep_block_name: block.name
          },
          method: 'GET'
        }
      ).then(
        resp => resp.text()
      ))
    } else {
      return this.httpClient
        .get(block.downloadUrl, {
          headers: {
            'Content-type': 'application/text',
            Accept: 'application/vnd.github.raw'
          },
          responseType: 'text'
        })
        .pipe(
          map(result => {
            if (extractFQN_CEP_Block) {
              const regex = /(?<=^package\s)(.*?)(?=;)/gm;
              const match = result.match(regex);
              const fqn = `${match[0].trim()}.${block.name.slice(0, -4)}`;
              return fqn;
            }
            return result;
          })
        );
    }
  }

  private createRepositoryItem(item: any, repository: Repository): CEP_Block {
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
    };
  }

  private processRepositoryItemsWithStatus(blocks: RepositoryItem[], loaded: any[]): RepositoryItem[] {
    const loadedIds = new Set(loaded.map(block => block.id));
    return this.hideInstalled
      ? blocks.filter(block => !loadedIds.has(block.id))
      : blocks.map(block => ({ ...block, installed: loadedIds.has(block.id) }));
  }

  private handleError(error: HttpErrorResponse): void {
    const message = error.status
      ? `Backend returned code ${error.status}: ${error.message}`
      : error.message;
    this.alertService.danger(message);
  }

  public getSectionsFromExtensionYAML(item: RepositoryItem): Observable<any[] | string[]> {
    let extensionNames;
    return this.getRepositoryItemContent(
      item,
      true,
      false
    ).pipe(
      map(content => {
        try {
          const yamlContent = jsyaml.load(content);

          if (yamlContent && typeof yamlContent === 'object') {
            return Object.keys(yamlContent);
          } else {
            console.warn(`Invalid YAML content structure in ${DESCRIPTOR_YAML}`);
            return [];
          }
        } catch (error) {
          console.error(`Error parsing ${DESCRIPTOR_YAML} content:`, error);
          return [];
        }
      }),
      tap(exN => {
        console.log('Available extensions:', extensionNames);
        extensionNames = exN;
      }),
      catchError(error => {
        console.error(`Error processing${DESCRIPTOR_YAML} content:`, error);
        return of([]);
      })
    );
  }

  async createExtensionFromList(
    name: string,
    monitors: RepositoryItem[],
    repository: Repository,
    upload: boolean,
    deploy: boolean,
  ): Promise<IFetchResponse> {
    console.log('Create extensions for:', name, monitors);
    return this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${EXTENSION_ENDPOINT}/list`,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          extension_name: name,
          monitors: monitors,
          repository: repository,
          upload: upload,
          deploy: deploy,
        }),
        method: 'POST',
        responseType: 'blob'
      }
    );
  }

  async createExtensionFromYaml(
    name: string,
    yaml: RepositoryItem,
    sections: string[],
    repository: Repository,
    upload: boolean,
    deploy: boolean,
  ): Promise<IFetchResponse> {
    console.log('Create extensions for:', name, yaml);
    return this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${EXTENSION_ENDPOINT}/yaml`,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          extension_name: name,
          yaml,
          sections,
          repository,
          upload,
          deploy,
        }),
        method: 'POST',
        responseType: 'blob'
      }
    );
  }

  async createExtensionFromRepository(
    name: string,
    upload: boolean,
    deploy: boolean,
    repository: Repository
  ): Promise<IFetchResponse> {
    console.log('Create extensions for:', name, repository);
    return this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${EXTENSION_ENDPOINT}/repository`,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          extension_name: name,
          upload: upload,
          deploy: deploy,
          repository: repository
        }),
        method: 'POST',
        responseType: 'blob'
      }
    );
  }
}