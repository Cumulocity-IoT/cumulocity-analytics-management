// repository.service.ts

import { Injectable } from "@angular/core";
import { BehaviorSubject, EMPTY, Observable } from "rxjs";
import {
  ANALYTICS_REPOSITORIES_TYPE,
  BASE_BACKEND_URL,
  CEP_Block,
  REPOSITORY_ENDPOINT,
  REPO_SAMPLES_BLOCKSDK,
  REPO_SAMPLES_CONTRIB_BLOCK,
  REPO_SAMPLES_CONTRIB_CUMULOCITY,
  REPO_SAMPLES_CONTRIB_SIMULATION,
  Repository,
  uuidCustom,
} from "../../shared/analytics.model";
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
import { AnalyticsService } from "../../shared/analytics.service";

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

  removeRepository(repositoryId: string): void {
    this.repositories = this.repositories.filter(
      (repo) => repo.id !== repositoryId
    );
    this.repositoriesSubject.next([...this.repositories]);
    this._isDirty = true;
  }

  async loadRepositories(): Promise<Repository[]> {
    if (!this._repositories) {
      this._repositories = this.loadRepositories_Uncached();
    }
    return this._repositories;
  }

  async loadRepositories_Uncached(): Promise<Repository[]> {
    let result = [] as Repository[];
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
      reposMO[ANALYTICS_REPOSITORIES_TYPE] = [
        {
          id: uuidCustom(),
          name: "Block SDK Samples",
          url: REPO_SAMPLES_BLOCKSDK,
          enabled: true,
        },
        {
          id: uuidCustom(),
          name: "Contrib Samples Block",
          url: REPO_SAMPLES_CONTRIB_BLOCK,
          enabled: false,
        },
        {
          id: uuidCustom(),
          name: "Contrib Samples Simulation-Block",
          url: REPO_SAMPLES_CONTRIB_SIMULATION,
          enabled: false,
        },
        {
          id: uuidCustom(),
          name: "Contrib Samples Cumulocity-Block",
          url: REPO_SAMPLES_CONTRIB_CUMULOCITY,
          enabled: false,
        },
      ] as Repository[];
      this.inventoryService.create(reposMO);
      result = reposMO[ANALYTICS_REPOSITORIES_TYPE];
    } else if (data.length > 0) {
      result = data[0][ANALYTICS_REPOSITORIES_TYPE];
    }
    this._repositories = result;
    return result;
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
    let fqn;
    if (block.name.slice(-4) == ".mon") {
      let content: string = await this.getCEP_BlockContent(block, true, true);
      // (?<=^package\s) look ahead of "package "
      // (?=;) look behind of ";"
      const regex = /(?<=^package\s)(.*?)(?=;)/gm;
      const match = content.match(regex);
      fqn = match[0].trim() + "." + block.name.slice(0, -4);
    }
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
        `${BASE_BACKEND_URL}/${REPOSITORY_ENDPOINT}/any_repository/content`,
        {
          headers: {
            "content-type": "text/plain",
          },
          params: {
            url: encodeURIComponent(block.downloadUrl),
            extract_fqn_cep_block: extractFQN_CEP_Block,
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
        result = fqn
      }
    }
    return result;
  }

  async getCEP_BlockSamples(rep: Repository): Promise<CEP_Block[]> {
    if (!this._cep_block_cache || !this._cep_block_cache.get(rep.id)) {
      console.log(`Looking for samples ${rep.id} - ${rep.name}`);
      this._cep_block_cache.set(rep.id, this.getCEP_BlockSamples_Uncached(rep));
    }
    return this._cep_block_cache.get(rep.id);
  }

  async getCEP_BlockSamples_Uncached(rep: Repository): Promise<CEP_Block[]> {
    const result: any = this.githubFetchClient
      .get(rep.url, {
        headers: {
          "content-type": "application/json",
        },
      })
      .pipe(
        map(async (data) => {
          const blocks = _.values(data);
          for (let index = 0; index < blocks.length; index++) {
            blocks[index].repositoryName = rep.name;
            blocks[index].custom = true;
            blocks[index].downloadUrl = blocks[index].download_url;
            delete blocks[index].download_url;
            delete blocks[index].html_url;
            delete blocks[index].git_url;
            delete blocks[index]._links;
            delete blocks[index].size;
            delete blocks[index].sha;
            blocks[index].id = await this.resolveFullyQualified_CEP_Block_name(
              blocks[index],
              rep
            );
            console.log(`FQN: ${blocks[index].name} ${blocks[index].id}`);
          }
          blocks.forEach(async (b) => {});
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

  async getAll_CEP_BlockSamples(
    removeInstalled: boolean
  ): Promise<CEP_Block[]> {
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
    if (removeInstalled) {
      result = resultUnfiltered.filter(
        (block) => !loadedBlocksIds.includes(block.id)
      );
    }
    {
      result = resultUnfiltered;
    }
    return result;
  }
}
