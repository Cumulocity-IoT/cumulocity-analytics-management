import { Component } from '@angular/core';
import { IApplication, IManagedObject, IManagedObjectBinary } from '@c8y/client';
import { gettext } from '@c8y/ngx-components';
import { AnalyticsService } from './analytics.service';

@Component({
    selector: 'c8y-add-analytics-extension',
    template: `<c8y-add-extension
      [headerText]="headerText"
      [headerIcon]="'upload'"
      [successText]="successText"
      [uploadExtensionHandler]="uploadExtensionHandler"
      [canGoBack]="true"
    ></c8y-add-extension>`
  })
  export class AddAnalyticsExtensionComponent {
    headerText: string = gettext('Upload analytics extension');
    successText: string = gettext('Extension created');
  
    constructor(private analyticsService: AnalyticsService) {}
  
    uploadExtensionHandler = (file: File, app: IManagedObject, restart: boolean) => this.uploadExtension(file, app, restart );
  
    async uploadExtension(file: File, app: IManagedObject, restart: boolean): Promise<IManagedObjectBinary> {
      return this.analyticsService.uploadExtension(file, app, restart);
    }

  }