import {
  Component,
  Input,
  Output,
  ViewChild,
  ViewEncapsulation
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CoreModule, ModalLabels } from '@c8y/ngx-components';
import { Observable, Subject } from 'rxjs';
import { EditorComponent } from '@c8y/ngx-components/editor';
import { EplConfigService } from './epl-config.service';

let initializedMonaco = false;

@Component({
  selector: 'a17t-name-extension-modal',
  styleUrls: ['./editor-modal.component.css'],
  templateUrl: './editor-modal.component.html',
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [CommonModule, FormsModule, CoreModule, EditorComponent],
  providers: [EplConfigService]
})
export class EditorModalComponent {

  @Input() source$!: Observable<string>;
  @Input() monitorName!: string;
  @Output() closeSubject: Subject<any> = new Subject();

  @ViewChild(EditorComponent) editorComponent!: EditorComponent;

  labels: ModalLabels = { ok: 'Close' };
  editorOptions!: EditorComponent['editorOptions'];

  constructor(private configService: EplConfigService) {
    this.editorOptions = {
      minimap: { enabled: false },
      renderValidationDecorations: "off",
      automaticLayout: true,
      language: this.configService.getLanguageName(),
      theme: this.configService.getThemeName()
    };
  }

  onClose(_event: any) {
    this.closeSubject.next(true);
  }

  assignSchema() {
    if (!this.editorComponent.monaco || !this.editorComponent.editor) return;
    const monaco = this.editorComponent.monaco;
    try {
      if (!initializedMonaco) {
        monaco.languages.register(this.configService.getCustomLangExtensionPoint());
        monaco.languages.setMonarchTokensProvider(this.configService.getLanguageName(), this.configService.getCustomLangTokenProviders() as any);
        monaco.languages.setLanguageConfiguration(this.configService.getLanguageName(), this.configService.getEPLLanguageConfig());
        monaco.editor.defineTheme(this.configService.getThemeName(), this.configService.getCustomLangTheme());
        initializedMonaco = true;
      }

      // Modal opens with animation; force layout after paint and after transition
      // so Monaco does not stay at the previous narrow width.
      setTimeout(() => this.editorComponent.editor?.layout(), 0);
      setTimeout(() => this.editorComponent.editor?.layout(), 250);
    } catch (err) {
      console.error('Failed to register EPL language with Monaco:', err);
    }
  }
}
