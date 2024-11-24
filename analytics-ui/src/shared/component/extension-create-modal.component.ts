import { Component, Input, OnInit, Output } from '@angular/core';
import { AlertService, ModalLabels } from '@c8y/ngx-components';
import { BehaviorSubject, Subject, from } from 'rxjs';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { FormGroup } from '@angular/forms';
import { AnalyticsService } from '../analytics.service';
import { saveAs } from 'file-saver';
import { APPLICATION_ANALYTICS_BUILDER_SERVICE, CEP_Block } from '../analytics.model';
import { CustomSwitchField } from './custom-switch-field';

@Component({
  selector: 'a17t-extension-create-modal',
  templateUrl: './extension-create-modal.component.html'
})
export class ExtensionCreateComponent implements OnInit {
  @Output() closeSubject: Subject<any> = new Subject();
  @Input() monitors: CEP_Block[];
  configuration: any = {};

  configFormlyFields: FormlyFieldConfig[] = [];
  configFormly: FormGroup = new FormGroup({});
  labels: ModalLabels = { cancel: 'Dismiss' };
  loading: boolean = false;
  backendDeployed$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );

  constructor(
    public analyticsService: AnalyticsService,
    public alertService: AlertService
  ) { }

  ngOnInit() {
    this.isDeployed();
    this.configFormlyFields = [
      {
        fieldGroupClassName: 'row',
        fieldGroup: [
          {
            className: 'col-lg-12',
            key: 'name',
            type: 'input',
            wrappers: ['c8y-form-field'],
            templateOptions: {
              label: 'Name Extension',
              required: true
            }
          }
        ]
      },
      {
        fieldGroupClassName: 'row',
        fieldGroup: [
          {
            className: 'col-lg-6',
            key: 'upload',
            type: CustomSwitchField,
            defaultValue: false,
            wrappers: ['c8y-form-field'],
            templateOptions: {
              label: 'Upload extension',
              switchMode: true,
              description:
                'The generated extension for the selected blocks is uploaded. After deploying they are available in the Analytics Builder model pallet.'
            }
          },
          {
            className: 'col-lg-6',
            key: 'deploy',
            type: CustomSwitchField,
            defaultValue: false,
            wrappers: ['c8y-form-field'],
            templateOptions: {
              label: 'Deploy automatically',
              switchMode: true,
              description:
                'Deploy the extension after uploading to the repository.'
            },
            hideExpression: () => !this.configuration.upload
          }
        ]
      }
    ];
  }

  onDismiss(event) {
    console.log(`Dismiss ${event}`);
    this.closeSubject.next(undefined);
  }

  async isDeployed() {
    from(this.analyticsService.isBackendDeployed()).subscribe((status) => {
      this.backendDeployed$.next(status);
      if (!status) {
        this.alertService.warning(
          `You cannot build custom extension unless you deploy the backend microservice ${APPLICATION_ANALYTICS_BUILDER_SERVICE}!`
        );
      }
    });
  }

  async createExtension() {
    this.loading = true;
    console.log('Create extension');
    const response = await this.analyticsService.createExtensionZIP(
      this.configuration.name,
      this.configuration.upload,
      this.configuration.deploy,
      this.monitors
    );
    const binary = await await response.arrayBuffer();
    this.loading = false;
    const blob = new Blob([binary], {
      type: 'application/x-zip-compressed'
    });

    if (!this.configuration.upload) {
      saveAs(blob, `${this.configuration.name}.zip`);
      this.alertService.success(
        `Created extension ${this.configuration.name}.zip. Please deploy from UI.`
      );
    } else {
      this.alertService.success(
        `Uploaded extension ${this.configuration.name}.zip.`
      );
    }
    this.closeSubject.next(true);
  }

  onClose(){
    this.closeSubject.next(false);
  }
}
