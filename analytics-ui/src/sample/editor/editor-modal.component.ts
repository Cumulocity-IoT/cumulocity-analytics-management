import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  Output,
  ViewChild,
  ViewEncapsulation
} from '@angular/core';
import { ModalLabels } from '@c8y/ngx-components';
import { Subject } from 'rxjs';

@Component({
  selector: 'a17t-name-extension-modal',
  styleUrls: ['./editor-stepper.component.css'],
  template: `<c8y-modal
    title="Source code {{ monitor }}"
    (onClose)="onSave($event)"
    [labels]="labels"
    [headerClasses]="'modal-header dialog-header'"
  >
    <pre id="sourceEditor" #sourceEditor>
    {{ source }}
  </pre>
  </c8y-modal>`,
  encapsulation: ViewEncapsulation.None
})
export class EditorModalComponent implements AfterViewInit {
  @Input() source: string;
  @Input() monitor: string;
  @Output() closeSubject: Subject<any> = new Subject();
  labels: ModalLabels = { ok: 'Close' };
  @ViewChild('sourceEditor', { static: false })
  sourceEditor: ElementRef;

  onSave(event) {
    console.log('Save');
    this.closeSubject.next(true);
  }

  ngAfterViewInit(): void {
    this.addLineClass();
  }

  public addLineClass() {
    const ne = this.sourceEditor.nativeElement;
    const lines = ne.innerText.split('\n'); // can use innerHTML also
    while (ne.childNodes.length > 0) {
      this.sourceEditor.nativeElement.removeChild(ne.childNodes[0]);
    }
    for (let i = 0; i < lines.length; i++) {
      const span = document.createElement('span');
      span.className = 'line';
      span.innerText = lines[i]; // can use innerHTML also
      ne.appendChild(span);
      ne.appendChild(document.createTextNode('\n'));
    }
  }
}
