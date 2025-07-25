import { Component, EventEmitter, Input, Output } from '@angular/core';
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
export class ExtensionCardComponent{
  @Input() extension: IManagedObject;
  @Output() extensionChanged: EventEmitter<void> = new EventEmitter();

  constructor(
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private router: Router,
    private activatedRoute: ActivatedRoute,
    private bsModalService: BsModalService,

    private wizardModalService: WizardModalService
  ) {}
  ngOnInit(): void {
    console.log('Block', this.extension);
  }

  async detail() {
    if (this.extension.loaded) {
      this.router.navigate(['properties/', this.extension.name], {
        relativeTo: this.activatedRoute
      });
    }
    // console.log(
    //   'Details for extension:',
    //   this.extension.name,
    //   this.activatedRoute
    // );
  }

  async delete() {
    const initialState = {
      title: 'Delete extension',
      message: `You are about to delete the extension ${this.extension.name}. Do you want to proceed?`,
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
        // console.log("Confirmation delete result:", result);
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

  async download() {
    try {
      const bin: ArrayBuffer = await this.analyticsService.downloadExtension(
        this.extension
      );
      const blob = new Blob([bin]);
      saveAs(blob, `${this.extension.name}.zip`);
    } catch (ex) {
      if (ex) {
        this.alertService.addServerFailure(ex);
      }
    }
  }

  async update() {
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
}
