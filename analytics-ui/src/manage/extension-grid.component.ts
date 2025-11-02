import { Component, OnDestroy, OnInit } from '@angular/core';
import { IManagedObject } from '@c8y/client';
import {
  AlertService,
  WizardConfig,
  WizardModalService
} from '@c8y/ngx-components';
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  merge,
  of
} from 'rxjs';
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
import { AnalyticsService, CEPEngineStatus, CEPStatusObject } from '../shared';
import { gettext } from '@c8y/ngx-components/gettext';


interface ExtensionGridState {
  status: CEPEngineStatus;
  cepId: string | null;
  isSafeMode: boolean;
}

@Component({
  selector: 'a17t-extension',
  templateUrl: './extension-grid.component.html',
  styleUrls: ['./extension-grid.component.css'],
  standalone: false
})
export class ExtensionGridComponent implements OnInit, OnDestroy {
  // Observables
  cepOperationObject$: Observable<IManagedObject>;
  extensions$: Observable<IManagedObject[]>;
  state$: Observable<ExtensionGridState>;

  // BehaviorSubjects
  private reload$ = new BehaviorSubject<boolean>(false);
  private destroy$ = new Subject<void>();

  // Template bindings
  listClass: string = 'card-group';
  cepCtrlStatus: CEPStatusObject | null = null;
  cepId: string | null = null;

  // Computed observables for template
  cepEngineStatus$: Observable<CEPEngineStatus>;
  isSafeMode$: Observable<boolean>;

  constructor(
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private wizardModalService: WizardModalService
  ) { }

  ngOnInit(): void {
    this.initializeComponent();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadExtensions(): void {
    this.reload$.next(true);
  }

  async restartCEP(): Promise<void> {
    try {
      this.alertService.info(gettext('Initiating restart...'));
      await this.analyticsService.restartCepEngine();
      this.alertService.success(gettext('Restart submitted successfully'));
    } catch (error) {
      console.error('Failed to restart CEP:', error);
      this.alertService.danger(gettext('Failed to restart CEP'));
    }
  }

  addExtension(): void {
    const wizardConfig: WizardConfig = {
      headerIcon: 'plus'
    };

    const initialState = {
      wizardConfig,
      id: 'uploadAnalyticsExtension',
      componentInitialState: {
        mode: 'add' as const,
        headerText: 'Add extension',
        uploadExtensionHandler: this.analyticsService.uploadExtension.bind(
          this.analyticsService
        )
      }
    };

    const modalRef = this.wizardModalService.show({ initialState });

    modalRef.content.onClose
      .pipe(take(1))
      .subscribe(() => this.loadExtensions());
  }

  private initializeComponent(): void {
    this.setupCEPStatusObservables();
    this.setupExtensionsObservable();
    this.setupServiceReload();

    // Initial load
    this.reload$.next(false);
  }

  private setupCEPStatusObservables(): void {
    // Get CEP operation object stream
    this.cepOperationObject$ = this.analyticsService
      .getCepOperationObjectStream$()
      .pipe(
        takeUntil(this.destroy$),
        shareReplay({ bufferSize: 1, refCount: true })
      );

    // Extract status from operation object
    this.cepEngineStatus$ = this.cepOperationObject$.pipe(
      map(mo => this.extractCEPStatus(mo)),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

    // Load initial CEP status
    this.loadInitialCEPStatus();

    // Create safe mode observable
    this.isSafeMode$ = this.cepOperationObject$.pipe(
      map(mo => mo?.c8y_Status?.is_safe_mode ?? false),
      distinctUntilChanged()
    );
  }

  private extractCEPStatus(mo: IManagedObject): CEPEngineStatus {
    const status = mo?.c8y_Status?.status;

    if (!status) {
      return 'down';
    }

    return status.toLowerCase() as CEPEngineStatus;
  }

  private async loadInitialCEPStatus(): Promise<void> {
    try {
      const status = await this.analyticsService.getCepStatus();
      this.cepCtrlStatus = status;
      this.cepId = status?.microservice_application_id as string;
    } catch (error) {
      console.error('Failed to load CEP status:', error);
      this.alertService.warning(
        gettext('Could not load CEP status information')
      );
    }
  }

  private setupExtensionsObservable(): void {
    const reloadTrigger$ = merge(
      this.analyticsService.getCacheReloadRequests$(),
      this.reload$
    ).pipe(
      debounceTime(100), // Prevent rapid successive reloads
      distinctUntilChanged()
    );

    this.extensions$ = reloadTrigger$.pipe(
      tap(clearCache => {
        if (clearCache) {
          this.analyticsService.clearAllCaches();
        }
      }),
      switchMap(() =>
        combineLatest([
          this.cepEngineStatus$,
          this.loadExtensions$()
        ])
      ),
      map(([status, extensions]) => {
        // Only return extensions if CEP is up
        return status === 'up' ? extensions : [];
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private loadExtensions$(): Observable<IManagedObject[]> {
    return of(null).pipe(
      tap(() => this.updateLoadingState('loading')),
      switchMap(() => this.analyticsService.getEnrichedExtensions()),
      tap(extensions => {
        const status = extensions?.length ? 'loaded' : 'empty';
        this.updateLoadingState(status);
      }),
      catchError(error => {
        console.error('Failed to load extensions:', error);
        this.updateLoadingState('loadingError');
        this.alertService.warning(
          gettext('Failed to load extensions. Please refresh.')
        );
        return of([]);
      })
    );
  }

  private updateLoadingState(status: CEPEngineStatus): void {
    // This is a workaround for showing loading states
    // In a better architecture, this would be part of the state management
    // console.log('Extension loading status:', status);
  }

  private setupServiceReload(): void {
    this.analyticsService
      .getCacheReloadRequests$()
      .pipe(takeUntil(this.destroy$))
      .subscribe(clearCache => {
        this.reload$.next(clearCache);
      });
  }

  // Template helper methods
  getCEPMicroserviceUrl(): string {
    return `/apps/administration/index.html#/ecosystem/microservice/microservices/${this.cepId}/properties`;
  }

  trackByExtension(_index: number, extension: IManagedObject): string {
    return extension.id;
  }
}