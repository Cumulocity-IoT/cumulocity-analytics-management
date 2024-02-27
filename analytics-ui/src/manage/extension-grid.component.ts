import { Component, OnInit } from '@angular/core';
import { IManagedObject } from '@c8y/client';
import { WizardConfig, WizardModalService } from '@c8y/ngx-components';
import { ModalOptions } from 'ngx-bootstrap/modal';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { catchError, shareReplay, switchMap, tap } from 'rxjs/operators';
import { AnalyticsService } from '../shared';

@Component({
  selector: 'a17t-extension',
  templateUrl: './extension-grid.component.html',
  styleUrls: ['./extension-grid.component.css']
})
export class ExtensionGridComponent implements OnInit {
  loading: boolean = false;
  cepOperationObject$: Subject<any>;
  cepCtrlStatus: any;
  cepId: string;
  loadingError: boolean = false;
  reload$: BehaviorSubject<boolean> = new BehaviorSubject(false);
  extensions$: Observable<IManagedObject[]>;
  listClass: string;
  rescue: boolean = false;

  constructor(
    private analyticsService: AnalyticsService,
    private wizardModalService: WizardModalService
  ) {}

  ngOnInit() {
    this.init();
  }

  async init() {
    const { microservice_application_id } =
      await this.analyticsService.getCepCtrlStatus();
    this.cepId = microservice_application_id as string;
    this.cepCtrlStatus = await this.analyticsService.getCepCtrlStatus();
    this.cepOperationObject$ = this.analyticsService.getCepOperationsObject();
    this.extensions$ = this.reload$.pipe(
      tap((clearCache) => {
        if (clearCache) {
          this.analyticsService.clearCaches();
        }
        this.loading = true;
        this.loadingError = false;
      }),
      switchMap(() => this.analyticsService.getExtensionsEnriched()),
      catchError(() => {
        this.loadingError = true;
        this.loading = false;
        return of([]);
      }),
      tap(() => (this.loading = false)),
      shareReplay()
    );

    this.reload$.next(false);
  }

  loadExtensions() {
    this.reload$.next(true);
  }

  restartCEP() {
    this.analyticsService.restartCEP();
  }

  addExtension() {
    const wizardConfig: WizardConfig = {
      headerText: 'Add extension',
      headerIcon: 'c8y-atom'
    };

    const initialState: any = {
      wizardConfig,
      id: 'uploadAnalyticsExtension'
    };

    const modalOptions: ModalOptions = { initialState };

    const modalRef = this.wizardModalService.show(modalOptions);
    modalRef.content.onClose.subscribe(() => {
      this.loadExtensions();
    });
  }
}
