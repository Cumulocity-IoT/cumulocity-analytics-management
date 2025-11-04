import { Component, OnDestroy, OnInit } from '@angular/core';
import { IManagedObject } from '@c8y/client';
import { AlertService, WizardConfig, WizardModalService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import { BehaviorSubject, combineLatest, from, merge, Observable, of, Subject } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  shareReplay,
  switchMap,
  take,
  takeUntil,
  tap
} from 'rxjs/operators';
import { AnalyticsService, CEPEngineStatus } from '../shared';

@Component({
  selector: 'a17t-extension',
  templateUrl: './extension-grid.component.html',
  styleUrls: ['./extension-grid.component.css'],
  standalone: false
})
export class ExtensionGridComponent implements OnInit, OnDestroy {
  // Observables for template
  extensions$: Observable<IManagedObject[]>;
  cepStatus$: Observable<CEPEngineStatus>;
  isSafeMode$: Observable<boolean>;

  // Template bindings
  listClass = 'card-group';

  // Private subjects
  private readonly reload$ = new BehaviorSubject<void>(undefined);
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly alertService: AlertService,
    private readonly wizardModalService: WizardModalService
  ) { }

  ngOnInit(): void {
    this.initializeStreams();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  reload(): void {
    this.reload$.next();
  }

  async restartCEP(): Promise<void> {
    try {
      this.alertService.info(gettext('Initiating restart...'));
      await this.analyticsService.restartCepEngine();
    } catch (error) {
      console.error('Failed to restart CEP:', error);
      this.alertService.danger(gettext('Failed to restart CEP'));
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
      .content.onClose.pipe(take(1))
      .subscribe(() => this.reload());
  }

  getCEPMicroserviceUrl(): string {
    return `/apps/administration/index.html#/ecosystem/microservice/microservices`;
  }

  trackByExtension(_: number, extension: IManagedObject): string {
    return extension.id;
  }

  private initializeStreams(): void {
    // CEP operation object stream
    const cepObject$ = this.analyticsService.getCepOperationObjectStream$().pipe(
      takeUntil(this.destroy$),
      shareReplay(1)
    );

    // Extract status
    this.cepStatus$ = cepObject$.pipe(
      map(mo => (mo?.c8y_Status?.status?.toLowerCase() || 'down') as CEPEngineStatus),
      distinctUntilChanged(),
      shareReplay(1)
    );

    // Extract safe mode
    this.isSafeMode$ = cepObject$.pipe(
      map(mo => mo?.c8y_Status?.is_safe_mode ?? false),
      distinctUntilChanged()
    );

    // Combined reload trigger
    const reload$ = merge(
      this.reload$,
      this.analyticsService.getCacheReloadRequests$()
    ).pipe(debounceTime(100));

    // Extensions stream
    this.extensions$ = combineLatest([reload$, this.cepStatus$]).pipe(
      tap(([clearCache]) => {
        if (clearCache) {
          this.analyticsService.clearAllCaches();
        }
      }),
      switchMap(([_, status]) =>
        status === 'up'
          ? this.loadExtensions$()
          : []
      ),
      shareReplay(1)
    );
  }

  private loadExtensions$(): Observable<IManagedObject[]> {
    return from(this.analyticsService.getEnrichedExtensions()).pipe(
      catchError(error => {
        console.error('Failed to load extensions:', error);
        this.alertService.warning(gettext('Failed to load extensions. Please refresh.'));
        return of([]); // Also changed to of([]) instead of just []
      })
    );
  }
}