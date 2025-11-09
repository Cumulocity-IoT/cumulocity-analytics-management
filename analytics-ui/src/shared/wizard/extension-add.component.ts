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
import JSZip from 'jszip';

interface UploadState {
  isLoading: boolean;
  isComplete: boolean;
  errorMessage: string | null;
  file: File | null;
  extension: Partial<IManagedObject> | null;
  requiresUpdate: boolean;
}

interface MonitorMetadata {
  custom: boolean;
  file: string;
  id: string;
  name: string;
  type: string;
  category?: string;
  description?: string;
  inputs?: any[];
  outputs?: any[];
  parameters?: any[];
}

interface BuildInformation {
  build_type: string;
  monitors: MonitorMetadata[];
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

      // Analyze ZIP content
      const buildInformation = await this.analyzeZipContent(file);

      this.state.extension = existingExtension || {
        pas_extension: extensionName,
        name: extensionName,
        build_information: buildInformation
      };

      // Add build_information to existing extension as well
      if (existingExtension) {
        this.state.extension.build_information = buildInformation;
      }

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

  /**
   * Analyzes the ZIP file content to extract monitor information
   */
  private async analyzeZipContent(file: File): Promise<BuildInformation> {
    try {
      const zip = await JSZip.loadAsync(file);
      const monitors: MonitorMetadata[] = [];

      // Find all .mon files
      const monitorFiles: string[] = [];
      zip.forEach((relativePath, zipEntry) => {
        if (relativePath.endsWith('.mon') && !zipEntry.dir) {
          monitorFiles.push(relativePath);
        }
      });

      // Process each monitor file
      for (const monitorPath of monitorFiles) {
        const monitorName = this.extractMonitorName(monitorPath);
        const metadataPath = `events/${monitorName}_metadata.evt`;

        // Try to find corresponding metadata file
        const metadataFile = zip.file(metadataPath);
        
        const monitorMetadata: MonitorMetadata = {
          custom: true,
          file: monitorPath.split('/').pop()!,
          id: `apamax.analyticsbuilder.custom.${monitorName}`,
          name: monitorName,
          type: 'file'
        };

        // Parse metadata if available
        if (metadataFile) {
          try {
            const metadataContent = await metadataFile.async('text');
            const parsedMetadata = this.parseEventMetadata(metadataContent);
            
            if (parsedMetadata) {
              monitorMetadata.category = parsedMetadata.category;
              monitorMetadata.description = parsedMetadata.description;
              monitorMetadata.inputs = parsedMetadata.inputs;
              monitorMetadata.outputs = parsedMetadata.outputs;
              monitorMetadata.parameters = parsedMetadata.parameters;
              
              // Use the ID from metadata if available
              if (parsedMetadata.id) {
                monitorMetadata.id = parsedMetadata.id;
              }
            }
          } catch (error) {
            console.warn(`Failed to parse metadata for ${monitorName}:`, error);
          }
        }

        monitors.push(monitorMetadata);
      }

      return {
        build_type: 'external',
        monitors: monitors
      };
    } catch (error) {
      console.error('Failed to analyze ZIP content:', error);
      throw new Error('Failed to analyze extension package');
    }
  }

  /**
   * Extracts monitor name from file path
   * e.g., "monitors/BasicAnomalyDetection.mon" -> "BasicAnomalyDetection"
   */
  private extractMonitorName(filePath: string): string {
    const fileName = filePath.split('/').pop() || '';
    return fileName.replace('.mon', '');
  }

  /**
   * Parses the .evt metadata file content
   * Format: "analyticsbuilder.metadata.requests",apama.analyticsbuilder.BlockMetadata("Name", "EN", "{...json...}")
   */
  private parseEventMetadata(content: string): any | null {
    try {
      // Extract JSON from the metadata format
      const jsonMatch = content.match(/BlockMetadata\([^,]+,\s*"[^"]+",\s*"({.*})"\)/);
      
      if (!jsonMatch || !jsonMatch[1]) {
        return null;
      }

      // Unescape the JSON string
      const jsonString = jsonMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');

      const metadata = JSON.parse(jsonString);
      
      // Extract analytics information (first element in analytics array)
      if (metadata.analytics && metadata.analytics.length > 0) {
        return metadata.analytics[0];
      }

      return null;
    } catch (error) {
      console.error('Failed to parse event metadata:', error);
      return null;
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
      throw error;
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