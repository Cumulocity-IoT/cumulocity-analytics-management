import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IManagedObject } from '@c8y/client';
import {
  AlertService,
  WizardConfig,
  WizardModalService
} from '@c8y/ngx-components';
import { saveAs } from 'file-saver';
import { BsModalRef, BsModalService, ModalOptions } from 'ngx-bootstrap/modal';
import { AnalyticsService, ConfirmationModalComponent } from '../shared';

@Component({
  selector: 'a17t-extension-card',
  templateUrl: './extension-card.component.html',
  standalone: false
})
export class ExtensionCardComponent implements OnInit {
  @Input() extension: IManagedObject;
  @Input() isBackendServiceAvailable: boolean;
  @Output() extensionChanged: EventEmitter<void> = new EventEmitter();

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly alertService: AlertService,
    private readonly router: Router,
    private readonly activatedRoute: ActivatedRoute,
    private readonly bsModalService: BsModalService,
    private readonly wizardModalService: WizardModalService
  ) { }

  ngOnInit(): void {
    // console.log('Extension loaded:', this.extension);
  }

  async detail(): Promise<void> {
    if (this.extension?.loaded) {
      await this.router.navigate(['details', this.extension.name], {
        relativeTo: this.activatedRoute,
        state: {
          extension: this.extension
        }
      });
      // console.log("Added extension", this.extension);
    } else {
      // console.warn('Extension not loaded yet');
    }
  }

  async delete(): Promise<void> {
    const initialState = {
      title: 'Delete extension',
      message: `You are about to delete the extension "${this.extension.name}". Do you want to proceed?`,
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
      saveAs(blob, `${this.extension.name}.zip`);
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

    const initialState: any = {
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
    modalRef.content.onClose.subscribe(() => {
      this.extensionChanged.emit();
    });
  }

  rebuild(): void {
    this.alertService.info("This option will be supported in a later release");
    console.log("Build Information", this.extension.build_information);
  }
}