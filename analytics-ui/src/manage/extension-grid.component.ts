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
  switchMap,
  take,
  takeUntil,
  tap
} from 'rxjs/operators';
import { AnalyticsService, CepEngineStatus } from '../shared';
import { ActivatedRoute } from '@angular/router';
import { ExtensionCardComponent } from './extension-card.component';

@Component({
  selector: 'a17t-extension',
  templateUrl: './extension-grid.component.html',
  styleUrls: ['./extension-grid.component.css'],
  standalone: true,
  imports: [CommonModule, CoreModule, ExtensionCardComponent]
})
export class ExtensionGridComponent implements OnInit, OnDestroy {
  // Observables for template
  extensions$!: Observable<IManagedObject[]>;
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
    return `/apps/administration/index.html#/ecosystem/microservice/microservices`;
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
    this.isSafeMode$ = cepObject$.pipe(
      map(mo => mo?.['c8y_Status']?.['is_safe_mode'] ?? false),
      distinctUntilChanged()
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
    this.extensions$ = combineLatest([reload$, this.cepStatus$]).pipe(
      switchMap(([_, status]) =>
        status === 'up'
          ? this.loadExtensions$()
          : of([])
      ),
      shareReplay(1)
    );
  }

  private loadExtensions$(): Observable<IManagedObject[]> {
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
      })
    );
  }
}