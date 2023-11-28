import { Component, Input, OnInit, Output } from "@angular/core";
import { ModalLabels } from "@c8y/ngx-components";
import { Subject } from "rxjs";
import { FormlyFieldConfig } from "@ngx-formly/core";
import { FormGroup } from "@angular/forms";

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
  configuration: any = {};

  configFormlyFields: FormlyFieldConfig[] = [];
  configFormly: FormGroup = new FormGroup({});
  labels: ModalLabels = { ok: "Create extension", cancel: "Dismiss" };

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

  onSave(event) {
    console.log("Save");
    this.closeSubject.next(this.configuration);
  }

}
