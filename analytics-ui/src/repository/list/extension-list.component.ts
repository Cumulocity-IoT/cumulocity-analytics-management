// extension-list.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FieldType, FormlyModule } from '@ngx-formly/core';

@Component({
  selector: 'app-extension-list',
  template: `
    @if (!to.hidden) {
      <div class="extension-list-container">
        <!-- <div class="extension-list-description" *ngIf="to.description">
        {{ to.description }}
      </div> -->
      @if (to.extensionNames?.length > 0) {
        <div class="extension-list">
          <table class="extension-table">
            <tbody>
              @for (extension of to.extensionNames; track extension; let i = $index) {
                <tr class="extension-row">
                  <td class="number-cell">{{ i + 1 }}</td>
                  <td class="extension-cell">
                    <i class="fa fa-cube mr-2"></i> {{ extension }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      @if (!to.extensionNames || to.extensionNames.length === 0) {
        <div class="no-extensions">
          <em>No extensions found in the package.</em>
        </div>
      }
    </div>
    }
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
      padding: 4px;
      //border-top-left-radius: 4px;
      //border-bottom-left-radius: 4px;
    }
    .extension-cell {
      padding: 4px 8px;
      //border-top-right-radius: 4px;
      //border-bottom-right-radius: 4px;
    }
    .no-extensions {
      padding: 0.75rem;
      color: #6c757d;
    }
  `],
  standalone: true,
  imports: [CommonModule, FormlyModule]
})
export class ExtensionListComponent extends FieldType {
  // The base FieldType provides access to field properties
  // this.to will give access to the templateOptions
}