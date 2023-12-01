import { Component, Input, OnInit, Output } from "@angular/core";
import { AlertService, ModalLabels } from "@c8y/ngx-components";
import { BehaviorSubject, Subject, from } from "rxjs";
import { FormlyFieldConfig } from "@ngx-formly/core";
import { FormGroup } from "@angular/forms";
import { AnalyticsService } from "../shared/analytics.service";
import { saveAs } from "file-saver";
import { APPLICATION_ANALYTICS_BUILDER_SERVICE } from "../shared/analytics.model";

@Component({
  selector: "name-extension-modal",
  template: `<c8y-modal
    title="Edit properties extension"
    (onDismiss)="onDismiss($event)"
    [labels]="labels"
    [headerClasses]="'modal-header dialog-header'"
  >
    <div class="card-block">
      <div [formGroup]="configFormly">
        <formly-form
          [form]="configFormly"
          [fields]="configFormlyFields"
          [model]="configuration"
        ></formly-form>
        <div class="col-lg-8">
          <button
            class="btn btn-default"
            title="{{ 'Create Extension' | translate }}"
            (click)="createExtension()"
            [disabled]="((backendDeployed$ | async) === false) || !configFormly.valid"
          >
            <i c8yIcon="plugin"></i>
            {{ "Create Extension" | translate }}
          </button>
        </div>
      </div>
    </div>
    <div *ngIf="loading"><c8y-loading></c8y-loading></div>
  </c8y-modal>`,
})
export class CreateExtensionComponent implements OnInit {
  @Output() closeSubject: Subject<any> = new Subject();
  @Input() monitors: string[];
  configuration: any = {};

  configFormlyFields: FormlyFieldConfig[] = [];
  configFormly: FormGroup = new FormGroup({});
  labels: ModalLabels = { cancel: "Dismiss" };
  loading: boolean = false;
  backendDeployed$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );

  constructor(
    public analyticsService: AnalyticsService,
    public alertService: AlertService
  ) {}

  ngOnInit() {
    this.isDeployed();
    this.configFormlyFields = [
      {
        fieldGroupClassName: "row",
        fieldGroup: [
          {
            className: "col-lg-12",
            key: "name",
            type: "input",
            wrappers: ["c8y-form-field"],
            templateOptions: {
              label: "Name Extension",
              required: true,
            },
          },
        ],
      },
      {
        fieldGroupClassName: "row",
        fieldGroup: [
          {
            className: "col-lg-6",
            key: "upload",
            type: "custom-switch",
            defaultValue: false,
            wrappers: ["c8y-form-field"],
            templateOptions: {
              label: "Upload Extension",
              switchMode: true,
              description:
                "The generated extension for the selected blocks is uploaded. After deploying they are available in the Analytics Builder model pallet.",
            },
          },
          {
            className: "col-lg-6",
            key: "deploy",
            type: "custom-switch",
            defaultValue: false,
            wrappers: ["c8y-form-field"],
            templateOptions: {
              label: "Deploy automatically",
              switchMode: true,
              description:
                "Deploy the extension after uploading to the repository.",
            },
            hideExpression: () =>
              !this.configuration.upload
          },
        ],
      },
    ];
  }

  onDismiss(event) {
    console.log("Dismiss");
    this.closeSubject.next(undefined);
  }

  async isDeployed() {
    from(this.analyticsService.isBackendDeployed()).subscribe((status) => {
      this.backendDeployed$.next(status);
      if (!status) {
        this.alertService.warning(
          `You can not build custom extension unless you deploy the backend microservice ${APPLICATION_ANALYTICS_BUILDER_SERVICE}!`
        );
      }
    });
  }

  async createExtension() {
    this.loading = true;
    console.log("Create Extension");
    const response = await this.analyticsService.createExtensionZIP(
      this.configuration.name,
      this.configuration.upload,
      this.configuration.deploy,
      this.monitors
    );
    const binary = await await response.arrayBuffer();
    this.loading = false;
    const blob = new Blob([binary], {
      type: "application/x-zip-compressed",
    });

    if (!this.configuration.upload) {
      saveAs(blob, `${this.configuration.name}.zip`);
      this.alertService.success(
        `Created extension ${this.configuration.name}.zip. Please deploy from UI.`
      );
    } else {
      this.alertService.success(
        `Uploaded extension ${this.configuration.name}.zip. Please deploy from UI.`
      );
    }
    this.closeSubject.next(true);
  }
}
