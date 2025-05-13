import { Component, Input, OnInit, Output } from '@angular/core';
import { IManagedObject, IManagedObjectBinary } from '@c8y/client';
import { gettext } from '@c8y/ngx-components';
import { AnalyticsService } from '../analytics.service';
import { UploadMode } from '../analytics.model';

@Component({
  selector: 'a17t-extension-add-wizard',
  template: `<a17t-extension-add
    [headerText]="headerText"
    [headerIcon]="'upload'"
    [successText]="successText"
    [uploadExtensionHandler]="uploadExtensionHandler"
    [mode]="mode"
  ></a17t-extension-add>`,
  standalone: false
})
export class ExtensionAddWizardComponent implements OnInit {
  @Input() mode: UploadMode;
  @Input() extensionToReplace: IManagedObject;
  @Input() headerText: string;
  @Output() refresh;
  successText: string = gettext('Extension created');

  constructor(private analyticsService: AnalyticsService) { }
  ngOnInit(): void {
    console.log('Mode', this.mode);
  }

  uploadExtensionHandler = (
    file: File,
    extension: IManagedObject,
    mode: UploadMode
  ) => this.uploadExtension(file, extension, mode);

  async uploadExtension(
    file: File,
    extension: IManagedObject,
    mode: UploadMode
  ): Promise<IManagedObjectBinary> {
    // eslint-disable-next-line no-param-reassign
    if (!extension) extension = this.extensionToReplace;
    return this.analyticsService.uploadExtension(file, extension, mode);
  }
}
