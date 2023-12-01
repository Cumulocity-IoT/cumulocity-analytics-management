// repository.service.ts

import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";
import {
  ANALYTICS_REPOSITORIES_TYPE,
  REPO_SAMPLES_BLOCKSDK,
  REPO_SAMPLES_CONTRIB_BLOCK,
  REPO_SAMPLES_CONTRIB_CUMULOCITY,
  REPO_SAMPLES_CONTRIB_SIMULATION,
  Repository,
  uuidCustom,
} from "../../shared/analytics.model";
import { IManagedObject, InventoryService } from "@c8y/client";
import { AlertService, gettext } from "@c8y/ngx-components";

@Injectable({
  providedIn: "root",
})
export class RepositoryService {
  private repositories: Repository[] = [];
  private repositoriesSubject: BehaviorSubject<Repository[]> =
    new BehaviorSubject<Repository[]>([]);
  private _repositories: Promise<Repository[]> | Repository[];
  private _isDirty: boolean = false;

  constructor(
    private inventoryService: InventoryService,
    public alertService: AlertService
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
}
