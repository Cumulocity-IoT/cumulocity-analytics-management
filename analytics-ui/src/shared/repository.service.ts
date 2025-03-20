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
  private originalRepositories: Repository[] = [];
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

  getRepositoryItems(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      // First map to check if 'extensions.yaml' exists in the array
      map(blocks => {
        // Check if 'extensions.yaml' exists in the blocks array
        const hasExtensionsYaml = blocks.some(block =>
          block.type !== 'dir' && block.file && block.file.toLowerCase() === DESCRIPTOR_YAML
        );

        // If 'extensions.yaml' exists, only return that
        if (hasExtensionsYaml) {
          return blocks.filter(block =>
            block.type !== 'dir' && block.file && block.file.toLowerCase() === DESCRIPTOR_YAML
          );
        }
        // Otherwise, return directories and .mon files
        else {
          return blocks.filter(block =>
            // Type is "dir" OR
            block.type === 'dir' && !block.file.startsWith(".") ||
            // File extension is "mon" or "py"
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
      // Use switchMap instead of map to handle the nested Observable
      switchMap(items => {
        // Check if 'extensions.yaml' exists in the blocks array
        const itemExtensionsYaml = items.filter(block =>
          block.type !== 'dir' && block.file && block.file.toLowerCase() === DESCRIPTOR_YAML
        );

        if (itemExtensionsYaml && itemExtensionsYaml.length > 0) {
          const extensionsYamlItem = itemExtensionsYaml[0];
          // Return the Observable directly since switchMap will flatten it
          return this.getSectionsFromExtensionYAML(extensionsYamlItem).pipe(
            map(sectionNames => {
              // Map each section name to a RepositoryItem
              return sectionNames.map(name => {
                // Create a new repository item by copying properties from the YAML item
                // but replace the name with the section name
                return {
                  ...extensionsYamlItem,
                  id: uuidCustom(),
                  name: name,
                  // Optionally set other properties to indicate this is a YAML section
                  isYamlSection: true,
                  extensionsYamlItem
                };
              });
            })
          );
        } else {
          // Return filtered items as an Observable to match the other branch
          return of(items.filter(item =>
            // Type is "dir" OR
            item.type === 'dir' && !item.file.startsWith(".") ||
            // File extension is "mon" or "py"
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
    return from(this.loadRepositories()).pipe(
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
      // tap( qq => {console.log("Hello I", qq.flat())}),
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
    return this.blockCache.get(repository.id).pipe(
      // tap( qq => {console.log("Hello II", qq.flat())})
    );
  }

  private fetchRepositoryItems(repository: Repository): Observable<RepositoryItem[]> {
    return from(this.getGitHubContent(repository)).pipe(
      tap(qq => { console.log("Hello III", qq.flat()) }),
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
      // Parse content of YAML file and return list of first level entries as string[]
      map(content => {
        try {
          // Parse the YAML content
          const yamlContent = jsyaml.load(content);

          // Extract the first level keys (extension names)
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
        // You can store the result in a class property if needed
        extensionNames = exN;
      }),
      catchError(error => {
        console.error(`Error processing${DESCRIPTOR_YAML} content:`, error);
        return of([]);  // Return empty array in case of error
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