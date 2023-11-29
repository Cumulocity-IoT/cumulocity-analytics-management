import { Component, Input, OnInit, Output } from "@angular/core";
import { AlertService, ModalLabels } from "@c8y/ngx-components";
import { Subject } from "rxjs";
import { FormlyFieldConfig } from "@ngx-formly/core";
import { FormGroup } from "@angular/forms";
import { AnalyticsService } from "../shared/analytics.service";
import { saveAs } from "file-saver";

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

  constructor(
    public analyticsService: AnalyticsService,
    public alertService: AlertService
  ) {}
  ngOnInit(): void {
    this.configFormlyFields = [
      {
        fieldGroup: [
          {
            className: "col-lg-8",
            key: "name",
            type: "input",
            wrappers: ["c8y-form-field"],
            templateOptions: {
              label: "Name Extension",
              required: true,
            },
          },
          {
            className: "col-lg-4",
            key: "upload",
            type: "switch",
            defaultValue: false,
            wrappers: ["c8y-form-field"],
            templateOptions: {
              label: "Upload Extension",
              description:
              "The generated extension for the selected blocks is uploaded. After initiating a restart they are available in the Analytics Builder model pallet.",
            },
          },
        ],
      },
    ];
  }

  onDismiss(event) {
    console.log("Dismiss");
    this.closeSubject.next(undefined);
  }

  async createExtension() {
    this.loading = true;
    console.log("Create Extension");
    const response = await this.analyticsService.createExtensionsZIP(
      this.configuration.name,
      this.configuration.upload,
      this.monitors
    );
    const binary = await await response.arrayBuffer();
    this.loading = false;
    const blob = new Blob([binary], {
      type: "application/x-zip-compressed",
    });
    saveAs(blob, `${this.configuration.name}.zip`);
    this.alertService.success(
      `Created extension ${this.configuration.name}.zip!`
    );
    this.closeSubject.next(true);
  }
}
