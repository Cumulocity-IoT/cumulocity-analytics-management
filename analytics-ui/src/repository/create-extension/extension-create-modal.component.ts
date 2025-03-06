import { Component, Input, OnInit, Output } from '@angular/core';
import { AlertService, ModalLabels } from '@c8y/ngx-components';
import { BehaviorSubject, Subject, from } from 'rxjs';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { FormGroup } from '@angular/forms';
import { AnalyticsService } from '../../shared/analytics.service';
import { APPLICATION_ANALYTICS_BUILDER_SERVICE, CEP_Block, Repository } from '../../shared/analytics.model';

@Component({
  selector: 'a17t-extension-create-modal',
  templateUrl: './extension-create-modal.component.html'
})
export class ExtensionCreateComponent implements OnInit {
  @Output() closeSubject: Subject<any> = new Subject();
  @Input() monitors: CEP_Block[];
  @Input() activeRepository: Repository;
  configuration: any = {};

  configFormlyFields: FormlyFieldConfig[] = [];
  configFormly: FormGroup = new FormGroup({});
  labels: ModalLabels = { cancel: 'Dismiss' };
  loading: boolean = false;
  backendDeployed$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );
  readonly DESCRIPTOR_YAML = "extensions.yaml";

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
            className: 'col-lg-12',
            template: '<div class="">Only after the restart, blocks are available to models in the Analytics Builder</div>',
          },
          {
            className: 'col-lg-12',
            key: 'deploy',
            type: 'switch',
            defaultValue: true,
            wrappers: ['c8y-form-field'],
            templateOptions: {
              label: 'Restart to deploy',
              switchMode: true,
              hideLabel: true,
            }
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
    let response;

    if (this.monitors && this.monitors.length > 0) {
      if (this.monitors[0].file === this.DESCRIPTOR_YAML) {
        response = await this.analyticsService.createExtensionFromYaml(
          this.configuration.name,
          this.monitors[0],
          this.activeRepository,
          true,
          this.configuration.deploy,
        );
      } else {
        response = await this.analyticsService.createExtensionFromList(
          this.configuration.name,
          this.monitors,
          this.activeRepository,
          true,
          this.configuration.deploy,
        );
      }
    } else {
      response = await this.analyticsService.createExtensionFromRepository(
        this.configuration.name,
        true,
        this.configuration.deploy,
        this.activeRepository
      );
    }
    if (response.status < 400) {
      const binary = await await response.arrayBuffer();
      this.loading = false;
      // const blob = new Blob([binary], {
      //   type: 'application/x-zip-compressed'
      // });
      // if (!this.configuration.upload) {
      //   saveAs(blob, `${this.configuration.name}.zip`);
      //   this.alertService.success(
      //     `Created extension ${this.configuration.name}.zip. Please deploy from UI.`
      //   );
      // } else {
      //   this.alertService.success(
      //     `Uploaded extension ${this.configuration.name}.zip.`
      //   );
      // }
      if (this.configuration.deploy) {
        this.alertService.success(
          `Created extension ${this.configuration.name}.zip has been uploaded and Streaming Analytics Engine is restarting ...`
        );
      } else {
        this.alertService.success(
          `The selected blocks have been uploaded. They will be available in Analytics Builder after the next Apama restart.`
        );
      }
    } else {
      this.alertService.warning(
        `Uploaded extension ${this.configuration.name}.zip was not successful`
      );
    }
    this.closeSubject.next(true);
  }

  onClose() {
    this.closeSubject.next(false);
  }
}
