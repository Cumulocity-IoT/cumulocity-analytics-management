import {
  Component,
  Input,
  ViewChild,
  OnDestroy
} from '@angular/core';
import { IManagedObject } from '@c8y/client';
import {
  AlertService,
  DropAreaComponent,
  WizardComponent
} from '@c8y/ngx-components';
import { BehaviorSubject, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ERROR_MESSAGES } from '../analytics.constants';
import { AnalyticsService } from '../analytics.service';
import { UploadMode } from '../analytics.model';
import { ConfirmationModalComponent } from '../component/confirmation-modal.component';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';

interface UploadState {
  isLoading: boolean;
  isComplete: boolean;
  errorMessage: string | null;
  file: File | null;
  extension: Partial<IManagedObject> | null;
  requiresUpdate: boolean;
}

@Component({
  selector: 'a17t-extension-add',
  templateUrl: './extension-add.component.html',
  standalone: false
})
export class ExtensionAddComponent implements OnDestroy {
  @Input() headerText: string;
  @Input() headerIcon: string;
  @Input() successText: string;
  @Input() uploadExtensionHandler: (
    file: File,
    extension: Partial<IManagedObject>,
    mode: UploadMode
  ) => Promise<any>;
  @Input() mode: UploadMode;

  @ViewChild(DropAreaComponent) dropAreaComponent: DropAreaComponent;

  state: UploadState = {
    isLoading: false,
    isComplete: false,
    errorMessage: null,
    file: null,
    extension: null,
    requiresUpdate: false
  };

  private destroy$ = new Subject<void>();
  private modalRef: BsModalRef | null = null;

  constructor(
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private wizardComponent: WizardComponent,
    private bsModalService: BsModalService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanup();
  }

  get progress(): BehaviorSubject<number> {
    return this.analyticsService.uploadProgress$;
  }

  // Getters for template
  get isLoading(): boolean {
    return this.state.isLoading;
  }

  get isComplete(): boolean {
    return this.state.isComplete;
  }

  get errorMessage(): string | null {
    return this.state.errorMessage;
  }

  get createdApp(): Partial<IManagedObject> | null {
    return this.state.extension;
  }

  onFileDroppedEvent(event: any[]): void {
    if (event?.length > 0) {
      const [fileWrapper] = event;
      this.onFile(fileWrapper.file);
    }
  }

  async onFile(file: File): Promise<void> {
    this.resetState();
    this.state.file = file;
    this.state.isLoading = true;
    this.progress.next(0);

    try {
      const extensionName = this.extractExtensionName(file.name);
      const existingExtension = await this.findExistingExtension(extensionName);

      this.state.extension = existingExtension || {
        pas_extension: extensionName,
        name: extensionName
      };

      this.state.requiresUpdate = !!existingExtension;

      if (this.state.requiresUpdate && this.mode === 'add') {
        this.handleUpdateRequired();
      } else {
        await this.performUpload(this.mode);
      }
    } catch (error) {
      this.handleUploadError(error);
    } finally {
      this.finalizeUpload();
    }
  }

  cancel(): void {
    this.cleanup();
    this.wizardComponent.close();
  }

  done(): void {
    this.wizardComponent.close();
  }

  private extractExtensionName(fileName: string): string {
    return fileName.split('.').slice(0, -1).join('.');
  }

  private async findExistingExtension(
    name: string
  ): Promise<IManagedObject | null> {
    const extensions = await this.analyticsService.getExtensionsFromInventory();
    return extensions.find(ext => ext.name === name) || null;
  }

  private handleUpdateRequired(): void {
    this.done();
    this.showUpdateConfirmation();
  }

  private async performUpload(mode: UploadMode): Promise<void> {
    try {
      const result = await this.uploadExtensionHandler(
        this.state.file!,
        this.state.extension!,
        mode
      );

      if (result) {
        this.handleUploadSuccess(mode);
      } else {
        this.handleUploadFailure();
      }
    } catch (error) {
      throw error; // Re-throw to be caught by outer try-catch
    }
  }

  private handleUploadSuccess(mode: UploadMode): void {
    const action = mode === 'update' ? 'Updated' : 'Uploaded';
    this.alertService.success(`${action} extension successfully.`);
    this.state.isComplete = true;
    this.progress.next(100);
  }

  private handleUploadFailure(): void {
    this.state.errorMessage = 'Could not create extension!';
    this.state.isComplete = false;
  }

  private handleUploadError(error: any): void {
    this.cleanup();
    this.dropAreaComponent?.onDelete();
    
    this.state.errorMessage = ERROR_MESSAGES[error?.message] || null;
    
    if (!this.state.errorMessage && error) {
      this.alertService.addServerFailure(error);
    }
  }

  private finalizeUpload(): void {
    this.progress.next(100);
    this.state.isLoading = false;
  }

  private showUpdateConfirmation(): void {
    const initialState = {
      title: 'Update extension',
      message: `Extension "${this.state.extension!.name}" already exists. Do you want to update it?`,
      labels: {
        ok: 'Update',
        cancel: 'Cancel'
      }
    };

    this.modalRef = this.bsModalService.show(
      ConfirmationModalComponent,
      { initialState }
    );

    this.modalRef.content.closeSubject
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (confirmed: boolean) => {
        if (confirmed) {
          await this.handleUpdateConfirmed();
        }
        this.modalRef?.hide();
        this.modalRef = null;
      });
  }

  private async handleUpdateConfirmed(): Promise<void> {
    try {
      this.state.isLoading = true;
      await this.performUpload('update');
      this.analyticsService.triggerCacheReload(true);
    } catch (error) {
      console.error('Update failed:', error);
      if (error) {
        this.alertService.addServerFailure(error);
      }
    } finally {
      this.state.isLoading = false;
    }
  }

  private cleanup(): void {
    if (this.state.extension && !this.state.isComplete) {
      this.analyticsService.cancelExtensionCreation(this.state.extension);
    }
    
    if (this.modalRef) {
      this.modalRef.hide();
      this.modalRef = null;
    }
  }

  private resetState(): void {
    this.state = {
      isLoading: false,
      isComplete: false,
      errorMessage: null,
      file: null,
      extension: null,
      requiresUpdate: false
    };
  }
}