import { Component, Input, OnInit, Output } from "@angular/core";
import { AlertService, ModalLabels } from "@c8y/ngx-components";
import { BehaviorSubject, Subject } from "rxjs";
import { FormlyFieldConfig } from "@ngx-formly/core";
import { FormGroup } from "@angular/forms";
import { AnalyticsService } from "../shared/analytics.service";

@Component({
  selector: "name-extension-modal",
  template: `<c8y-modal
    title="Edit properties extension"
    (onClose)="onSave($event)"
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
      </div>
    </div>
  </c8y-modal>`,
})
export class NameExtensionComponent implements OnInit {
  @Output() closeSubject: Subject<any> = new Subject();
  @Input() monitors: string[];
  configuration: any = {};

  configFormlyFields: FormlyFieldConfig[] = [];
  configFormly: FormGroup = new FormGroup({});
  labels: ModalLabels = { ok: "Create extension", cancel: "Dismiss" };

  constructor(
    public analyticsService: AnalyticsService,
    public alertService: AlertService,
  ) {}
  ngOnInit(): void {
    this.configFormlyFields = [
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
    ];
  }

  onDismiss(event) {
    console.log("Dismiss");
    this.closeSubject.next(undefined);
  }

  async onSave(event) {
    console.log("Save");
    const response = await this.analyticsService.createExtensionsZIP(
      this.configuration.name,
      this.monitors
    );
    this.closeSubject.next(this.configuration);
  }

  get progress(): BehaviorSubject<number> {
    return this.progress;
  }

}
