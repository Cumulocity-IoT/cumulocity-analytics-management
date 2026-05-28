import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IManagedObject } from '@c8y/client';
import { AlertService, CoreModule, WizardConfig, WizardModalService } from '@c8y/ngx-components';
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
      this.alertService.info(gettext('Initiating restart...'));
      await this.analyticsService.restartCepEngine();
    } catch (error) {
      console.error('Failed to restart Cep:', error);
      this.alertService.danger(gettext('Failed to restart Cep'));
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
    return from(this.analyticsService.getEnrichedExtensions()).pipe(
      catchError(error => {
        console.error('Failed to load extensions:', error);
        this.alertService.warning(gettext('Failed to load extensions. Please refresh.'));
        return of([]); // Also changed to of([]) instead of just []
      })
    );
  }
}