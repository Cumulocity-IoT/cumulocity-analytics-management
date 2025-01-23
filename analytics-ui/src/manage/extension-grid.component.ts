import { Component, OnDestroy, OnInit } from '@angular/core';
import { IManagedObject } from '@c8y/client';
import {
  AlertService,
  WizardConfig,
  WizardModalService,
  gettext
} from '@c8y/ngx-components';
import { ModalOptions } from 'ngx-bootstrap/modal';
import {
  BehaviorSubject,
  Observable,
  Subject,
  Subscription,
  merge,
  of
} from 'rxjs';
import { catchError, shareReplay, switchMap, take, tap } from 'rxjs/operators';
import { AnalyticsService, CEPEngineStatus, CEPStatusObject } from '../shared';

@Component({
  selector: 'a17t-extension',
  templateUrl: './extension-grid.component.html',
  styleUrls: ['./extension-grid.component.css']
})
export class ExtensionGridComponent implements OnInit, OnDestroy {
  cepOperationObject$: Subject<IManagedObject>;
  cepCtrlStatus: CEPStatusObject;
  cepEngineStatus$: BehaviorSubject<CEPEngineStatus> =
    new BehaviorSubject<CEPEngineStatus>('unknown');
  cepId: string;
  reload$: BehaviorSubject<boolean> = new BehaviorSubject(false);
  extensions$: Observable<IManagedObject[]>;
  sub1: Subscription;
  listClass: string;

  constructor(
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private wizardModalService: WizardModalService
  ) { }
  ngOnDestroy(): void {
    this.sub1.unsubscribe();
  }

  ngOnInit() {
    this.init();
  }

  async init() {
    const { microservice_application_id } =
      await this.analyticsService.getCEP_CtrlStatus();
    this.cepId = microservice_application_id as string;
    this.cepCtrlStatus = await this.analyticsService.getCEP_CtrlStatus();
    this.cepOperationObject$ = this.analyticsService.getCEP_OperationObject();
    this.sub1 = this.cepOperationObject$.subscribe((mo) => {
      this.cepEngineStatus$.next((mo.c8y_Status ? mo.c8y_Status.status : 'Down').toLowerCase());
    });
    this.extensions$ = merge(
      this.analyticsService.getReloadThroughService(),
      this.reload$
    ).pipe(
      tap((clearCache) => {
        clearCache && this.analyticsService.clearCaches();
        this.updateCepStatus('loading');
      }),
      switchMap(() => this.analyticsService.getExtensionsMetadataEnriched()),
      catchError(() => {
        this.updateCepStatus('loadingError');
        return of([]);
      }),
      tap((res) => {
        this.updateCepStatus(res?.length ? 'loaded' : 'empty');
      }),
      shareReplay()
    );

    this.reload$.next(false);
  }

  private updateCepStatus(status: CEPEngineStatus) {
    this.cepEngineStatus$.next(status);
  }

  loadExtensions() {
    this.reload$.next(true);
  }

  restartCEP() {
    this.alertService.success(gettext('Deployment (restart) submitted ...'));
    this.analyticsService.restartCEP();
  }

  addExtension() {
    const wizardConfig: WizardConfig = {
      headerIcon: 'plus'
    };

    const initialState: any = {
      wizardConfig,
      id: 'uploadAnalyticsExtension',
      componentInitialState: {
        mode: 'add',
        headerText: 'Add extension'
      }
    };

    const modalOptions: ModalOptions = { initialState };

    const modalRef = this.wizardModalService.show(modalOptions);
    modalRef.content.onClose.pipe(take(1)).subscribe(() => {
      this.loadExtensions();
    });
  }
}
