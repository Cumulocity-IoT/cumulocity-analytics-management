import { Injectable, OnDestroy } from '@angular/core';
import { IFetchResponse } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  from,
  lastValueFrom,
  of
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
import { createDefaultRepository, Repository, RepositoryItem, RepositoryTestResult } from './analytics.model';
import { AnalyticsService } from './analytics.service';
import { ExtensionBuilderService } from './extension-builder.service';
import { GitHubContentService } from './github-content.service';
import { RepositoryBackendService } from './repository-backend.service';
import { RepositoryConfigService } from './repository-config.service';
import { RepositoryError } from './repository-error';
import { RepositoryItemsService } from './repository-items.service';
import { RepositoryModeService } from './repository-mode.service';

interface RepositoryState {
  repositories: Repository[];
  savedRepositories: Repository[];
  hideInstalled: boolean;
}

/**
 * Public facade for everything repository-related. Holds the reactive
 * state (configured repositories, item listing, unsaved-changes tracking)
 * and delegates actual work to focused services:
 *
 * - `RepositoryModeService` — the single "backend or browser?" decision
 *   every other service below branches on.
 * - `RepositoryConfigService` — repo config storage (Tenant Options; no
 *   backend mode, see that service for why).
 * - `GitHubContentService` / `RepositoryBackendService` — the two
 *   parallel implementations of test/list/content-fetch.
 * - `RepositoryItemsService` — fetches, enriches, and caches a repository's
 *   items on top of the two content services above.
 * - `ExtensionBuilderService` — builds/uploads an extension from selected
 *   items, backend or client-side.
 */
@Injectable({
  providedIn: 'root'
})
export class RepositoryService implements OnDestroy {
  private readonly destroy$ = new Subject<void>();

  private readonly state$ = new BehaviorSubject<RepositoryState>({
    repositories: [],
    savedRepositories: [],
    hideInstalled: false
  });

  private readonly reloadTrigger$ = new BehaviorSubject<void>(undefined);

  // addRepository/updateRepository/deleteRepository/saveAllRepositories each
  // read state$.value, await a persistence call, then overwrite state$ with
  // a list derived from that now-stale snapshot. Without serializing them,
  // two calls in flight at once (e.g. a quick add followed by an edit) can
  // race: whichever's await resolves last wins, silently dropping the
  // other's change from both memory and the persisted tenant options. Every
  // mutating method below runs through this queue so each one always reads
  // the just-committed state of the previous one before persisting.
  private mutationQueue: Promise<void> = Promise.resolve();

  // Resolves once the initial fetchRepositories() call (triggered below in
  // the constructor) has settled, so callers can tell "not loaded yet" apart
  // from "loaded and genuinely empty" instead of guessing from the
  // synchronous, still-empty seed value of state$.
  private readonly initialLoad: Promise<Repository[]>;

  private enqueueMutation<T>(task: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(task);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

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
    private readonly repositoryModeService: RepositoryModeService,
    private readonly repositoryConfigService: RepositoryConfigService,
    private readonly repositoryItemsService: RepositoryItemsService,
    private readonly gitHubContentService: GitHubContentService,
    private readonly repositoryBackendService: RepositoryBackendService,
    private readonly extensionBuilderService: ExtensionBuilderService
  ) {
    this.initialLoad = this.initializeRepositories();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.repositoryItemsService.invalidateCache();
  }

  // ============================================================================
  // Public API - Repository Management
  // ============================================================================

  getRepositories(): Observable<Repository[]> {
    return this.repositories$;
  }

  /** Resolves once the initial repository load has settled (see `initialLoad`). */
  whenReady(): Promise<Repository[]> {
    return this.initialLoad;
  }

  addRepository(repository: Repository): Promise<void> {
    return this.enqueueMutation(async () => {
      const state = this.state$.value;
      // Persist the live `repositories` list (not the last-saved baseline) so
      // an unrelated repo's already-pending enabled-toggle is committed along
      // with this add, matching onSave()'s "a single save covers both" intent.
      const updatedRepositories = this.addRepositoryToList(state.repositories, repository);

      try {
        await this.repositoryConfigService.saveRepositories(updatedRepositories);
        this.updateState({
          repositories: updatedRepositories,
          savedRepositories: [...updatedRepositories]
        });
        this.invalidateCache();
        this.alertService.success(gettext('Repository added successfully'));
      } catch (error) {
        throw this.handleError(
          error,
          'Failed to add repository',
          true,
          gettext('Failed to add repository. Please try again.')
        );
      }
    });
  }

  updateRepository(updatedRepository: Repository): Promise<void> {
    return this.enqueueMutation(async () => {
      const state = this.state$.value;

      if (state.repositories.findIndex(r => r.id === updatedRepository.id) === -1) {
        throw new RepositoryError(
          'Repository not found',
          gettext('Repository not found.')
        );
      }

      // Same reasoning as addRepository(): persist the live `repositories`
      // list so an unrelated repo's pending enabled-toggle is committed
      // along with this update rather than silently dropped.
      const updatedRepositories = this.replaceRepositoryInList(state.repositories, updatedRepository);

      try {
        await this.repositoryConfigService.saveRepositories(updatedRepositories);
        this.updateState({
          repositories: updatedRepositories,
          savedRepositories: [...updatedRepositories]
        });
        this.invalidateCache();
        this.alertService.success(gettext('Repository updated successfully'));
      } catch (error) {
        throw this.handleError(
          error,
          'Failed to update repository',
          true,
          gettext('Failed to update repository. Please try again.')
        );
      }
    });
  }

  private addRepositoryToList(list: Repository[], repository: Repository): Repository[] {
    return [...list, repository];
  }

  private replaceRepositoryInList(list: Repository[], updatedRepository: Repository): Repository[] {
    const index = list.findIndex(r => r.id === updatedRepository.id);
    if (index === -1) {
      return list;
    }
    return [
      ...list.slice(0, index),
      updatedRepository,
      ...list.slice(index + 1)
    ];
  }

  private removeRepositoryFromList(list: Repository[], repositoryId: string): Repository[] {
    return list.filter(r => r.id !== repositoryId);
  }

  toggleRepositoryEnabled(repositoryId: string): void {
    // Routed through the same mutationQueue as add/update/delete/saveAll so
    // this read-modify-write of state$ can't land between another mutation's
    // state read and its write-back and get silently overwritten.
    this.enqueueMutation(async () => {
      const state = this.state$.value;
      const targetRepo = state.repositories.find(r => r.id === repositoryId);

      if (!targetRepo) {
        this.handleError(
          new Error('Repository not found'),
          `Repository not found: ${repositoryId}`,
          false
        );
        return;
      }

      const newEnabledState = !targetRepo.enabled;
      const updated = state.repositories.map(repo => {
        if (repo.id === repositoryId) {
          return { ...repo, enabled: newEnabledState };
        }
        if (newEnabledState && repo.enabled) {
          return { ...repo, enabled: false };
        }
        return repo;
      });

      this.updateState({ repositories: updated });
      this.invalidateCache();
    });
  }

  saveAllRepositories(): Promise<void> {
    return this.enqueueMutation(async () => {
      const state = this.state$.value;

      try {
        await this.repositoryConfigService.saveRepositories(state.repositories);
        this.updateState({
          savedRepositories: [...state.repositories]
        });
        this.invalidateCache();
        this.alertService.success(gettext('Repositories saved successfully'));
      } catch (error) {
        throw this.handleError(
          error,
          'Failed to save repositories',
          true,
          gettext('Failed to save repositories. Please try again.')
        );
      }
    });
  }

  hasUnsavedChanges(state?: RepositoryState): boolean {
    const currentState = state || this.state$.value;
    return currentState.repositories.some(repo => {
      const saved = currentState.savedRepositories.find(sr => sr.id === repo.id);
      return saved && saved.enabled !== repo.enabled;
    });
  }

  cancelChanges(): void {
    // Same reasoning as toggleRepositoryEnabled(): route through the queue
    // so this doesn't race a concurrent add/update/delete/saveAll.
    this.enqueueMutation(async () => {
      const state = this.state$.value;
      this.updateState({
        repositories: [...state.savedRepositories]
      });
      this.invalidateCache();
    });
  }

  deleteRepository(repositoryId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const state = this.state$.value;
      // Same reasoning as addRepository()/updateRepository(): persist the
      // live `repositories` list so an unrelated repo's pending
      // enabled-toggle is committed along with this delete.
      const updatedRepositories = this.removeRepositoryFromList(state.repositories, repositoryId);

      try {
        await this.repositoryConfigService.saveRepositories(updatedRepositories);
        this.updateState({
          repositories: updatedRepositories,
          savedRepositories: [...updatedRepositories]
        });
        this.invalidateCache();
        this.alertService.success(gettext('Repository deleted successfully'));
      } catch (error) {
        throw this.handleError(
          error,
          'Failed to delete repository',
          true,
          gettext('Failed to delete repository. Please try again.')
        );
      }
    });
  }

  /**
   * Tests a repository. Also allows testing a draft (unsaved) repository
   * before persisting it. Dispatches to the backend or a direct GitHub call
   * per `RepositoryModeService`.
   */
  async testRepository(repository: Repository): Promise<RepositoryTestResult> {
    return (await this.repositoryModeService.isBackendMode())
      ? this.repositoryBackendService.testRepository(repository)
      : this.gitHubContentService.testRepository(repository);
  }

  async refreshRepositories(): Promise<void> {
    try {
      await lastValueFrom(this.loadRepositoriesFromConfig().pipe(take(1)));
      this.invalidateCache();
      this.alertService.success(gettext('Repositories refreshed successfully'));
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to refresh repositories',
        true,
        gettext('Failed to refresh repositories. Please try again.')
      );
    }
  }

  // ============================================================================
  // Public API - Cache and Reload
  // ============================================================================

  /** Reload repository items (clears cache and triggers refresh) */
  reload(): void {
    this.invalidateCache();
  }

  /** Reload repositories and items from tenant options */
  reloadAll(): Promise<void> {
    return this.refreshRepositories();
  }

  // ============================================================================
  // Public API - Repository Items
  // ============================================================================

  getRepositoryItems(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      map(blocks => this.repositoryItemsService.filterRepositoryItems(blocks))
    );
  }

  getRepositoryItemsAnalyzed(): Observable<RepositoryItem[]> {
    return this.repositoryItems$.pipe(
      switchMap(items => this.repositoryItemsService.analyzeRepositoryItems(items)),
      catchError(error => {
        this.handleError(
          error,
          'Failed to analyze repository items',
          true,
          gettext('Failed to analyze repository items. Please try again.')
        );
        return of([]);
      })
    );
  }

  updateHideInstalledFilter(hideInstalled: boolean): void {
    this.updateState({ hideInstalled });
  }

  getRepositoryItemContent(
    block: RepositoryItem,
    extractFQN: boolean = false
  ): Observable<string> {
    return this.repositoryItemsService.getItemContent(block, extractFQN);
  }

  async getRepositoryAccessToken(repositoryId: string): Promise<string> {
    return this.repositoryConfigService.getRepositoryAccessToken(repositoryId);
  }

  async getExpertMode(): Promise<boolean> {
    return this.repositoryConfigService.getExpertMode();
  }

  async setExpertMode(expertMode: boolean): Promise<void> {
    return this.repositoryConfigService.setExpertMode(expertMode);
  }

  // ============================================================================
  // Public API - Extension Creation
  // ============================================================================

  createExtensionFromList(
    name: string,
    monitors: RepositoryItem[],
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    return this.extensionBuilderService.createExtensionFromList(name, monitors, repository, upload, deploy, rebuild);
  }

  createExtensionFromYaml(
    name: string,
    yaml: RepositoryItem,
    sections: string[],
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    return this.extensionBuilderService.createExtensionFromYaml(name, yaml, sections, repository, upload, deploy, rebuild);
  }

  createExtensionFromRepository(
    name: string,
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    return this.extensionBuilderService.createExtensionFromRepository(name, repository, upload, deploy, rebuild);
  }

  // ============================================================================
  // Private Methods - Initialization
  // ============================================================================

  private async initializeRepositories(): Promise<Repository[]> {
    try {
      return await lastValueFrom(
        this.loadRepositoriesFromConfig().pipe(take(1), takeUntil(this.destroy$))
      );
    } catch {
      // Only reachable if the service is destroyed before the load settles
      // (loadRepositoriesFromConfig()'s own catchError already handles a
      // failed fetch by resolving to `[]`) — fall back to empty rather than
      // leaving `whenReady()` callers with an unhandled rejection.
      return [];
    }
  }

  private loadRepositoriesFromConfig(): Observable<Repository[]> {
    return from(this.repositoryConfigService.fetchRepositories()).pipe(
      switchMap(repos => repos.length > 0 ? of(repos) : from(this.seedDefaultRepository())),
      tap(repos => {
        this.updateState({
          repositories: repos,
          savedRepositories: [...repos]
        });
      }),
      catchError(error => {
        this.handleError(
          error,
          'Failed to load repositories from tenant options',
          true,
          gettext('Failed to load repositories. Please check your permissions and try again.')
        );
        return of([]);
      })
    );
  }

  /**
   * A tenant with no repositories configured gets the community blocks repo
   * added automatically, so "Blocks from repositories" isn't empty on first
   * use. Persisted the same way any user-added repository would be; if that
   * save fails, the seeded entry still gets used for this session (it just
   * won't survive a reload) rather than leaving the user with nothing.
   */
  private async seedDefaultRepository(): Promise<Repository[]> {
    const defaultRepository = createDefaultRepository();
    try {
      await this.repositoryConfigService.saveRepositories([defaultRepository]);
    } catch (error) {
      console.warn('[RepositoryService] Failed to persist the default repository:', error);
    }
    return [defaultRepository];
  }

  private loadRepositoryItemsWithStatus(hideInstalled: boolean): Observable<RepositoryItem[]> {
    return combineLatest([
      this.repositories$,
      from(this.analyticsService.getDeployedBlocks()).pipe(
        catchError(error => {
          console.warn('Failed to get deployed blocks:', error);
          return of([]);
        })
      )
    ]).pipe(
      switchMap(([repos, loaded]) =>
        this.repositoryItemsService.getItemsForRepositories(repos, loaded, hideInstalled)
      )
    );
  }

  // ============================================================================
  // Private Methods - State Management
  // ============================================================================

  private updateState(partial: Partial<RepositoryState>): void {
    const current = this.state$.value;
    this.state$.next({ ...current, ...partial });
  }

  private invalidateCache(): void {
    this.repositoryItemsService.invalidateCache();
    this.reloadTrigger$.next();
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
  // Private Methods - Error Handling
  // ============================================================================

  private handleError(
    error: unknown,
    logMessage: string,
    showAlert: boolean = false,
    userMessage?: string
  ): Error {
    console.error(`[RepositoryService] ${logMessage}:`, error);

    if (showAlert) {
      const message = userMessage || this.getErrorMessage(error);
      this.alertService.danger(message);
    }

    if (error instanceof RepositoryError) {
      return error;
    }

    return new RepositoryError(
      logMessage,
      userMessage || this.getErrorMessage(error),
      error instanceof Error ? error : undefined
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof RepositoryError) {
      return error.userMessage;
    }

    if (error && typeof error === 'object' && 'message' in error) {
      const errorObj = error as Record<string, unknown>;
      const message = errorObj['message'];
      if (typeof message === 'string') {
        return message;
      }
    }

    return gettext('An unexpected error occurred. Please try again.');
  }
}
