import { Component, Input, OnInit } from '@angular/core';
import { IManagedObject, IManagedObjectBinary } from '@c8y/client';
import { gettext } from '@c8y/ngx-components';
import { AnalyticsService } from '../analytics.service';

@Component({
  selector: 'a17t-extension-add-wizard',
  template: `<a17t-extension-add
    [headerText]="headerText"
    [headerIcon]="'upload'"
    [successText]="successText"
    [uploadExtensionHandler]="uploadExtensionHandler"
    [canGoBack]="false"
  ></a17t-extension-add>`
})
export class ExtensionAddWizardComponent implements OnInit {
  @Input() mode: string;
  @Input() extensionToReplace: IManagedObject;
  @Input() headerText: string;
  successText: string = gettext('Extension created');

  constructor(private analyticsService: AnalyticsService) {}
  ngOnInit(): void {
    console.log('Mode', this.mode);
  }

  uploadExtensionHandler = (
    file: File,
    newExtension: IManagedObject,
    restart: boolean
  ) => this.uploadExtension(file, newExtension, restart);

  async uploadExtension(
    file: File,
    newExtension: IManagedObject,
    restart: boolean
  ): Promise<IManagedObjectBinary> {
    return this.analyticsService.uploadExtension(file, newExtension, restart, this.mode, this.extensionToReplace);
  }
}
