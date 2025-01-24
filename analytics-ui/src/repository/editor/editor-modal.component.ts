import {
  Component,
  ElementRef,
  Input,
  OnInit,
  Output,
  ViewEncapsulation
} from '@angular/core';
import { ModalLabels } from '@c8y/ngx-components';
import { Observable, Subject } from 'rxjs';
import { EditorComponent, loadMonacoEditor } from '@c8y/ngx-components/editor';
import { EplConfigService } from './epl-config.service';

let initialized Monaco = false;

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
    renderValidationDecorations: "off",
    language: this.configService.getLanguageName(),
    theme: this.configService.getThemeName()
  };
  sourceEditor: ElementRef;
  source: string;

  constructor(private configService: EplConfigService) {

  }

  onClose(event) {
    console.log('Save');
    this.closeSubject.next(true);
  }

  async ngAfterViewInit(): Promise<void> {
    if (!initialized Monaco) {
      const monaco = await loadMonacoEditor();
      if (monaco) {
        initialized Monaco = true;
        monaco.languages.register(this.configService.getCustomLangExtensionPoint());
        monaco.languages.setMonarchTokensProvider(this.configService.getLanguageName(), this.configService.getCustomLangTokenProviders());
        monaco.languages.setLanguageConfiguration(this.configService.getLanguageName(), this.configService.getEPLLanguageConfig());
        monaco.editor.defineTheme(this.configService.getThemeName(), this.configService.getCustomLangTheme());
      }
    }
  }

  async ngOnInit(): Promise<void> {
    this.source$?.subscribe(cont => this.source = cont)
  }
}
