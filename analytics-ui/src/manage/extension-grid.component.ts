import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IManagedObject } from '@c8y/client';
import { AlertService, CoreModule, WizardConfig, WizardModalService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import { BehaviorSubject, combineLatest, defer, from, merge, Observable, of, Subject, timer } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  retry,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeUntil,
  tap
} from 'rxjs/operators';
import { AnalyticsService, CepEngineStatus, PAGE_LABELS, ROUTES } from '../shared';
import { ActivatedRoute } from '@angular/router';
import { ExtensionCardComponent } from './extension-card.component';

@Component({
  selector: 'a17t-extension-grid',
  templateUrl: './extension-grid.component.html',
  styleUrls: ['./extension-grid.component.css'],
  standalone: true,
  imports: [CommonModule, CoreModule, ExtensionCardComponent]
})
export class ExtensionGridComponent implements OnInit, OnDestroy {
  readonly labels = PAGE_LABELS;
  readonly routes = ROUTES;

  // Observables for template
  // `null` means "not yet known" (engine down, or the post-restart load is
  // still in flight) — distinct from a resolved, genuinely empty `[]` — so
  // the template doesn't flash the "No extensions loaded" empty state while
  // the real list is still being fetched.
  extensions$!: Observable<IManagedObject[] | null>;
  cepStatus$!: Observable<CepEngineStatus>;
  isSafeMode$!: Observable<boolean>;

  // Template bindings
  listClass = 'card-group';
  isBackendServiceAvailable = false;

  // Private subjects
  private readonly reload$ = new BehaviorSubject<boolean>(false);
  private readonly destroy$ = new Subject<void>();

  // Just after the engine reports "up", its diagnostics endpoints can still
  // return 502 for a few seconds. Retry transient load failures with a short
  // backoff so the extensions appear once the engine is fully ready.
  private readonly SUSPECT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  private readonly MAX_LOAD_RETRIES = 6;
  private readonly LOAD_RETRY_STEP = 1500;
  private readonly MAX_LOAD_RETRY_DELAY = 6000;

  constructor(
    private route: ActivatedRoute,
    private readonly analyticsService: AnalyticsService,
    private readonly alertService: AlertService,
    private readonly wizardModalService: WizardModalService
  ) { }

  async ngOnInit(): Promise<void> {
    this.isBackendServiceAvailable = await this.route.snapshot.data['isBackendServiceAvailable'];
    this.initializeStreams();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  reload(): void {
    this.analyticsService.clearAllCaches(); // Clear immediately
    this.reload$.next(true); // Signal reload with cache clear
  }

  async restartCep(): Promise<void> {
    try {
      // The service drives the user-facing restart lifecycle toast
      // (restarting -> in progress -> success/failure), so we only need to
      // swallow the error here to avoid an unhandled rejection.
      await this.analyticsService.restartCepEngine();
    } catch (error) {
      console.error('Failed to restart Cep:', error);
    }
  }

  addExtension(): void {
    const initialState = {
      wizardConfig: { headerIcon: 'plus' } as WizardConfig,
      id: 'uploadAnalyticsExtension',
      componentInitialState: {
        mode: 'add' as const,
        headerText: 'Add extension',
        uploadExtensionHandler: this.analyticsService.uploadExtension.bind(this.analyticsService)
      }
    };

    this.wizardModalService
      .show({ initialState })
      .content?.onClose.pipe(take(1))
      .subscribe(() => this.reload());
  }

  getCepMicroserviceUrl(): string {
    return '/apps/administration/index.html#/ecosystem/microservice/microservices';
  }

  trackByExtension(_: number, extension: IManagedObject): string {
    return extension.id;
  }

  private initializeStreams(): void {
    // Cep operation object stream
    const cepObject$ = this.analyticsService.getCepOperationObjectStream$().pipe(
      takeUntil(this.destroy$),
      shareReplay(1)
    );

    // Extract status
    this.cepStatus$ = cepObject$.pipe(
      map(mo => (mo?.['c8y_Status']?.['status']?.toLowerCase() || 'down') as CepEngineStatus),
      distinctUntilChanged(),
      shareReplay(1)
    );

    // Extract safe mode
    // The operation object does not always carry the flag; the engine status
    // endpoint (the one the Monitoring tab shows) is the reliable source.
    this.isSafeMode$ = cepObject$.pipe(
      switchMap(mo =>
        mo?.['c8y_Status']?.['is_safe_mode'] === true
          ? of(true)
          : from(this.analyticsService.getCepStatus().then(status => status?.is_safe_mode === true)).pipe(
              catchError(() => of(false)),
              startWith(false)
            )
      ),
      distinctUntilChanged(),
      shareReplay(1)
    );

    // Combined reload trigger
    const reload$ = merge(
      this.reload$,
      this.analyticsService.getCacheReloadRequests$()
    ).pipe(
      debounceTime(100),
      tap(clearCache => {
        // console.log('Reload triggered, clearCache:', clearCache);
        if (clearCache) {
          this.analyticsService.clearAllCaches();
        }
      })
    );

    // Extensions stream
    this.extensions$ = combineLatest([reload$, this.cepStatus$, this.isSafeMode$]).pipe(
      switchMap(([_, status, safeMode]) =>
        status === 'up'
          ? this.loadExtensions$().pipe(map(extensions => (safeMode ? this.markAsNotLoaded(extensions) : extensions)))
          : of(null)
      ),
      shareReplay(1)
    );
  }

  // In safe mode the correlator loads no extensions, but its metadata
  // endpoints still list the ones deployed before, so enrichment reports them
  // as loaded. Override that: nothing is loaded while safe mode is active.
  // The most recently updated extension is the usual cause of the restart
  // loop, so it is flagged as the suspected cause.
  private markAsNotLoaded(extensions: IManagedObject[] | null): IManagedObject[] | null {
    if (!extensions) return extensions;
    const lastUpdated = (e: IManagedObject) => Date.parse(e['lastUpdated'] ?? e['creationTime'] ?? '') || 0;
    const suspect = extensions.reduce<IManagedObject | null>(
      (latest, e) => (!latest || lastUpdated(e) > lastUpdated(latest) ? e : latest),
      null
    );
    // Safe mode lasts until the engine is restarted, so after the culprit is
    // deleted the next-newest extension would otherwise be blamed. Only a
    // recent change can plausibly have triggered the restart loop.
    const isRecent = !!suspect && Date.now() - lastUpdated(suspect) < this.SUSPECT_MAX_AGE_MS;
    return extensions.map(extension => ({
      ...extension,
      loaded: false,
      blocksCount: 0,
      suspectedCause: isRecent && extension === suspect
    }));
  }

  private loadExtensions$(): Observable<IManagedObject[] | null> {
    // defer() so each retry re-invokes getEnrichedExtensions() (which re-fetches,
    // since it clears its cache on failure) rather than replaying a settled promise.
    return defer(() => from(this.analyticsService.getEnrichedExtensions())).pipe(
      retry({
        count: this.MAX_LOAD_RETRIES,
        delay: (error, retryCount) => {
          // The engine status flips to "up" slightly before its diagnostics
          // endpoints serve, so a fresh restart briefly 502s. Retry those
          // transient failures with a short backoff until the engine is ready.
          if (this.analyticsService.isExpectedTransientError(error)) {
            return timer(Math.min(retryCount * this.LOAD_RETRY_STEP, this.MAX_LOAD_RETRY_DELAY));
          }
          // Non-transient: stop retrying and surface it via catchError.
          throw error;
        }
      }),
      catchError(error => {
        // Still failing after the retries are exhausted (or a non-transient
        // error): keep transient cases quiet, alert only on genuine failures.
        if (this.analyticsService.isExpectedTransientError(error)) {
          console.warn('Failed to load extensions after retries (engine still unavailable):', error);
        } else {
          console.error('Failed to load extensions:', error);
          this.alertService.add({
            text: gettext('Failed to load extensions. Please refresh.'),
            type: 'warning',
            timeout: 8000
          });
        }
        return of([]);
      }),
      // Emit `null` synchronously first so the grid shows a loading state
      // instead of the "No extensions loaded" empty state while the initial
      // fetch (and any transient-error retries above) is still in flight.
      startWith(null)
    );
  }
}