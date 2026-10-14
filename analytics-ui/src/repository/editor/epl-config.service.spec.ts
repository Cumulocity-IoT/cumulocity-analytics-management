import { EplConfigService } from './epl-config.service';
import eplTokenProvider from './epl-token.provider';

describe('EplConfigService', () => {
  const service = new EplConfigService();

  it('names the language and theme consistently', () => {
    expect(service.getLanguageName()).toBe('epl');
    expect(service.defaultEditorConfigs().theme).toBe(service.getThemeName());
    expect(service.getCustomLangExtensionPoint().id).toBe(service.getLanguageName());
  });

  it('registers .mon files for the language', () => {
    expect(service.getCustomLangExtensionPoint().extensions).toEqual(['.mon', '.MON']);
  });

  it('provides sensible editor defaults', () => {
    const config = service.defaultEditorConfigs();
    expect(config.readOnly).toBeFalse();
    expect(config.automaticLayout).toBeTrue();
    expect(config.wordWrap).toBe('on');
  });

  it('returns a fresh options object on every call', () => {
    expect(service.defaultEditorConfigs()).not.toBe(service.defaultEditorConfigs());
  });

  describe('language configuration', () => {
    const config = service.getEPLLanguageConfig();

    it('defines EPL comment markers and bracket pairs', () => {
      expect(config.comments).toEqual({ lineComment: '//', blockComment: ['/*', '*/'] });
      expect(config.brackets).toEqual([['{', '}'], ['[', ']'], ['(', ')']]);
    });

    it('does not treat "$" or "@" as word separators (so $input_x and @$tag stay one word)', () => {
      const words = 'event Foo_$Parameters $input_a'.match(config.wordPattern!)!;
      expect(words).toContain('Foo_$Parameters');
      expect(words).toContain('$input_a');
    });

    it('recognizes region folding markers', () => {
      const { start, end } = config.folding!.markers!;
      expect(start.test('  // region Setup')).toBeTrue();
      expect(start.test('// #region Setup')).toBeTrue();
      expect(end.test('// endregion')).toBeTrue();
      expect(start.test('// ordinary comment')).toBeFalse();
    });
  });

  describe('theme', () => {
    it('is a light theme with rules for the tokens the tokenizer emits', () => {
      const theme = service.getCustomLangTheme();
      expect(theme.base).toBe('vs');
      const tokens = theme.rules.map(r => r.token);
      ['keyword', 'type', 'comment', 'string', 'number'].forEach(t => expect(tokens).toContain(t));
    });
  });

  it('exposes the shared token provider', () => {
    expect(service.getCustomLangTokenProviders()).toBe(eplTokenProvider as unknown as Record<string, unknown>);
  });
});

describe('eplTokenProvider', () => {
  it('classifies EPL vocabulary', () => {
    expect(eplTokenProvider.keyword).toEqual(jasmine.arrayContaining(['event', 'monitor', 'action', 'constant']));
    expect(eplTokenProvider.types).toEqual(jasmine.arrayContaining(['string', 'float', 'dictionary', 'sequence', 'optional']));
    expect(eplTokenProvider.constants).toEqual(['false', 'true']);
    expect(eplTokenProvider.statements).toEqual(jasmine.arrayContaining(['if', 'while', 'spawn', 'on']));
  });

  it('has no word in two different classes (a keyword must not also be a type)', () => {
    const lists = [eplTokenProvider.keyword, eplTokenProvider.types, eplTokenProvider.constants, eplTokenProvider.statements];
    const all = lists.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('matches identifiers (including $ names), numbers and escapes with its patterns', () => {
    const identifier = (eplTokenProvider.tokenizer.root as unknown as unknown[][])[0][0] as RegExp;
    expect(identifier.test('$input_a')).toBeTrue();
    expect(eplTokenProvider.digits.test('1_000')).toBeTrue();
    expect(eplTokenProvider.escapes.test('\\n')).toBeTrue();
    expect(eplTokenProvider.escapes.test('\\q')).toBeFalse();
  });

  it('defines every state it references', () => {
    const states = Object.keys(eplTokenProvider.tokenizer);
    const referenced = JSON.stringify(eplTokenProvider.tokenizer).match(/"@(\w+)"/g)?.map(s => s.slice(2, -1)) ?? [];
    const known = [...states, 'keyword', 'constants', 'types', 'statements', 'operators', 'default', 'brackets', 'pop', 'push',
      'symbols', 'escapes', 'digits', 'octaldigits', 'binarydigits', 'hexdigits'];
    referenced.forEach(name => expect(known).toContain(name));
  });
});
