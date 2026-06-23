import { Component, Input, OnInit, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IManagedObject, IManagedObjectBinary } from '@c8y/client';
import { gettext } from '@c8y/ngx-components/gettext';
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
  ></a17t-extension-add>`,
  standalone: true,
  imports: [CommonModule, ExtensionAddComponent]
})
export class ExtensionAddWizardComponent implements OnInit {
  @Input() mode!: UploadMode;
  @Input() extensionToReplace!: IManagedObject;
  @Input() headerText!: string;
  @Output() refresh = new EventEmitter<void>();
  successText: string = gettext('Extension created');

  constructor(private analyticsService: AnalyticsService) { }
  ngOnInit(): void {
    console.log('Mode', this.mode);
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
    const resolved: IManagedObject = (extension as IManagedObject) ?? this.extensionToReplace;
    return this.analyticsService.uploadExtension(file, resolved, mode);
  }
}
