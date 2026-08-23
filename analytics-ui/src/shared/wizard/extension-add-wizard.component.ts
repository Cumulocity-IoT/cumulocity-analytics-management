import { Component, Input, OnInit, Output, EventEmitter } from '@angular/core';

import { IManagedObject, IManagedObjectBinary } from '@c8y/client';
import { gettext } from '@c8y/ngx-components/gettext';
import { WizardComponent } from '@c8y/ngx-components';
import { AnalyticsService } from '../analytics.service';
import { UploadMode } from '../analytics.model';
import { ExtensionAddComponent } from './extension-add.component';

@Component({
  selector: 'a17t-extension-add-wizard',
  template: `<a17t-extension-add
    [headerText]="headerText"
    [headerIcon]="'upload'"
    [successText]="successText"
    [uploadExtensionHandler]="uploadExtensionHandler"
    [mode]="mode"
    (cancelled)="onCancelled()"
    (completed)="onCompleted()"
  ></a17t-extension-add>`,
  standalone: true,
  imports: [ExtensionAddComponent]
})
export class ExtensionAddWizardComponent implements OnInit {
  @Input() mode!: UploadMode;
  @Input() extensionToReplace!: IManagedObject;
  @Input() headerText!: string;
  @Output() refresh = new EventEmitter<void>();
  successText: string = gettext('Extension created');

  constructor(
    private analyticsService: AnalyticsService,
    private wizardComponent: WizardComponent
  ) {}
  ngOnInit(): void {}

  onCancelled(): void {
    this.wizardComponent.close();
  }

  onCompleted(): void {
    this.wizardComponent.close();
    this.refresh.emit();
  }

  uploadExtensionHandler = (
    file: File,
    extension: Partial<IManagedObject>,
    mode: UploadMode
  ) => this.uploadExtension(file, extension, mode);

  async uploadExtension(
    file: File,
    extension: Partial<IManagedObject>,
    mode: UploadMode
  ): Promise<IManagedObjectBinary> {
    const resolved: IManagedObject =
      (extension as IManagedObject) ?? this.extensionToReplace;
    return this.analyticsService.uploadExtension(file, resolved, mode);
  }
}
