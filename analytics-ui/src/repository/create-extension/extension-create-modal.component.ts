import { Component, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { AlertService, CoreModule, ModalLabels } from '@c8y/ngx-components';
import { BehaviorSubject, Subject, from } from 'rxjs';
import { FormlyFieldConfig, FormlyModule } from '@ngx-formly/core';
import { AnalyticsService } from '../../shared/analytics.service';
import { APPLICATION_ANALYTICS_BUILDER_SERVICE, Repository, RepositoryItem } from '../../shared/analytics.model';
import { ExtensionListComponent } from '../list/extension-list.component';
import { RepositoryService } from 'src/shared';
import { PopoverModule } from 'ngx-bootstrap/popover';

@Component({
  selector: 'a17t-extension-create-modal',
  templateUrl: './extension-create-modal.component.html',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CoreModule, FormlyModule, PopoverModule, ExtensionListComponent]
})
export class ExtensionCreateComponent implements OnInit {
  @Output() closeSubject: Subject<unknown> = new Subject();
  @Input() monitors!: RepositoryItem[];
  @Input() sections!: string[];
  @Input() activeRepository!: Repository;
  configuration: Record<string, unknown> = {};

  configFormlyFields: FormlyFieldConfig[] = [];
  configFormly: FormGroup = new FormGroup({});
  labels: ModalLabels = { cancel: 'Dismiss' };
  loading: boolean = false;
  backendDeployed$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );

  configurationIsExtension!: boolean;

  constructor(
    public analyticsService: AnalyticsService,
    public repositoryService: RepositoryService,
    public alertService: AlertService
  ) { }

  ngOnInit() {
    this.configurationIsExtension = !!this.sections;
    this.configuration['name'] = this.monitors && this.monitors.length > 0 ? this.monitors[0].name : undefined;
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
              required: true,
            },
            hideExpression: this.configurationIsExtension
          }
        ]
      },
      // Extension list display
      {
        fieldGroupClassName: 'row',
        fieldGroup: [
          {
            className: 'col-lg-12',
            key: 'extensions',
            type: ExtensionListComponent, // Custom type we'll define
            wrappers: ['c8y-form-field'],
            templateOptions: {
              label: 'Available Extensions',
              description: 'The following extensions will be included',
              extensionNames: this.sections || [], // Pass your extension names array here
              readonly: true
            },
            hideExpression: !this.configurationIsExtension
          }
        ]
      },
      {
        fieldGroupClassName: 'row',
        fieldGroup: [
          // {
          //   className: 'col-lg-12',
          //   template: '<div class="">Only after the restart, blocks are available to models in the Analytics Builder</div>',
          // },
          {
            className: 'col-lg-12',
            key: 'deploy',
            type: 'switch',
            defaultValue: true,
            wrappers: ['c8y-form-field'],
            templateOptions: {
              label: 'Restart to deploy',
              description: 'Only after the restart, blocks are available to models in the Analytics Builder',
              switchMode: true,
              hideLabel: true,
            }
          }
        ]
      }
    ];
  }

  onDismiss(_event: any) {
    console.log(`Dismiss ${event}`);
    this.closeSubject.next(undefined);
  }

  async isDeployed() {
    from(this.analyticsService.isBackendServiceAvailable()).subscribe((status) => {
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
    let response;
    const configName = String((this.configuration as any)?.name || 'extension');

    if (this.monitors && this.monitors.length > 0) {
      if (this.sections && this.sections.length > 0) {
        response = await this.repositoryService.createExtensionFromYaml(
          configName,
          this.monitors[0],
          this.sections,
          this.activeRepository,
          true,
          (this.configuration as any).deploy,
        );
      } else {
        response = await this.repositoryService.createExtensionFromList(
          configName,
          this.monitors,
          this.activeRepository,
          true,
          (this.configuration as any).deploy,
        );
      }
    } else {
      response = await this.repositoryService.createExtensionFromRepository(
        configName,
        this.activeRepository,
        true,
        (this.configuration as any).deploy,
      );
    }
    if (response.status < 400) {
      this.loading = false;
      if ((this.configuration as any).deploy) {
        this.alertService.success(
          `Created extension ${configName}.zip has been uploaded and Streaming Analytics Engine is restarting ...`
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
