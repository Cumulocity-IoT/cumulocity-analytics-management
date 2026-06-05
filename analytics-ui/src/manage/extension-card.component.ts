import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IManagedObject } from '@c8y/client';
import {
  AlertService,
  CoreModule,
  WizardConfig,
  WizardModalService
} from '@c8y/ngx-components';
import { saveAs } from 'file-saver';
import { BsModalRef, BsModalService, ModalOptions } from 'ngx-bootstrap/modal';
import { BsDropdownModule } from 'ngx-bootstrap/dropdown';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { AnalyticsService, Repository, RepositoryService } from '../shared';
import { ConfirmationModalComponent } from '../shared/component/confirmation-modal.component';

interface BuildInformation {
  build_type: 'repository' | 'list' | 'yaml';
  repository: Repository;
  monitors?: Record<string, unknown>[];
  yaml?: Record<string, unknown>;
  sections?: string[];
  section_name?: string;
  files?: string[];
}

@Component({
  selector: 'a17t-extension-card',
  templateUrl: './extension-card.component.html',
  styleUrls: ['./extension-card.component.css'],
  standalone: true,
  imports: [CommonModule, CoreModule, BsDropdownModule, PopoverModule, ConfirmationModalComponent]
})
export class ExtensionCardComponent implements OnInit {
  @Input() extension!: IManagedObject;
  @Input() isBackendServiceAvailable!: boolean;
  @Output() extensionChanged: EventEmitter<void> = new EventEmitter();

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly repositoryService: RepositoryService,
    private readonly alertService: AlertService,
    private readonly router: Router,
    private readonly activatedRoute: ActivatedRoute,
    private readonly bsModalService: BsModalService,
    private readonly wizardModalService: WizardModalService
  ) { }

  ngOnInit(): void { }

  async detail(): Promise<void> {
    await this.router.navigate(['details', this.extension['name']], {
      relativeTo: this.activatedRoute,
      state: {
        extension: this.extension
      }
    });
  }

  isBuildInternally(): boolean {
    return this.extension?.['build_information'] && (this.extension?.['build_information'].build_type == 'list' || this.extension?.['build_information'].build_type == 'yaml' || this.extension?.['build_information'].build_type == 'repository')
  }

  hasBuildInformation(): boolean {
    return this.extension?.['build_information'];
  }

  getBuildType(): string {
    return this.extension?.['build_information'] ? this.extension?.['build_information'].build_type : 'Unknown';
  }

  async delete(): Promise<void> {
    const initialState = {
      title: 'Delete extension',
      message: `You are about to delete the extension "${this.extension['name']}". Do you want to proceed?`,
      labels: {
        ok: 'Delete',
        cancel: 'Cancel'
      }
    };

    const confirmDeletionModalRef: BsModalRef = this.bsModalService.show(
      ConfirmationModalComponent,
      { initialState }
    );

    confirmDeletionModalRef.content.closeSubject.subscribe(
      async (result: boolean) => {
        if (result) {
          try {
            await this.analyticsService.deleteExtension(this.extension, true);
            this.extensionChanged.emit();
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

  async download(): Promise<void> {
    try {
      const bin: ArrayBuffer = await this.analyticsService.downloadExtension(
        this.extension
      );
      const blob = new Blob([bin], { type: 'application/zip' });
      saveAs(blob, `${this.extension['name']}.zip`);
    } catch (ex) {
      if (ex) {
        this.alertService.addServerFailure(ex);
      }
    }
  }

  async update(): Promise<void> {
    const wizardConfig: WizardConfig = {
      headerIcon: 'upload'
    };

    const initialState: Record<string, unknown> = {
      wizardConfig,
      id: 'uploadAnalyticsExtension',
      componentInitialState: {
        mode: 'update',
        extensionToReplace: this.extension,
        headerText: 'Update extension',
      },
    };

    const modalOptions: ModalOptions = { initialState };

    const modalRef = this.wizardModalService.show(modalOptions);
    if (modalRef.content) {
      modalRef.content.onClose.subscribe(() => {
        this.extensionChanged.emit();
      });
    }
  }

  async rebuild(): Promise<void> {
    const buildInfo = this.extension['build_information'] as BuildInformation;

    // Validate build information exists
    if (!buildInfo) {
      this.alertService.warning(
        'Cannot rebuild: No build information found for this extension. ' +
        'This extension may have been created manually or with an older version.'
      );
      return;
    }

    // Validate repository information
    if (!buildInfo.repository || !buildInfo.repository.id) {
      this.alertService.warning(
        'Cannot rebuild: Repository information is missing or incomplete.'
      );
      return;
    }

    // Show confirmation dialog
    const initialState = {
      title: 'Rebuild extension',
      message: `You are about to rebuild and deploy the extension "${this.extension['name']}" from the repository "${buildInfo.repository.name}". This will replace the current version. Do you want to proceed?`,
      labels: {
        ok: 'Rebuild',
        cancel: 'Cancel'
      }
    };

    const confirmRebuildModalRef: BsModalRef = this.bsModalService.show(
      ConfirmationModalComponent,
      { initialState }
    );

    confirmRebuildModalRef.content.closeSubject.subscribe(
      async (result: boolean) => {
        if (result) {
          try {
            await this.performRebuild(buildInfo);
          } catch (ex) {
            if (ex) {
              this.alertService.addServerFailure(ex);
            }
          }
        }
        confirmRebuildModalRef.hide();
      }
    );
  }

  private async performRebuild(buildInfo: BuildInformation): Promise<void> {
    this.alertService.info(`Rebuilding extension "${this.extension['name']}"...`);

    try {
      switch (buildInfo.build_type) {
        case 'repository':
          await this.rebuildFromRepository(buildInfo);
          break;

        case 'list':
          await this.rebuildFromList(buildInfo);
          break;

        case 'yaml':
          await this.rebuildFromYaml(buildInfo);
          break;

        default:
          throw new Error(`Unknown build type: ${buildInfo.build_type}`);
      }

      this.alertService.success(
        `Extension "${this.extension['name']}" rebuilt successfully`
      );
      this.extensionChanged.emit();

    } catch (error) {
      // Check if it's a 404 error (extension not found for rebuild)
      if (error?.status === 404 || error?.message?.includes('no existing extension')) {
        this.alertService.danger(
          `Rebuild failed: The extension "${this.extension['name']}" was not found in Cumulocity. ` +
          'It may have been deleted. Please create it again instead.'
        );
      } else {
        throw error;
      }
    }
  }

  private async rebuildFromRepository(buildInfo: BuildInformation): Promise<void> {
    await this.repositoryService.createExtensionFromRepository(
      this.extension['name'],
      buildInfo.repository,
      true,  // upload
      true, // deploy
      true   // rebuild
    );
  }

  private async rebuildFromList(buildInfo: any): Promise<void> {

    if (!buildInfo.monitors || buildInfo.monitors.length === 0) {
      throw new Error('No monitors information found in build information');
    }

    await this.repositoryService.createExtensionFromList(
      this.extension['name'],
      buildInfo.monitors,
      buildInfo.repository,
      true,  // upload
      true, // deploy
      true   // rebuild
    );
  }

  private async rebuildFromYaml(buildInfo: any): Promise<void> {

    if (!buildInfo.yaml) {
      throw new Error('No YAML information found in build information');
    }

    // For YAML builds, we need to rebuild just the specific section
    const sections = buildInfo.section_name ? [buildInfo.section_name] : [];

    await this.repositoryService.createExtensionFromYaml(
      this.extension['name'],
      buildInfo.yaml,
      sections,
      buildInfo.repository,
      true,  // upload
      true, // deploy
      true   // rebuild
    );
  }
}