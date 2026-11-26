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
  of,
  throwError
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  map,
  pairwise,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  tap
} from 'rxjs/operators';
import {
  createDefaultRepository,
  GitHubReleaseAsset,
  Repository,
  RepositoryItem,
  RepositoryTestResult
} from './analytics.model';
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
  hideInstalled: boolean;
}

/**
 * Public facade for everything repository-related. Holds the reactive
 * state (configured repositories, item listing)
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
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  readonly repositories$ = this.state$.pipe(
    map(state => state.repositories),
    distinctUntilChanged((a, b) => this.areRepositoriesEqual(a, b)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly repositoryItems$ = combineLatest([this.reloadTrigger$, this.state$]).pipe(
    switchMap(([_, state]) => this.loadRepositoryItemsWithStatus(state.hideInstalled)),
    shareReplay({ bufferSize: 1, refCount: true }),
    takeUntil(this.destroy$)
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

    // When a correlator restart completes, the deployed blocks may have changed
    // (e.g. an extension was deleted): refresh the "installed" status. The
    // analytics caches are cleared by AnalyticsService itself on the same edge.
    this.analyticsService.restarting$
      .pipe(pairwise(), takeUntil(this.destroy$))
      .subscribe(([was, now]) => {
        if (was && !now) {
          this.invalidateCache();
        }
      });
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
      const updatedRepositories = this.addRepositoryToList(state.repositories, repository);

      try {
        await this.repositoryConfigService.saveRepositories(updatedRepositories);
        this.updateState({
          repositories: updatedRepositories
        });
        this.invalidateCache();
        this.alertService.success(gettext('Repository added'));
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
        throw new RepositoryError('Repository not found', gettext('Repository not found.'));
      }

      const updatedRepositories = this.replaceRepositoryInList(
        state.repositories,
        updatedRepository
      );

      try {
        await this.repositoryConfigService.saveRepositories(updatedRepositories);
        this.updateState({
          repositories: updatedRepositories
        });
        this.invalidateCache();
        this.alertService.success(gettext('Repository updated'));
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
    return [...list.slice(0, index), updatedRepository, ...list.slice(index + 1)];
  }

  private removeRepositoryFromList(list: Repository[], repositoryId: string): Repository[] {
    return list.filter(r => r.id !== repositoryId);
  }

  deleteRepository(repositoryId: string): Promise<void> {
    return this.enqueueMutation(async () => {
      const state = this.state$.value;
      const updatedRepositories = this.removeRepositoryFromList(state.repositories, repositoryId);

      try {
        await this.repositoryConfigService.saveRepositories(updatedRepositories);
        this.updateState({
          repositories: updatedRepositories
        });
        this.invalidateCache();
        this.alertService.success(gettext('Repository deleted'));
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
      // Don't swallow load failures here (unlike the initial load): otherwise a
      // failed refresh would alert twice and still announce success.
      await lastValueFrom(this.loadRepositoriesFromConfig(false).pipe(take(1)));
      this.analyticsService.clearAllCaches();
      this.invalidateCache();
      this.alertService.success(gettext('Repositories refreshed'));
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
    // "Installed" is derived from the deployed blocks, which are cached separately
    this.analyticsService.clearAllCaches();
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

  /**
   * Items of a single repository, analyzed on their own.
   * `getRepositoryItemsAnalyzed()` analyzes all repositories together, which is
   * wrong when one extension is built from exactly one repository.
   */
  getRepositoryItemsAnalyzedFor(repositoryId: string): Observable<RepositoryItem[]> {
    // Re-emits whenever the caches are invalidated (reload, saved repositories, restart).
    return this.reloadTrigger$.pipe(
      switchMap(() =>
        combineLatest([
          this.repositories$,
          from(this.analyticsService.getDeployedBlocks()).pipe(catchError(() => of([]))),
          from(this.getDeployedFileNames())
        ]).pipe(
          take(1),
          switchMap(([repos, loaded, files]) => {
            const repo = repos.find(r => r.id === repositoryId);
            return repo
              ? this.repositoryItemsService.getItemsForRepositories([repo], loaded, false, files)
              : of([]);
          })
        )
      ),
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

  getRepositoryItemContent(block: RepositoryItem, extractFQN: boolean = false): Observable<string> {
    return this.repositoryItemsService.getItemContent(block, extractFQN);
  }

  /**
   * Token for listing a repository's releases: its own token, else the global PAT (the
   * same order the service uses when it downloads), else `''`.
   */
  async getRepositoryAccessToken(repositoryId: string): Promise<string> {
    return this.repositoryConfigService.getRepositoryAccessTokenOrGlobal(repositoryId);
  }

  /** Masked global PAT for display in "Manage repositories" — see `RepositoryConfigService.getGlobalAccessTokenMasked`. */
  async getGlobalAccessTokenMasked(): Promise<string> {
    return this.repositoryConfigService.getGlobalAccessTokenMasked();
  }

  /** Persists the global PAT, used as a fallback by any repository without its own token. */
  async setGlobalAccessToken(token: string): Promise<void> {
    await this.repositoryConfigService.setGlobalAccessToken(token);
    this.invalidateCache();
  }

  // ============================================================================
  // Public API - Extension Creation
  // ============================================================================

  /** Backend only: downloads the asset server-side and uploads it as an extension. */
  deployReleaseAsset(
    repository: Repository,
    asset: GitHubReleaseAsset,
    releaseTag: string,
    deploy: boolean,
    replace = false
  ): Promise<{ id: string; warning?: string }> {
    return this.repositoryBackendService.deployReleaseAsset(
      repository,
      asset,
      releaseTag,
      deploy,
      replace
    );
  }

  createExtensionFromList(
    name: string,
    monitors: RepositoryItem[],
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    return this.extensionBuilderService.createExtensionFromList(
      name,
      monitors,
      repository,
      upload,
      deploy,
      rebuild
    );
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
    return this.extensionBuilderService.createExtensionFromYaml(
      name,
      yaml,
      sections,
      repository,
      upload,
      deploy,
      rebuild
    );
  }

  createExtensionFromRepository(
    name: string,
    repository: Repository,
    upload: boolean = false,
    deploy: boolean = false,
    rebuild: boolean = false
  ): Promise<IFetchResponse> {
    return this.extensionBuilderService.createExtensionFromRepository(
      name,
      repository,
      upload,
      deploy,
      rebuild
    );
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

  private loadRepositoriesFromConfig(swallowErrors: boolean = true): Observable<Repository[]> {
    return from(this.repositoryConfigService.fetchRepositories()).pipe(
      switchMap(repos => (repos.length > 0 ? of(repos) : from(this.seedDefaultRepository()))),
      tap(repos => {
        this.updateState({
          repositories: repos
        });
      }),
      catchError(error => {
        if (!swallowErrors) {
          return throwError(() => error);
        }
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
      ),
      from(this.getDeployedFileNames())
    ]).pipe(
      switchMap(([repos, loaded, files]) =>
        this.repositoryItemsService.getItemsForRepositories(repos, loaded, hideInstalled, files)
      )
    );
  }

  /** Base names of all files contained in the deployed extensions. */
  private async getDeployedFileNames(): Promise<Set<string>> {
    try {
      const names = (await this.analyticsService.getExtensionNamesFromCep()) as unknown as Record<
        string,
        { contents?: string[] } | undefined
      >;
      const files = new Set<string>();
      for (const entry of Object.values(names ?? {})) {
        for (const path of Array.isArray(entry?.contents) ? entry.contents : []) {
          files.add(path.substring(path.lastIndexOf('/') + 1));
        }
      }
      return files;
    } catch (error) {
      console.warn('Failed to get deployed extension files:', error);
      return new Set();
    }
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
    return a.every(
      (repo, index) =>
        repo.id === b[index].id && repo.name === b[index].name && repo.url === b[index].url
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
      const { message } = errorObj;
      if (typeof message === 'string') {
        return message;
      }
    }

    return gettext('An unexpected error occurred. Please try again.');
  }
}
