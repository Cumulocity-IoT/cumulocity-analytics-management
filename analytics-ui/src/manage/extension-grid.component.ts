import { Component, OnInit } from "@angular/core";
import { IManagedObject } from "@c8y/client";
import { WizardConfig, WizardModalService } from "@c8y/ngx-components";
import { BsModalService, ModalOptions } from "ngx-bootstrap/modal";
import { BehaviorSubject, Observable, Subject, of } from "rxjs";
import {
    catchError,
    shareReplay,
    switchMap,
    tap,
} from "rxjs/operators";
import { AnalyticsService } from "../shared";

@Component({
  selector: "extension",
  templateUrl: "./extension-grid.component.html",
  styleUrls: ["./extension-grid.component.css"],
})
export class ExtensionGridComponent implements OnInit {
  loading: boolean = false;
  restarting$: Subject<boolean>;
  loadingError: boolean = false;
  reload$: BehaviorSubject<boolean> = new BehaviorSubject(false);
  subscription: any;
  extensions$: Observable<IManagedObject[]>;
  listClass: string;
  rescue: boolean = false;

  constructor(
    private analyticsService: AnalyticsService,
    private wizardModalService: WizardModalService,
  ) {}

  ngOnInit() {
    this.restarting$ = this.analyticsService.getCEP_Restarting();
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
    this.initializeMonitoringService();
  }

  loadExtensions() {
    this.reload$.next(true);
  }

  restartCEP() {
    this.analyticsService.restartCEP();
  }

  addExtension() {
    const wizardConfig: WizardConfig = {
      headerText: "Add extension",
      headerIcon: "c8y-atom",
    };

    const initialState: any = {
      wizardConfig,
      id: "uploadAnalyticsExtension",
    };

    const modalOptions: ModalOptions = { initialState };

    const modalRef = this.wizardModalService.show(modalOptions);
    modalRef.content.onClose.subscribe(() => {
      this.loadExtensions();
    });
  }

  private async initializeMonitoringService(): Promise<void> {
    this.subscription =
      await this.analyticsService.subscribeMonitoringChannel();
  }

  ngOnDestroy(): void {
    console.log("Stop subscription");
    this.analyticsService.unsubscribeFromMonitoringChannel(this.subscription);
  }
}
