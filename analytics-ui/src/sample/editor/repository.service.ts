// repository.service.ts

import { Injectable } from "@angular/core";
import { BehaviorSubject, Observable } from "rxjs";
import { Repository } from "../../shared/analytics.model";
import { AnalyticsService } from "../../shared/analytics.service";

@Injectable({
  providedIn: "root",
})
export class RepositoryService {
  private repositories: Repository[] = [];
  private repositoriesSubject: BehaviorSubject<Repository[]> =
    new BehaviorSubject<Repository[]>([]);

  constructor(public analyticsService: AnalyticsService) {
    this.init();
  }

  async init() {
    this.repositories = await this.analyticsService.getRepositories();
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

  async updateRepositories(): Promise<void> {
    await this.analyticsService.updateRepositories(this.repositories);
  }
}
