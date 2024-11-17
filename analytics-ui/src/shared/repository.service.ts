// repository.service.ts

import { Injectable } from '@angular/core';
import { BehaviorSubject, EMPTY, forkJoin, from, lastValueFrom, merge, Observable, of, throwError } from 'rxjs';
import {
  ANALYTICS_REPOSITORIES_TYPE,
  BACKEND_PATH_BASE,
  CEP_Block,
  REPOSITORY_CONFIGURATION_ENDPOINT,
  REPOSITORY_CONTENT_ENDPOINT,
  REPO_SAMPLES,
  Repository
} from './analytics.model';
import {
  FetchClient,
  IFetchResponse,
  IManagedObject,
  InventoryService
} from '@c8y/client';
import { AlertService, gettext, IRealtimeDeviceBootstrap } from '@c8y/ngx-components';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, filter, map, switchMap, combineLatestWith, tap, mergeMap, shareReplay } from 'rxjs/operators';
import * as _ from 'lodash';
import { AnalyticsService } from './analytics.service';
import { getFileExtension, removeFileExtension } from './utils';

@Injectable({
  providedIn: 'root'
})
export class RepositoryService {

  private repositories: Repository[] = [];
  private repositoriesSubject: BehaviorSubject<Repository[]> =
    new BehaviorSubject<Repository[]>([]);
  private _repositories: Promise<Repository[]> | Repository[];
  private _cep_block_cache: Map<string, Observable<CEP_Block[]>> = new Map();
  private _isDirty: boolean = false;
  private _hideInstalled = false;
  private _reloadCEPBlockSamples$: BehaviorSubject<any> = new BehaviorSubject(null);
  cepBlockSamples$: Observable<CEP_Block[]>;

  constructor(
    private inventoryService: InventoryService,
    private analyticsService: AnalyticsService,
    public alertService: AlertService,
    private githubFetchClient: HttpClient,
    private fetchClient: FetchClient
  ) {
    this.init();
  }

  async init() {
    this.repositories = await this.loadRepositories();
    this.repositoriesSubject.next([...this.repositories]);
    this.cepBlockSamples$ = merge(
      of(null), // initial load
      this._reloadCEPBlockSamples$ // reload trigger
    ).pipe(
      switchMap(() => from(this.loadRepositories()).pipe(
        combineLatestWith(from(this.analyticsService.getLoadedBlocksFromCEP())),
        switchMap(([repos, loaded]) => {
          const filteredRepos = repos.filter(rep => rep.enabled);
          return forkJoin(
            filteredRepos.map(repo => this.getCEP_BlockSamples(repo))
          ).pipe(
            map(blocksArrays => blocksArrays.flat()),
            map(allBlocks => {
              const loadedIds = loaded.map(block => block.id);
              if (this._hideInstalled) {
                return allBlocks.filter(block => !loadedIds.includes(block.id));
              } else {
                allBlocks.map(block => block.installed = loadedIds.includes(block.id))
              }
              return allBlocks;
            })
          );
        })
      )),
      shareReplay()
    );
  }

  getRepositories(): Observable<Repository[]> {
    return this.repositoriesSubject.asObservable();
  }

  addRepository(repository: Repository): void {
    this.repositories.push(repository);
    this.repositoriesSubject.next([...this.repositories]);
    this._isDirty = true;
  }

  updateRepository(updatedRepository: Repository): void {
    const index = this.repositories.findIndex(
      (repo) => repo.id === updatedRepository.id
    );
    if (index !== -1) {
      this.repositories[index] = updatedRepository;
      this.repositoriesSubject.next([...this.repositories]);
      this._isDirty = true;
    }
  }

  deleteRepository(repositoryId: string): void {
    this.repositories = this.repositories.filter(
      (repo) => repo.id !== repositoryId
    );
    this.repositoriesSubject.next([...this.repositories]);
    this._isDirty = true;
  }

  async loadRepositories(): Promise<Repository[]> {
    if (!this._repositories) {
      let repositories = [] as Repository[];
      const response: IFetchResponse = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONFIGURATION_ENDPOINT}`,
        {
          headers: {
            'content-type': 'application/json'
          },
          method: 'GET'
        }
      );
      const result = await response.json();
      if (!result || result.length == 0) {
        const reposMO: Partial<IManagedObject> = {
          name: 'AnalyticsRepositories',
          type: ANALYTICS_REPOSITORIES_TYPE
        };
        reposMO[ANALYTICS_REPOSITORIES_TYPE] = REPO_SAMPLES;
        this.inventoryService.create(reposMO);
        repositories = reposMO[ANALYTICS_REPOSITORIES_TYPE];
      } else if (result.length > 0) {
        repositories = result;
      }
      this._repositories = Promise.resolve(repositories);
    }
    return this._repositories;
  }

  async saveRepositories(repositories: Repository[]): Promise<void> {
    if (this._isDirty) {
      this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONFIGURATION_ENDPOINT}`,
        {
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify(repositories),
          method: 'POST',
        }
      )
      this._repositories = repositories;
      this._isDirty = false;

      this.alertService.success(gettext('Updated repositories successfully‚'));
    }
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
      ).then (
        resp => resp.text()
      ))
    } else {
      return this.githubFetchClient
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

  getCEP_BlockSamples(rep: Repository): Observable<CEP_Block[]> {
    if (!this._cep_block_cache || !this._cep_block_cache.get(rep.id)) {
      console.log(`Looking for samples ${rep.id} - ${rep.name}`);
      this._cep_block_cache.set(rep.id, this.getCEP_BlockSamplesUncached(rep));
    }
    return this._cep_block_cache.get(rep.id);
  }

  getCEP_BlockSamplesUncached(rep: Repository): Observable<CEP_Block[]> {
    return this.githubFetchClient
      .get(rep.url, {
        headers: {
          'content-type': 'application/json'
        }
      })
      .pipe(
        switchMap((data) => {
          const dataArray = _.values(data);
          const blocks: CEP_Block[] = dataArray
            .filter(item => getFileExtension(item.name) !== '.json')
            .map(item => ({
              repositoryName: rep.name,
              repositoryId: rep.id,
              name: removeFileExtension(item.name),
              custom: true,
              downloadUrl: item.download_url,
              url: item.url
            } as CEP_Block));

          // Create an array of Observables for resolving FQNs
          const fqnObservables = blocks.map(block =>
            this.getCEP_BlockContent(block, true, true).pipe(
              map(fqn => {
                block.id = fqn;
                return block;
              })
            )
          );

          // Wait for all FQN resolutions to complete
          return forkJoin(fqnObservables);
        }),
        catchError(this.handleError)
      );
  }

  private handleError(error: HttpErrorResponse) {
    if (error.status === 0) {
      // A client-side or network error occurred. Handle it accordingly.
      console.error('An error occurred. Ignoring repository:', error.error);
    } else {
      // The backend returned an unsuccessful response code.
      // The response body may contain clues as to what went wrong.
      console.error(
        `Backend returned code ${error.status}.  Ignoring repository. Error body was: `,
        error.error
      );
    }
    return EMPTY;
  }

  getAll_CEP_BlockSamples(): Observable<CEP_Block[]> {
    return this.cepBlockSamples$;
  }

  updateCEP_BlockSamples(hideInstalled: boolean) {
    this._hideInstalled = hideInstalled;
    this._reloadCEPBlockSamples$.next(null);
  }
}
