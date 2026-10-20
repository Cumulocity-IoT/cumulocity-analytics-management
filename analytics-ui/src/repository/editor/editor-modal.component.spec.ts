import { TestBed } from '@angular/core/testing';
import { EditorModalComponent } from './editor-modal.component';
import { EplConfigService } from './epl-config.service';

describe('EditorModalComponent', () => {
  let component: EditorModalComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [EditorModalComponent] });
    // The Monaco editor itself is not part of this logic test.
    TestBed.overrideComponent(EditorModalComponent, { set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] } });
    component = TestBed.createComponent(EditorModalComponent).componentInstance;
  });

  it('configures the editor for EPL with the plugin theme and without minimap', () => {
    const config = new EplConfigService();
    expect(component.editorOptions).toEqual(jasmine.objectContaining({
      language: config.getLanguageName(),
      theme: config.getThemeName(),
      automaticLayout: true
    }));
    expect(component.editorOptions.minimap).toEqual({ enabled: false });
  });

  it('only offers a Close button and reports closing', () => {
    expect(component.labels).toEqual({ ok: 'Close' });
    const received: unknown[] = [];
    component.closeSubject.subscribe(v => received.push(v));
    component.onClose({});
    expect(received).toEqual([true]);
  });

  describe('assignSchema', () => {
    const fakeMonaco = () => ({
      languages: jasmine.createSpyObj('languages', ['register', 'setMonarchTokensProvider', 'setLanguageConfiguration']),
      editor: jasmine.createSpyObj('editor', ['defineTheme'])
    });

    it('does nothing until the editor is ready', () => {
      component.editorComponent = { monaco: undefined, editor: undefined } as never;
      expect(() => component.assignSchema()).not.toThrow();
    });

    it('registers the EPL language and theme once per page, and lays the editor out after the modal animation', () => {
      jasmine.clock().install();
      try {
        const monaco = fakeMonaco();
        const layout = jasmine.createSpy('layout');
        component.editorComponent = { monaco, editor: { layout } } as never;

        component.assignSchema();
        component.assignSchema();

        // registration is module-wide: exactly one registration across both calls
        expect(monaco.languages.register).toHaveBeenCalledTimes(1);
        expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
        expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
        expect(monaco.editor.defineTheme).toHaveBeenCalledTimes(1);
        expect(monaco.editor.defineTheme.calls.mostRecent().args[0]).toBe('eplTheme');

        jasmine.clock().tick(250);
        expect(layout).toHaveBeenCalledTimes(4); // twice per call (after paint and after the transition)
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('logs instead of throwing when registering fails', () => {
      spyOn(console, 'error');
      const monaco = fakeMonaco();
      (monaco.languages.register as jasmine.Spy).and.throwError('boom');
      component.editorComponent = { monaco, editor: { layout: () => undefined } } as never;
      expect(() => component.assignSchema()).not.toThrow();
    });
  });
});
