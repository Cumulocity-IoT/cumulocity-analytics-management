import {
  extractBlockFqns,
  extractBraceBody,
  findApamaBlockNames,
  getFileExtension,
  githubWebUrlToContentApi,
  isCustomCepBlock,
  removeFileExtension,
  triggerBrowserDownload,
  createShortId
} from './utils';

describe('utils', () => {
  describe('createShortId', () => {
    it('returns a 6 character alphanumeric id', () => {
      expect(createShortId()).toMatch(/^[a-z0-9]{1,6}$/);
    });
  });

  describe('removeFileExtension', () => {
    it('removes a .zip extension case-insensitively', () => {
      expect(removeFileExtension('Ext.zip')).toBe('Ext');
      expect(removeFileExtension('Ext.ZIP')).toBe('Ext');
    });

    it('removes only the last extension of other files', () => {
      expect(removeFileExtension('my.block.mon')).toBe('my.block');
    });

    it('returns names without extension unchanged', () => {
      expect(removeFileExtension('README')).toBe('README');
    });
  });

  describe('getFileExtension', () => {
    it('returns the extension including the dot', () => {
      expect(getFileExtension('Block.mon')).toBe('.mon');
    });

    it('ignores query strings and fragments', () => {
      expect(getFileExtension('https://x/y/Block.mon?ref=main')).toBe('.mon');
    });

    it('returns an empty string when there is no extension', () => {
      expect(getFileExtension('README')).toBe('');
    });
  });

  describe('extractBraceBody', () => {
    it('returns the body of nested braces', () => {
      expect(extractBraceBody('event A { x { y } z }', 0)).toBe(' x { y } z ');
    });

    it('returns null without an opening brace', () => {
      expect(extractBraceBody('no braces', 0)).toBeNull();
    });

    it('returns null for unbalanced braces', () => {
      expect(extractBraceBody('event A { open', 0)).toBeNull();
    });
  });

  describe('findApamaBlockNames', () => {
    const block = (name: string, withBase = true) =>
      `event ${name}_$Parameters { string a; }\nevent ${name} { ${withBase ? 'BlockBase $base;' : ''} ${name}_$Parameters $parameters; }`;

    it('finds blocks that declare BlockBase $base', () => {
      expect(findApamaBlockNames(block('Foo'))).toEqual(['Foo']);
    });

    it('finds parameterless blocks (no _$Parameters companion)', () => {
      expect(findApamaBlockNames('event Distance { BlockBase $base; }')).toEqual(['Distance']);
    });

    it('finds multiple blocks in one file and de-duplicates', () => {
      const content = `${block('Send')}\n${block('Receive')}\n${block('Send')}`;
      expect(findApamaBlockNames(content)).toEqual(['Send', 'Receive']);
    });

    it('ignores events that are not blocks', () => {
      expect(findApamaBlockNames(block('Helper', false))).toEqual([]);
    });

    it('returns an empty list for empty content', () => {
      expect(findApamaBlockNames('')).toEqual([]);
    });
  });

  describe('extractBlockFqns', () => {
    it('prefixes block names with the package', () => {
      const content = 'package com.acme.blocks;\nevent Foo { BlockBase $base; }';
      expect(extractBlockFqns(content, 'Fallback')).toEqual(['com.acme.blocks.Foo']);
    });

    it('uses the fallback name when no block is declared', () => {
      expect(extractBlockFqns('package a.b;\nmonitor M {}', 'File')).toEqual(['a.b.File']);
    });

    it('returns bare names when there is no package', () => {
      expect(extractBlockFqns('event Foo { BlockBase $base; }', 'File')).toEqual(['Foo']);
    });
  });

  describe('isCustomCepBlock', () => {
    it('treats built-in Analytics Builder block ids as non-custom', () => {
      expect(isCustomCepBlock({ id: 'apama.analyticsbuilder.blocks.Add' })).toBeFalse();
      expect(isCustomCepBlock({ id: 'apama.analyticskit.blocks.core.X' })).toBeFalse();
      expect(isCustomCepBlock({ id: 'apama.analyticskit.blocks.cumulocity.Y' })).toBeFalse();
    });

    it('treats other ids as custom', () => {
      expect(isCustomCepBlock({ id: 'com.acme.Foo' })).toBeTrue();
    });

    it('treats a missing id as custom', () => {
      expect(isCustomCepBlock({} as { id: string })).toBeTrue();
    });
  });

  describe('githubWebUrlToContentApi', () => {
    it('converts a tree URL with a path', () => {
      expect(githubWebUrlToContentApi('https://github.com/o/r/tree/dev/blocks/sub')).toBe(
        'https://api.github.com/repos/o/r/contents/blocks/sub?ref=dev'
      );
    });

    it('defaults to the main branch for a bare repository URL', () => {
      expect(githubWebUrlToContentApi('https://github.com/o/r')).toBe(
        'https://api.github.com/repos/o/r/contents?ref=main'
      );
    });

    it('treats a path without /tree/ as a path on the default branch', () => {
      expect(githubWebUrlToContentApi('https://github.com/o/r/blocks')).toBe(
        'https://api.github.com/repos/o/r/contents/blocks?ref=main'
      );
    });

    it('rejects non-GitHub URLs', () => {
      expect(() => githubWebUrlToContentApi('https://example.com/o/r')).toThrowError(/Failed to convert GitHub URL/);
    });

    it('rejects URLs without a repository', () => {
      expect(() => githubWebUrlToContentApi('https://github.com/o')).toThrowError(/missing user or repository/);
    });

    it('rejects strings that are not URLs', () => {
      expect(() => githubWebUrlToContentApi('not a url')).toThrowError(/Failed to convert GitHub URL/);
    });
  });

  describe('triggerBrowserDownload', () => {
    it('clicks a temporary anchor and removes it again', () => {
      const clicked: HTMLAnchorElement[] = [];
      spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
        clicked.push(this);
        expect(document.body.contains(this)).toBeTrue();
      });

      triggerBrowserDownload('https://example.com/file.zip', 'file.zip');

      expect(clicked.length).toBe(1);
      expect(clicked[0].href).toBe('https://example.com/file.zip');
      expect(clicked[0].download).toBe('file.zip');
      expect(clicked[0].rel).toBe('noopener');
      expect(document.body.contains(clicked[0])).toBeFalse();
    });
  });
});
