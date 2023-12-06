import { Component, OnInit } from "@angular/core";
import { IManagedObject } from "@c8y/client";
import { WizardConfig, WizardModalService } from "@c8y/ngx-components";
import { BehaviorSubject, Observable } from "rxjs";
import { shareReplay, switchMap, tap } from "rxjs/operators";
import { AnalyticsService } from "../../shared/analytics.service";
import { ModalOptions } from "ngx-bootstrap/modal";

@Component({
  selector: "extension",
  templateUrl: "./extension.component.html",
  styleUrls: ["./extension.component.css"],
})
export class AnalyticsExtensionComponent implements OnInit {
  reloading: boolean = false;
  reload$: BehaviorSubject<void> = new BehaviorSubject(null);
  subscription: any;
  extensions$: Observable<IManagedObject>;
  listClass: string;

  constructor(
    private analyticsService: AnalyticsService,
    private wizardModalService: WizardModalService
  ) {}

  ngOnInit() {
    this.extensions$ = this.reload$.pipe(
      tap(() => (this.reloading = true)),
      switchMap(() => this.analyticsService.getExtensionsEnriched()),
      tap(console.log),
      tap(() => (this.reloading = false)),
      shareReplay()
    );
    this.loadExtensions();
    this.initializeMonitoringService();
  }

  loadExtensions() {
    this.reload$.next();
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
