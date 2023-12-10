import { Component, OnInit } from "@angular/core";
import { IManagedObject } from "@c8y/client";
import { WizardConfig, WizardModalService } from "@c8y/ngx-components";
import { BehaviorSubject, Observable, of, throwError } from "rxjs";
import {
  catchError,
  finalize,
  shareReplay,
  switchMap,
  tap,
} from "rxjs/operators";
import { AnalyticsService } from "../shared/analytics.service";
import { ModalOptions } from "ngx-bootstrap/modal";

@Component({
  selector: "extension",
  templateUrl: "./extension.component.html",
  styleUrls: ["./extension.component.css"],
})
export class AnalyticsExtensionComponent implements OnInit {
  loading: boolean = false;
  loadingError: boolean = false;
  reload$: BehaviorSubject<boolean> = new BehaviorSubject(false);
  subscription: any;
  extensions$: Observable<IManagedObject>;
  listClass: string;

  constructor(
    private analyticsService: AnalyticsService,
    private wizardModalService: WizardModalService
  ) {}

  ngOnInit() {
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
        return of(undefined);
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
      headerText: "Add Extension",
      headerIcon: "c8y-atom",
    };

    const initialState: any = {
      wizardConfig,
      id: "uploadAnalyticsExtention",
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
