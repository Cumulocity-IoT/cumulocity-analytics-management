// extension-list.component.ts
import { Component } from '@angular/core';
import { FieldType } from '@ngx-formly/core';

@Component({
  selector: 'app-extension-list',
  template: `
    <div class="extension-list-container" *ngIf="!to.hidden">
      <div class="extension-list-description" *ngIf="to.description">
        {{ to.description }}
      </div>
      <div class="extension-list" *ngIf="to.extensionNames?.length > 0">
        <ul class="list-group">
          <li class="list-group-item" *ngFor="let extension of to.extensionNames">
            <i class="fa fa-cube mr-2"></i> {{ extension }}
          </li>
        </ul>
      </div>
      <div class="no-extensions" *ngIf="!to.extensionNames || to.extensionNames.length === 0">
        <em>No extensions found in the package.</em>
      </div>
    </div>
  `,
  styles: [`
    .extension-list-container {
      margin-bottom: 1rem;
    }
    .extension-list-description {
      margin-bottom: 0.5rem;
      color: #666;
    }
    .list-group-item {
      background-color: #f8f9fa;
      border: 1px solid #e9ecef;
    }
    .no-extensions {
      padding: 0.75rem;
      color: #6c757d;
    }
  `]
})
export class ExtensionListComponent extends FieldType {
  // The base FieldType provides access to field properties
  // this.to will give access to the templateOptions
}