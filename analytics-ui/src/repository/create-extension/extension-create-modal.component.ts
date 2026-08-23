import { Component, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { AlertService, CoreModule, ModalLabels } from '@c8y/ngx-components';
import { BehaviorSubject, Subject, from } from 'rxjs';
import { AnalyticsService } from '../../shared/analytics.service';
import { APPLICATION_ANALYTICS_BUILDER_SERVICE, Repository, RepositoryItem } from '../../shared/analytics.model';
import { RepositoryService } from '../../shared';
import { PopoverModule } from 'ngx-bootstrap/popover';

@Component({
  selector: 'a17t-extension-create-modal',
  templateUrl: './extension-create-modal.component.html',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, CoreModule, PopoverModule]
})
export class ExtensionCreateComponent implements OnInit {
  @Output() closeSubject: Subject<unknown> = new Subject();
  @Input() monitors!: RepositoryItem[];
  @Input() sections!: string[];
  @Input() activeRepository!: Repository;

  configForm: FormGroup = new FormGroup({
    name: new FormControl('', Validators.required),
    deploy: new FormControl(true)
  });

  labels: ModalLabels = { cancel: 'Dismiss' };
  loading: boolean = false;
  backendDeployed$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  configurationIsExtension!: boolean;
  // Building from a plain list of selected files works client-side, without
  // the backend — only the yaml-sections and whole-repository build paths
  // need it (see isDeployed()). Starts true so the button stays disabled
  // during the initial isBackendServiceAvailable() check, same as before.
  requiresBackend = true;

  constructor(
    public analyticsService: AnalyticsService,
    public repositoryService: RepositoryService,
    public alertService: AlertService
  ) { }

  ngOnInit() {
    this.configurationIsExtension = !!this.sections;
    if (this.monitors && this.monitors.length > 0) {
      this.configForm.get('name')?.setValue(this.monitors[0].name);
    }
    this.isDeployed();
  }

  onDismiss(_event: any) {
    this.closeSubject.next(undefined);
  }

  async isDeployed() {
    from(this.analyticsService.isBackendServiceAvailable()).subscribe((status) => {
      this.backendDeployed$.next(status);
      if (status) {
        this.requiresBackend = false;
        return;
      }
      // Building from a plain list of selected files now works client-side,
      // without the backend — only the yaml-sections and whole-repository
      // build paths still require it (see RepositoryService.isBackendMode).
      this.requiresBackend = this.configurationIsExtension || !(this.monitors?.length > 0);
      if (this.requiresBackend) {
        this.alertService.warning(
          `Building an extension from ${this.configurationIsExtension ? 'extensions.yaml sections' : 'a whole repository path'} requires the backend microservice ${APPLICATION_ANALYTICS_BUILDER_SERVICE} to be deployed!`
        );
      }
    });
  }

  async createExtension() {
    this.loading = true;
    let response;
    const configName = String(this.configForm.get('name')?.value || 'extension');
    const deploy = this.configForm.get('deploy')?.value ?? true;

    if (this.monitors && this.monitors.length > 0) {
      if (this.sections && this.sections.length > 0) {
        response = await this.repositoryService.createExtensionFromYaml(
          configName, this.monitors[0], this.sections, this.activeRepository, true, deploy
        );
      } else {
        response = await this.repositoryService.createExtensionFromList(
          configName, this.monitors, this.activeRepository, true, deploy
        );
      }
    } else {
      response = await this.repositoryService.createExtensionFromRepository(
        configName, this.activeRepository, true, deploy
      );
    }
    if (response.status < 400) {
      this.loading = false;
      if (deploy) {
        this.alertService.success(
          `Created extension ${configName}.zip has been uploaded and Streaming Analytics Engine is restarting ...`
        );
      } else {
        this.alertService.success(
          `The selected blocks have been uploaded. They will be available in Analytics Builder after the next Apama restart.`
        );
      }
    }
    // No generic failure alert here: RepositoryService already shows a
    // specific one for every failure path (backend or browser-mode).
    this.closeSubject.next(true);
  }

  onClose() {
    this.closeSubject.next(false);
  }
}
