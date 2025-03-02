// repository.service.ts

import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  FetchClient,
} from '@c8y/client';
import { AlertService, gettext } from '@c8y/ngx-components';
import * as _ from 'lodash';
import { BehaviorSubject, EMPTY, forkJoin, from, Observable, of } from 'rxjs';
import { catchError, combineLatestWith, map, shareReplay, switchMap, take, tap } from 'rxjs/operators';
import {
  BACKEND_PATH_BASE,
  CEP_Block,
  Repository,
  REPOSITORY_CONFIGURATION_ENDPOINT,
  REPOSITORY_CONTENT_ENDPOINT,
  REPOSITORY_CONTENT_LIST_ENDPOINT,
  RepositoryTestResult
} from './analytics.model';
import { AnalyticsService } from './analytics.service';
import { getFileExtension, githubWebUrlToContentApi, removeFileExtension } from './utils';

@Injectable({
  providedIn: 'root'
})
export class RepositoryService {
  private readonly currentRepositories$ = new BehaviorSubject<Repository[]>([]);
  private originalRepositories: Repository[] = [];
  private readonly blockCache = new Map<string, Observable<CEP_Block[]>>();
  private readonly reloadTrigger$ = new BehaviorSubject<void>(undefined);
  private hideInstalled = false;

  readonly cepBlockSamples$ = this.reloadTrigger$.pipe(
    switchMap(() => this.loadBlocksWithStatus()),
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
    this.loadRepositories().pipe(
      tap(repos => {
        this.originalRepositories = _.cloneDeep(repos); // Deep clone to preserve original state
        this.currentRepositories$.next(repos);
      }),
      take(1)
    ).subscribe();
  }

  getRepositories(): Observable<Repository[]> {
    return this.currentRepositories$.asObservable();
  }

  addRepository(repository: Repository): void {
    const current = this.currentRepositories$.value;
    this.currentRepositories$.next([...current, repository]);
  }

// repository.service.ts

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

  updateRepository(updatedRepository: Repository): void {
    const current = this.currentRepositories$.value;
    const index = current.findIndex(repo => repo.id === updatedRepository.id);

    if (index !== -1) {
      const updated = [
        ...current.slice(0, index),
        updatedRepository,
        ...current.slice(index + 1)
      ];
      this.currentRepositories$.next(updated);
    }
  }

  deleteRepository(repositoryId: string): void {
    const current = this.currentRepositories$.value;
    this.currentRepositories$.next(
      current.filter(repo => repo.id !== repositoryId)
    );
  }

  // Cancel all changes and revert to last saved state
  cancelChanges(): void {
    this.currentRepositories$.next(_.cloneDeep(this.originalRepositories));
    this.reloadTrigger$.next();
  }

  // Check if there are unsaved changes
  hasUnsavedChanges(): boolean {
    return !_.isEqual(this.originalRepositories, this.currentRepositories$.value);
  }

  async updateRepositories(): Promise<void> {
    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONFIGURATION_ENDPOINT}`,
        {
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify(this.currentRepositories$.value),
          method: 'POST',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to save repositories');
      }

      // Update original repositories after successful save
      this.originalRepositories = _.cloneDeep(this.currentRepositories$.value);
      this.alertService.success(gettext('Updated repositories successfully'));
    } catch (error) {
      this.alertService.danger('Failed to save repositories', error.message);
      throw error;
    }
  }

  private loadRepositories(): Observable<Repository[]> {
    return from(this.fetchRepositoriesFromBackend()).pipe(
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
    return response.json();
  }

  getCEP_BlockSamples(): Observable<CEP_Block[]> {
    return this.cepBlockSamples$;
  }

  updateCEP_BlockSamples(hideInstalled: boolean): void {
    this.hideInstalled = hideInstalled;
    this.reloadTrigger$.next();
  }

  // Helper methods to break down the logic
  private loadBlocksWithStatus() {
    return from(this.loadRepositories()).pipe(
      combineLatestWith(from(this.analyticsService.getLoadedBlocksFromCEP())),
      switchMap(([repos, loaded]) => this.processBlocks(repos, loaded))
    );
  }

  private processBlocks(repos: Repository[], loaded: any[]): Observable<CEP_Block[]> {
    const enabledRepos = repos.filter(repo => repo.enabled);
    if (!enabledRepos.length) return of([]);

    return forkJoin(
      enabledRepos.map(repo => this.getCachedBlockSamples(repo))
    ).pipe(
      map(blocks => this.processBlocksWithStatus(blocks.flat(), loaded))
    );
  }

  private getCachedBlockSamples(repository: Repository): Observable<CEP_Block[]> {
    if (!this.blockCache.has(repository.id)) {
      this.blockCache.set(
        repository.id,
        this.fetchBlockSamples(repository).pipe(shareReplay(1))
      );
    }
    return this.blockCache.get(repository.id);
  }

  private fetchBlockSamples(repository: Repository): Observable<CEP_Block[]> {
    return from(this.getGitHubContent(repository)).pipe(
      switchMap(data => this.processGitHubContent(data, repository)),
      catchError(error => {
        this.handleError(error);
        return EMPTY;
      })
    );
  }

  private async getGitHubContent(repository: Repository): Promise<any> {
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
      // Try to get the error message from the response body
      try {
        const errorData = await response.json();
        const errorMessage = errorData.message || errorData.error || JSON.stringify(errorData);
        throw new Error(errorMessage);
      } catch (parseError) {
        // If we can't parse the JSON, fall back to text
        const errorText = parseError.message;
        throw new Error(errorText);
      }
    }

    return response.json();
  }

  private processGitHubContent(data: any, repository: Repository): Observable<CEP_Block[]> {
    const blocks = Object.values(data)
      .filter(item => getFileExtension(item['name']) !== '.json')
      .map(item => this.createCEPBlock(item, repository));

      return forkJoin(
        blocks.map(block => {
          if (block.type === 'file' && block.name.endsWith('.mon')) {
            return this.getCEP_BlockContent(block, true, true).pipe(
              map(fqn => ({ ...block, id: fqn }))
            );
          } else {
            return of({ ...block, id: block.name });
          }
        })
      );
  }

  getCEP_BlockContent(
    block: CEP_Block,
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


  private createCEPBlock(item: any, repository: Repository): CEP_Block {
    // if (!item.name || !item.download_url || !item.url) {
    if (!item.name || !item.url) {
      throw new Error('Missing required properties in GitHub item');
    }
    return {
      id: '', // This will be set later
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

  private processBlocksWithStatus(blocks: CEP_Block[], loaded: any[]): CEP_Block[] {
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
}