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
        <table class="extension-table">
          <tbody>
            <tr *ngFor="let extension of to.extensionNames; let i = index" class="extension-row">
              <td class="number-cell">{{ i + 1 }}</td>
              <td class="extension-cell">
                <i class="fa fa-cube mr-2"></i> {{ extension }}
              </td>
            </tr>
          </tbody>
        </table>
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
    .extension-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0 6px;
    }
    .extension-row {
      background-color: #f8f9fa;
    }
    .number-cell {
      width: 40px;
      text-align: center;
      background-color: #e9ecef;
      font-weight: bold;
      padding: 8px;
      border-top-left-radius: 4px;
      border-bottom-left-radius: 4px;
    }
    .extension-cell {
      padding: 8px 12px;
      border-top-right-radius: 4px;
      border-bottom-right-radius: 4px;
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