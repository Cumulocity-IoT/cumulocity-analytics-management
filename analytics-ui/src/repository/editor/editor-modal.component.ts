import {
  Component,
  ElementRef,
  Input,
  OnInit,
  Output,
  ViewChild,
  ViewEncapsulation
} from '@angular/core';
import { ModalLabels } from '@c8y/ngx-components';
import { Observable, Subject } from 'rxjs';
import { EditorComponent } from '@c8y/ngx-components/editor';


@Component({
  selector: 'a17t-name-extension-modal',
  styleUrls: ['./editor-modal.component.css'],
  templateUrl: './editor-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class EditorModalComponent implements OnInit {

  @Input() source$: Observable<string>;
  @Input() monitorName: string;
  @Output() closeSubject: Subject<any> = new Subject();
  labels: ModalLabels = { ok: 'Close' };
  editorOptions: EditorComponent['editorOptions'] = {
    minimap: { enabled: false },
    renderValidationDecorations: "off"
  };
  sourceEditor: ElementRef;
  source: string;

  onClose(event) {
    console.log('Save');
    this.closeSubject.next(true);
  }
  ngOnInit(): void {
    this.source$.subscribe(cont => this.source = cont)
  }
}
