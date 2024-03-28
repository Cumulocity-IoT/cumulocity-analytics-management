import { Component, Input, ViewChild } from '@angular/core';
import {
  ApplicationService,
  IManagedObject,
  IResultList
} from '@c8y/client';
import {
  AlertService,
  DropAreaComponent,
  WizardComponent
} from '@c8y/ngx-components';
import { BehaviorSubject } from 'rxjs';
import { ERROR_MESSAGES } from '../analytics.constants';
import { AnalyticsService } from '../analytics.service';
import { UploadMode } from '../analytics.model';

@Component({
  selector: 'a17t-extension-add',
  templateUrl: './extension-add.component.html'
})
export class ExtensionAddComponent {
  @Input() headerText: string;
  @Input() headerIcon: string;
  @Input() successText: string;
  @Input() uploadExtensionHandler: any;
  @Input() mode: UploadMode;

  @ViewChild(DropAreaComponent) dropAreaComponent;

  isLoading: boolean;
  isAppCreated: boolean;
  showUpdateDialog$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );
  createdApp: Partial<IManagedObject>;
  canOpenInBrowser: boolean = false;
  errorMessage: string;
  fileToUpload: File;
  private uploadCanceled: boolean = false;

  constructor(
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private applicationService: ApplicationService,
    private wizardComponent: WizardComponent
  ) {}

  get progress(): BehaviorSubject<number> {
    return this.analyticsService.progress;
  }

  onFileDroppedEvent(event) {
    if (event && event.length > 0) {
      const [file] = event;
      this.onFile(file.file);
    }
  }

  async onFile(file: File) {
    this.fileToUpload = file;
    this.isLoading = true;
    this.errorMessage = null;
    this.progress.next(0);
    const n = file.name.split('.').slice(0, -1).join('.');
    try {
      this.createdApp = {
        pas_extension: n,
        name: n
      };
      const result: IResultList<IManagedObject> =
        await this.analyticsService.getExtensionsMetadataFromInventory();
      const { data } = result;
      for (let i = 0; i < data.length; i++) {
        const ext = data[i];
        if (ext.name == n) {
          if (this.mode == 'add') this.errorMessage = `Extension with the same name ${ext.name} exists!`;
          this.showUpdateDialog$.next(true);
          this.createdApp = ext;
          break;
        }
      }
      if (!this.errorMessage) {
        await this.uploadExtension(this.mode);
      }
    } catch (ex) {
      this.analyticsService.cancelExtensionCreation(this.createdApp);
      this.createdApp = null;
      this.dropAreaComponent.onDelete();
      this.errorMessage = ERROR_MESSAGES[ex.message];
      if (!this.errorMessage && !this.uploadCanceled) {
        this.alertService.addServerFailure(ex);
      }
    }
    this.progress.next(100);
    this.isLoading = false;
  }

  private async uploadExtension(mode: UploadMode) {
    await this.uploadExtensionHandler(
      this.fileToUpload,
      this.createdApp,
      mode
    );
    this.alertService.success('Uploaded new extension.');
    this.isAppCreated = true;
    this.progress.next(100);
    this.isLoading = false;
    this.showUpdateDialog$.next(false);
  }

  cancel() {
    this.cancelFileUpload();
    this.wizardComponent.close();
  }

  done() {
    this.wizardComponent.close();
  }

  private cancelFileUpload() {
    this.uploadCanceled = true;
    this.analyticsService.cancelExtensionCreation(this.createdApp);
    this.createdApp = null;
  }
}
