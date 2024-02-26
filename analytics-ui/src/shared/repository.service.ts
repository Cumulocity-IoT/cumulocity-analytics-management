// repository.service.ts

import { Injectable } from "@angular/core";
import { BehaviorSubject, EMPTY, Observable } from "rxjs";
import {
  ANALYTICS_REPOSITORIES_TYPE,
  BACKEND_PATH_BASE,
  CEP_Block,
  REPOSITORY_ENDPOINT,
  REPO_SAMPLES,
  Repository,
} from "./analytics.model";
import {
  FetchClient,
  IFetchResponse,
  IManagedObject,
  InventoryService,
} from "@c8y/client";
import { AlertService, gettext } from "@c8y/ngx-components";
import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { catchError, map } from "rxjs/operators";
import * as _ from "lodash";
import { AnalyticsService } from "./analytics.service";
import { getFileExtension, removeFileExtension } from "./utils";

@Injectable({
  providedIn: "root",
})
export class RepositoryService {
  private repositories: Repository[] = [];
  private repositoriesSubject: BehaviorSubject<Repository[]> =
    new BehaviorSubject<Repository[]>([]);
  private _repositories: Promise<Repository[]> | Repository[];
  private _cep_block_cache: Map<string, Promise<CEP_Block[]>> = new Map();
  private _isDirty: boolean = false;

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
      const filter: object = {
        pageSize: 100,
        withTotalPages: true,
      };
      const query: object = {
        type: ANALYTICS_REPOSITORIES_TYPE,
      };
      let { data } = await this.inventoryService.listQuery(query, filter);
      if (!data || data.length == 0) {
        const reposMO: Partial<IManagedObject> = {
          name: "AnalyticsRepositories",
          type: ANALYTICS_REPOSITORIES_TYPE,
        };
        reposMO[ANALYTICS_REPOSITORIES_TYPE] = REPO_SAMPLES;
        this.inventoryService.create(reposMO);
        repositories = reposMO[ANALYTICS_REPOSITORIES_TYPE];
      } else if (data.length > 0) {
        repositories = data[0][ANALYTICS_REPOSITORIES_TYPE];
      }
      this._repositories = Promise.resolve(repositories);
    }
    return this._repositories;
  }

  async saveRepositories(repositories: Repository[]): Promise<void> {
    if (this._isDirty) {
      const filter: object = {
        pageSize: 100,
        withTotalPages: true,
      };
      const query: object = {
        type: ANALYTICS_REPOSITORIES_TYPE,
      };
      let { data } = await this.inventoryService.listQuery(query, filter);
      if (!data || data.length == 0) {
        const reposMO: Partial<IManagedObject> = {
          name: "AnalyticsRepositories",
          type: ANALYTICS_REPOSITORIES_TYPE,
        };
        reposMO[ANALYTICS_REPOSITORIES_TYPE] = repositories;
        this.inventoryService.create(reposMO);
      } else if (data.length > 0) {
        data[0][ANALYTICS_REPOSITORIES_TYPE] = repositories;
        this.inventoryService.update(data[0]);
      }
      this._repositories = repositories;
      this._isDirty = false;

      this.alertService.success(gettext(`Updated repositories successfully‚`));
    }
  }

  async resolveFullyQualified_CEP_Block_name(
    block: CEP_Block,
    rep: Repository
  ): Promise<string> {
    let fqn = await this.getCEP_BlockContent(block, true, true);
    return fqn;
  }

  async getCEP_BlockContent(
    block: CEP_Block,
    backend: boolean,
    extractFQN_CEP_Block: boolean
  ): Promise<string> {
    let result;
    if (backend) {
      const response: IFetchResponse = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_ENDPOINT}/any_repository/content`,
        {
          headers: {
            "content-type": "text/plain",
          },
          params: {
            url: encodeURIComponent(block.downloadUrl),
            extract_fqn_cep_block: extractFQN_CEP_Block,
            cep_block_name: block.name,
          },
          method: "GET",
        }
      );
      result = response.text();
    } else {
      result = this.githubFetchClient
        .get(block.downloadUrl, {
          headers: {
            // "content-type": "application/json",
            "Content-type": "application/text",
            Accept: "application/vnd.github.raw",
          },
          responseType: "text",
        })
        .toPromise();
      if (extractFQN_CEP_Block) {
        const regex = /(?<=^package\s)(.*?)(?=;)/gm;
        const match = result.match(regex);
        let fqn = match[0].trim() + "." + block.name.slice(0, -4);
        result = fqn;
      }
    }
    return result;
  }

  async getCEP_BlockSamples(rep: Repository): Promise<CEP_Block[]> {
    if (!this._cep_block_cache || !this._cep_block_cache.get(rep.id)) {
      console.log(`Looking for samples ${rep.id} - ${rep.name}`);
      this._cep_block_cache.set(rep.id, this.getCEP_BlockSamplesUncached(rep));
    }
    return this._cep_block_cache.get(rep.id);
  }

  async getCEP_BlockSamplesUncached(rep: Repository): Promise<CEP_Block[]> {
    const result: any = this.githubFetchClient
      .get(rep.url, {
        headers: {
          "content-type": "application/json",
        },
      })
      .pipe(
        map(async (data) => {
          let dataArray = _.values(data);
          const blocks = [];
          for (let index = 0; index < dataArray.length; index++) {
            if (getFileExtension(dataArray[index].name) != ".json") {
              const tb: any = {
                repositoryName: rep.name,
                name: removeFileExtension(dataArray[index].name),
                custom: true,
                downloadUrl: dataArray[index].download_url,
                url: dataArray[index].url,
              };
              tb.id = await this.resolveFullyQualified_CEP_Block_name(tb, rep);
              blocks.push(tb);
              // console.log(`FQN:`, tb);
            }
          }
          return blocks;
        }),
        catchError(this.handleError)
      )
      .toPromise();
    return result;
  }

  private handleError(error: HttpErrorResponse) {
    if (error.status === 0) {
      // A client-side or network error occurred. Handle it accordingly.
      console.error("An error occurred. Ignoring repository:", error.error);
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

  async getAll_CEP_BlockSamples(hideInstalled: boolean): Promise<CEP_Block[]> {
    const promises: Promise<CEP_Block[]>[] = [];
    const reps: Repository[] = await this.loadRepositories();
    const loadedBlocks = await this.analyticsService.getLoadedCEP_Blocks();
    const loadedBlocksIds: string[] = loadedBlocks.map((block) => block.id);

    for (let i = 0; i < reps.length; i++) {
      if (reps[i].enabled) {
        const promise: Promise<CEP_Block[]> = this.getCEP_BlockSamples(reps[i]);
        promises.push(promise);
      }
    }
    const combinedPromise = Promise.all(promises);
    let result;
    let resultUnfiltered = await combinedPromise.then((data) => {
      const flattened = data.reduce(
        (accumulator, value) => accumulator.concat(value),
        []
      );
      return flattened;
    });
    if (hideInstalled) {
      result = resultUnfiltered.filter(
        (block) => !loadedBlocksIds.includes(block.id)
      );
    } else {
      result = resultUnfiltered;
    }
    result.forEach(
      (block: CEP_Block) =>
        (block.installed = loadedBlocksIds.includes(block.id))
    );
    return result;
  }
}
