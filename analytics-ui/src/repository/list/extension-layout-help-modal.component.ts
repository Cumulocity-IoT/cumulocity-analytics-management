import { Component, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CoreModule, ModalLabels } from '@c8y/ngx-components';
import { Subject } from 'rxjs';

@Component({
  selector: 'a17t-extension-layout-help-modal',
  templateUrl: './extension-layout-help-modal.component.html',
  standalone: true,
  imports: [CommonModule, CoreModule],
  encapsulation: ViewEncapsulation.None
})
export class ExtensionLayoutHelpModalComponent {
  @Output() closeSubject: Subject<void> = new Subject();
  labels: ModalLabels = { ok: 'Close' };

  onClose(): void {
    this.closeSubject.next();
  }
}
