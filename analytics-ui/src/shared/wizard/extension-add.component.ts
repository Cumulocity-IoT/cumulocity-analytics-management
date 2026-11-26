import { gettext } from '@c8y/ngx-components/gettext';
import { MessageService } from '../message.service';
import { Component, Input, ViewChild, OnDestroy, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IManagedObject } from '@c8y/client';
import { AlertService, CoreModule, DropAreaComponent } from '@c8y/ngx-components';
import { BehaviorSubject, Subject } from 'rxjs';
import { take } from 'rxjs/operators';
import { ERROR_MESSAGES } from '../analytics.constants';
import { AnalyticsService } from '../analytics.service';
import { UploadMode } from '../analytics.model';
import { ParsedBlockMetadata, parseBlockMetadataEvt } from '../apama-block-metadata';
import { compareVersions, extractBlockFqns, splitExtensionVersion } from '../utils';
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
  /** All block ids of a file that defines more than one block. */
  blockIds?: string[];
}

interface FileMetadata {
  custom: boolean;
  file: string;
  name: string;
  type: string;
}

interface BuildInformation {
  build_type: string;
  /** The version taken off the file name: `Abs-1.0.1.zip` is the extension `Abs`, version `1.0.1`. */
  version?: string;
  monitors: MonitorMetadata[];
  files: FileMetadata[];
}

@Component({
  selector: 'a17t-extension-add',
  templateUrl: './extension-add.component.html',
  styleUrls: ['./extension-add.component.css'],
  imports: [CommonModule, CoreModule]
})
export class ExtensionAddComponent implements OnDestroy {
  private readonly messages = inject(MessageService);
  @Input() headerText!: string;
  @Input() headerIcon!: string;
  @Input() successText!: string;
  @Input() uploadExtensionHandler!: (
    file: File,
    extension: Partial<IManagedObject>,
    mode: UploadMode
  ) => Promise<any>;
  @Input() mode!: UploadMode;
  /** The extension a card update replaces. A package that resolves to another name needs a confirmation. */
  @Input() extensionToReplace?: Partial<IManagedObject>;
  /** Inside another wizard: that wizard owns the header and footer, this one only shows the upload. */
  @Input() embedded = false;
  readonly cancelled = output<void>();
  readonly completed = output<void>();
  /** Emits as soon as the upload succeeded, before the user presses Done. */
  readonly uploaded = output<void>();
  /** Emits while an upload is running, so a containing wizard can block navigation. */
  readonly loadingChange = output<boolean>();

  @ViewChild(DropAreaComponent) dropAreaComponent!: DropAreaComponent;

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
    private bsModalService: BsModalService
  ) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.cleanup();
  }

  get progress(): BehaviorSubject<number | null> {
    return this.analyticsService.uploadProgress$;
  }

  private setLoading(value: boolean): void {
    this.state.isLoading = value;
    this.loadingChange.emit(value);
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
    this.setLoading(true);
    this.progress.next(0);

    try {
      // The version is metadata: a newer version of the same extension then replaces the
      // installed one instead of installing next to it.
      const { name: extensionName, version } = splitExtensionVersion(
        await this.resolveExtensionName(file)
      );
      const existingExtension = await this.findExistingExtension(extensionName);

      const warnings = this.versionWarnings(extensionName, version, existingExtension);

      // Analyze ZIP content
      const buildInformation = {
        ...(await this.analyzeZipContent(file)),
        ...(version ? { version } : {})
      };

      this.state.extension = existingExtension || {
        pas_extension: extensionName,
        name: extensionName,
        build_information: buildInformation
      };

      // Add build_information to existing extension as well
      if (existingExtension) {
        this.state.extension['build_information'] = buildInformation;
      }

      this.state.requiresUpdate = !!existingExtension;

      if (this.state.requiresUpdate && this.mode === 'add') {
        this.handleUpdateRequired(warnings);
      } else if (
        warnings.length > 0 &&
        !(await this.confirm(gettext('Update extension'), warnings.join(' '), gettext('Upload')))
      ) {
        // Declined: nothing was uploaded and nothing may be rolled back.
        this.state.extension = null;
        this.state.file = null;
        this.dropAreaComponent?.onDelete();
      } else {
        await this.performUpload(this.mode);
      }
    } catch (error) {
      this.handleCreationFailure(error);
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
      const files: FileMetadata[] = [];

      // Track processed files to avoid duplicates
      const processedFiles = new Set<string>();

      // Find all .mon files
      const monitorFiles: string[] = [];
      zip.forEach((relativePath, zipEntry) => {
        if (relativePath.endsWith('.mon') && !zipEntry.dir) {
          monitorFiles.push(relativePath);
          processedFiles.add(relativePath);
        }
      });

      // The SDK writes ONE `<extension>_metadata.evt` for all monitors of an extension,
      // and its name does not have to match any monitor. Read every such file, then
      // match blocks to monitors by the block names each monitor file defines.
      const blocksById = new Map<string, ParsedBlockMetadata>();
      for (const path of Object.keys(zip.files)) {
        const entry = zip.files[path];
        if (entry.dir || !path.endsWith('_metadata.evt')) continue;
        processedFiles.add(path);
        try {
          for (const block of parseBlockMetadataEvt(await entry.async('text'))) {
            if (!blocksById.has(block.id)) blocksById.set(block.id, block);
          }
        } catch (error) {
          console.warn(`Failed to read block metadata ${path}:`, error);
        }
      }

      // Process each monitor file
      for (const monitorPath of monitorFiles) {
        const monitorName = this.extractMonitorName(monitorPath);
        const monitorMetadata: MonitorMetadata = {
          custom: true,
          file: monitorPath,
          id: `apamax.analyticsbuilder.custom.${monitorName}`,
          name: monitorName,
          type: 'file'
        };

        try {
          const content = await zip.file(monitorPath)!.async('text');
          const blockIds = extractBlockFqns(content, monitorName);
          // Same id the repository list and the engine use for this file.
          monitorMetadata.id = blockIds[0];
          const block = blockIds.map(id => blocksById.get(id)).find(found => !!found);
          if (block) {
            monitorMetadata.category = block.category;
            monitorMetadata.description = block.description;
            monitorMetadata.inputs = block.inputs;
            monitorMetadata.outputs = block.outputs;
            monitorMetadata.parameters = block.parameters;
          }
          if (blockIds.length > 1) {
            monitorMetadata.blockIds = blockIds;
          }
        } catch (error) {
          console.warn(`Failed to read monitor ${monitorPath}:`, error);
        }

        monitors.push(monitorMetadata);
      }

      // Process all other files (excluding monitors and their metadata)
      zip.forEach((relativePath, zipEntry) => {
        // Skip directories and already processed files
        if (zipEntry.dir || processedFiles.has(relativePath)) {
          return;
        }

        // Skip common metadata/config files that shouldn't be listed
        const skipPatterns = [/^__MACOSX\//, /\.DS_Store$/, /^\.git\//, /^node_modules\//];

        if (skipPatterns.some(pattern => pattern.test(relativePath))) {
          return;
        }

        const fileName = relativePath.split('/').pop() || relativePath;
        const extension = this.getFileExtension(fileName);

        const fileMetadata: FileMetadata = {
          custom: true,
          file: relativePath,
          name: fileName,
          type: this.mapFileType(extension)
        };

        files.push(fileMetadata);
      });

      return {
        build_type: 'external',
        monitors,
        files
      };
    } catch (error) {
      console.error('Failed to analyze ZIP content:', error);
      throw new Error('Failed to analyze extension package');
    }
  }

  /**
   * Extracts file extension from filename
   */
  private getFileExtension(fileName: string): string {
    const parts = fileName.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
  }

  /**
   * Maps file extension to a type category
   */
  private mapFileType(extension: string): string {
    const typeMap: { [key: string]: string } = {
      json: 'config',
      xml: 'config',
      yaml: 'config',
      yml: 'config',
      txt: 'text',
      md: 'documentation',
      pdf: 'documentation',
      evt: 'event',
      mon: 'monitor',
      jar: 'library',
      js: 'script',
      ts: 'script',
      py: 'script',
      sh: 'script',
      bat: 'script',
      html: 'web',
      css: 'web',
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      svg: 'image'
    };

    return typeMap[extension] || 'file';
  }

  /**
   * Extracts monitor name from file path
   * e.g., "monitors/BasicAnomalyDetection.mon" -> "BasicAnomalyDetection"
   */
  private extractMonitorName(filePath: string): string {
    const fileName = filePath.split('/').pop() || '';
    return fileName.replace('.mon', '');
  }

  cancel(): void {
    this.cleanup();
    this.cancelled.emit();
  }

  done(): void {
    this.completed.emit();
  }

  /**
   * The extension has to carry the name the engine registers its blocks under, which is the
   * prefix of `<extension>_metadata.evt` in the zip. The file name is only a guess: a browser
   * renames a second download to "AlarmBand-1.0.1 (1).zip". The zip wins when the file name
   * matches none of its metadata files and there is exactly one to choose; a bundle with several
   * keeps the file name.
   */
  private async resolveExtensionName(file: File): Promise<string> {
    const fromFile = this.extractExtensionName(file.name).replace(/\s*\(\d+\)$/, '');
    try {
      const zip = await JSZip.loadAsync(file);
      const names = new Set<string>();
      for (const [path, entry] of Object.entries(zip.files)) {
        const match = entry.dir ? null : /(?:^|\/)([^/]+)_metadata\.evt$/.exec(path);
        if (match) names.add(match[1]);
      }
      if (names.has(fromFile)) {
        return fromFile;
      }
      if (names.size === 1) {
        return [...names][0];
      }
    } catch {
      // Not a readable zip: the analysis that follows reports it.
    }
    return fromFile;
  }

  private extractExtensionName(fileName: string): string {
    // Remove .zip extension if present, otherwise remove the last extension.
    // A name without an extension ("README") or that is only an extension
    // (".zip", ".hidden") stays as it is, an empty extension name is never valid.
    const stripped = fileName.toLowerCase().endsWith('.zip')
      ? fileName.slice(0, -4)
      : fileName.split('.').slice(0, -1).join('.');
    return stripped || fileName;
  }

  private async findExistingExtension(name: string): Promise<IManagedObject | null> {
    const extensions = await this.analyticsService.getExtensionsFromInventory();
    return extensions.find(ext => ext['name'] === name) || null;
  }

  /**
   * Reasons to ask before uploading, never to refuse: the installed version is the same or
   * newer (unknown versions say nothing), or a card update got a package of another extension.
   */
  private versionWarnings(
    name: string,
    version: string | undefined,
    existing: IManagedObject | null
  ): string[] {
    const warnings: string[] = [];
    const replaced = this.extensionToReplace?.['name'];
    if (this.mode === 'update' && replaced && replaced !== name) {
      warnings.push(
        this.messages.format(
          gettext(
            'The package contains the extension "{{name}}", not "{{replaced}}". Upload it anyway?'
          ),
          { name, replaced }
        )
      );
    }
    const installed = existing?.['build_information']?.version as string | undefined;
    const diff = compareVersions(version, installed);
    if (diff !== undefined && diff <= 0) {
      warnings.push(
        this.messages.format(
          diff === 0
            ? gettext('Version {{installed}} of "{{name}}" is already installed.')
            : gettext(
                'Version {{installed}} of "{{name}}" is installed and newer than version {{version}}.'
              ),
          { name, installed, version }
        )
      );
    }
    return warnings;
  }

  private confirm(title: string, message: string, ok: string): Promise<boolean> {
    const ref = this.bsModalService.show(ConfirmationModalComponent, {
      initialState: { title, message, labels: { ok, cancel: 'Cancel' } }
    });
    return new Promise(resolve =>
      ref.content!.closeSubject.pipe(take(1)).subscribe((confirmed: boolean) => {
        ref.hide();
        resolve(!!confirmed);
      })
    );
  }

  private handleUpdateRequired(warnings: string[]): void {
    this.done();
    this.showUpdateConfirmation(warnings);
  }

  private async performUpload(mode: UploadMode): Promise<void> {
    const result = await this.uploadExtensionHandler(this.state.file!, this.state.extension!, mode);

    if (result) {
      this.handleUploadSuccess(mode);
    } else {
      this.handleUploadFailure();
    }
  }

  private handleUploadSuccess(mode: UploadMode): void {
    const extensionName = this.state.extension?.['name'] || gettext('Extension');
    const key =
      mode === 'update'
        ? gettext('Extension "{{extensionName}}" updated.')
        : gettext('Extension "{{extensionName}}" uploaded.');
    this.alertService.success(this.messages.format(key, { extensionName }));
    this.state.isComplete = true;
    this.progress.next(100);
    this.uploaded.emit();
  }

  private handleUploadFailure(): void {
    this.state.errorMessage = 'Could not create extension!';
    this.state.isComplete = false;
  }

  private handleCreationFailure(error: unknown): void {
    this.cleanup();
    this.dropAreaComponent?.onDelete();

    const errorMessage = this.getErrorMessage(error);
    this.state.errorMessage = errorMessage;

    if (!this.state.errorMessage && error) {
      this.alertService.addServerFailure(error);
    }
  }

  private finalizeUpload(): void {
    this.progress.next(100);
    this.setLoading(false);
  }

  private showUpdateConfirmation(warnings: string[] = []): void {
    const initialState = {
      title: 'Update extension',
      message: `Extension "${this.state.extension!['name']}" already exists. ${[...warnings, 'Do you want to update it?'].join(' ')}`,
      labels: {
        ok: 'Update',
        cancel: 'Cancel'
      }
    };

    // The wizard closes itself right before this dialog opens, which destroys this
    // component. The dialog must therefore not be bound to the component lifecycle
    // (no takeUntil(destroy$), not tracked in this.modalRef, which cleanup() hides).
    const confirmRef = this.bsModalService.show(ConfirmationModalComponent, { initialState });

    confirmRef.content!.closeSubject.pipe(take(1)).subscribe(async (confirmed: boolean) => {
      if (confirmed) {
        await this.handleUpdateConfirmed();
      }
      confirmRef.hide();
    });
  }

  private async handleUpdateConfirmed(): Promise<void> {
    try {
      this.setLoading(true);
      await this.performUpload('update');
      this.analyticsService.triggerCacheReload(true);
    } catch (error) {
      console.error('Update failed:', error);
      if (error) {
        this.alertService.addServerFailure(error);
      }
    } finally {
      this.setLoading(false);
    }
  }

  private cleanup(): void {
    // Only a half-created extension may be rolled back. When it already exists
    // (requiresUpdate) `state.extension` is the user's installed extension: cleaning
    // up after a cancelled, declined or failed update must never delete it.
    if (this.state.extension && !this.state.isComplete && !this.state.requiresUpdate) {
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

  private getErrorMessage(error: unknown): string | null {
    if (!error) {
      return null;
    }

    // Handle error object with message property
    if (typeof error === 'object' && 'message' in error) {
      const errorObj = error as Record<string, unknown>;
      const message = errorObj['message'] as string;
      return ERROR_MESSAGES[message as keyof typeof ERROR_MESSAGES] || message || null;
    }

    // Handle string errors
    if (typeof error === 'string') {
      return ERROR_MESSAGES[error as keyof typeof ERROR_MESSAGES] || error;
    }

    return null;
  }
}
