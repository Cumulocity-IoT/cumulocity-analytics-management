// repository.service.ts

import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";
import {
  ANALYTICS_REPOSITORIES_TYPE,
  REPO_SAMPLES_BLOCKSDK,
  Repository,
  uuidCustom,
} from "../../shared/analytics.model";
import { IManagedObject, InventoryService } from "@c8y/client";

@Injectable({
  providedIn: "root",
})
export class RepositoryService {
  private repositories: Repository[] = [];
  private repositoriesSubject: BehaviorSubject<Repository[]> =
    new BehaviorSubject<Repository[]>([]);
  private _repositories: Promise<Repository[]> | Repository[];

  constructor(private inventoryService: InventoryService) {
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
  }

  updateRepository(updatedRepository: Repository): void {
    const index = this.repositories.findIndex(
      (repo) => repo.id === updatedRepository.id
    );
    if (index !== -1) {
      this.repositories[index] = updatedRepository;
      this.repositoriesSubject.next([...this.repositories]);
    }
  }

  removeRepository(repositoryId: string): void {
    this.repositories = this.repositories.filter(
      (repo) => repo.id !== repositoryId
    );
    this.repositoriesSubject.next([...this.repositories]);
  }

  async loadRepositories(): Promise<Repository[]> {
    if (!this._repositories) {
      this._repositories = this.loadUncachedRepositories();
    }
    return this._repositories;
  }

  async loadUncachedRepositories(): Promise<Repository[]> {
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
  }
}
