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
import { EplConfigService } from './epl-config.service';

let initializedMonaco = false;

@Component({
  selector: 'a17t-name-extension-modal',
  styleUrls: ['./editor-modal.component.css'],
  templateUrl: './editor-modal.component.html',
  encapsulation: ViewEncapsulation.None,
  standalone: false
})
export class EditorModalComponent implements OnInit {

  @Input() source$: Observable<string>;
  @Input() monitorName: string;
  @Output() closeSubject: Subject<any> = new Subject();

  @ViewChild(EditorComponent) editorComponent!: EditorComponent;

  labels: ModalLabels = { ok: 'Close' };
  editorOptions: EditorComponent['editorOptions'] = {
    minimap: { enabled: false },
    renderValidationDecorations: "off",
    language: this.configService.getLanguageName(),
    theme: this.configService.getThemeName()
  };
  sourceEditor: ElementRef;
  source: string;

  constructor(private configService: EplConfigService) {}

  onClose(event) {
    console.log('Save');
    this.closeSubject.next(true);
  }

  assignSchema() {
    // console.log("Editor found:", this.editorComponent, this.editorComponent.monaco);
    if (!initializedMonaco) {
      if (this.editorComponent.monaco) {
        initializedMonaco = true;
        this.editorComponent.monaco.languages.register(this.configService.getCustomLangExtensionPoint());
        this.editorComponent.monaco.languages.setMonarchTokensProvider(this.configService.getLanguageName(), this.configService.getCustomLangTokenProviders());
        this.editorComponent.monaco.languages.setLanguageConfiguration(this.configService.getLanguageName(), this.configService.getEPLLanguageConfig());
        this.editorComponent.monaco.editor.defineTheme(this.configService.getThemeName(), this.configService.getCustomLangTheme());
      }
    }
  }

  async ngOnInit(): Promise<void> {
    this.source$?.subscribe(cont => this.source = cont)
  }
}
