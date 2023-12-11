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
import { BsModalService, ModalOptions } from "ngx-bootstrap/modal";
import { RescueModalComponent } from "./rescue/rescue-modal.component";

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
  extensions$: Observable<IManagedObject[]>;
  listClass: string;
  rescue: boolean = false;

  constructor(
    private analyticsService: AnalyticsService,
    private wizardModalService: WizardModalService,
    private bsModalService: BsModalService
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

  async troubleshoot() {
    const initialState = {
      cepId: await this.analyticsService.getCEP_Id(),
    };
    this.bsModalService.show(RescueModalComponent, {
      class: "modal-lg",
      initialState,
      ariaDescribedby: "modal-body",
      ariaLabelledBy: "modal-title",
      ignoreBackdropClick: true,
    }).content as RescueModalComponent;
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
