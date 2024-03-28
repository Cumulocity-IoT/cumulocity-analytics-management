import {
  Component,
  Input,
  ViewChild
} from '@angular/core';
import { IManagedObject, IResultList } from '@c8y/client';
import {
  AlertService,
  DropAreaComponent,
  WizardComponent
} from '@c8y/ngx-components';
import { BehaviorSubject } from 'rxjs';
import { ERROR_MESSAGES } from '../analytics.constants';
import { AnalyticsService } from '../analytics.service';
import { UploadMode } from '../analytics.model';
import { ConfirmationModalComponent } from '../component/confirmation-modal.component';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';

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
  isUpdate: boolean = false;
  isAppCreated: boolean;
  createdApp: Partial<IManagedObject>;
  errorMessage: string;
  fileToUpload: File;
  uploadCanceled: boolean = false;

  constructor(
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private wizardComponent: WizardComponent,
    private bsModalService: BsModalService
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
          this.createdApp = ext;
          this.isUpdate = true;
          break;
        }
      }
      if (this.isUpdate) {
          this.done();
          this.confirmUpdate();
      } else {
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
    await this.uploadExtensionHandler(this.fileToUpload, this.createdApp, mode);
    this.alertService.success('Uploaded new extension.');
    this.isAppCreated = true;
    this.progress.next(100);
    this.isLoading = false;
  }

  cancel() {
    this.cancelFileUpload();
    this.wizardComponent.close();
  }

  done() {
    this.wizardComponent.close();
  }

  cancelFileUpload() {
    this.uploadCanceled = true;
    this.analyticsService.cancelExtensionCreation(this.createdApp);
    this.createdApp = null;
  }
  confirmUpdate() {
    const initialState = {
      title: 'Update extension',
      message: `Extension with the same name ${this.createdApp.name} exists! Do you want to proceed?`,
      labels: {
        ok: 'Update',
        cancel: 'Cancel'
      }
    };
    const confirmDeletionModalRef: BsModalRef = this.bsModalService.show(
      ConfirmationModalComponent,
      { initialState }
    );
    confirmDeletionModalRef.content.closeSubject.subscribe(
      async (result: boolean) => {
        console.log('Confirmation delete result:', result);
        if (result) {
          try {
            await this.uploadExtension('update');
            this.analyticsService.initiateReload(true);
          } catch (ex) {
            if (ex) {
              this.alertService.addServerFailure(ex);
            }
          }
        }
        confirmDeletionModalRef.hide();
      }
    );
  }
}
