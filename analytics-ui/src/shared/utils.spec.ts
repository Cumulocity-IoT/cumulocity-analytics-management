import {
  extractBlockFqns,
  extractBraceBody,
  findApamaBlockNames,
  getFileExtension,
  githubWebUrlToContentApi,
  isCustomCepBlock,
  removeFileExtension,
  triggerBrowserDownload,
  createShortId,
  removeZipSuffix,
  splitExtensionVersion,
  compareVersions,
  canPickFromDownloads,
  pickZipFromDownloads
} from './utils';

describe('utils', () => {
  describe('splitExtensionVersion', () => {
    it('takes a trailing version off the name', () => {
      expect(splitExtensionVersion('Abs-1.0.1')).toEqual({ name: 'Abs', version: '1.0.1' });
      expect(splitExtensionVersion('contrib-blocks-1.0.1')).toEqual({
        name: 'contrib-blocks',
        version: '1.0.1'
      });
      expect(splitExtensionVersion('Foo_v2.3')).toEqual({ name: 'Foo', version: '2.3' });
      expect(splitExtensionVersion('Block-2')).toEqual({ name: 'Block', version: '2' });
      expect(splitExtensionVersion('Foo-1.0.0-rc.1')).toEqual({
        name: 'Foo',
        version: '1.0.0-rc.1'
      });
    });

    it('supports hyphenated prerelease identifiers and build metadata', () => {
      expect(splitExtensionVersion('Abs-1.0.0-rc-1')).toEqual({
        name: 'Abs',
        version: '1.0.0-rc-1'
      });
      expect(splitExtensionVersion('Abs-1.0.0-rc.1+build.2')).toEqual({
        name: 'Abs',
        version: '1.0.0-rc.1+build.2'
      });
      expect(splitExtensionVersion('Abs-1.0.0+build-5')).toEqual({
        name: 'Abs',
        version: '1.0.0+build-5'
      });
    });

    it('keeps a name without a version whole', () => {
      for (const name of ['HttpOutputBlock', 'pkg.v2', 'My.Ext', '1.0.1', 'Foo-bar', 'Foo-']) {
        expect(splitExtensionVersion(name)).toEqual({ name });
      }
    });
  });

  describe('compareVersions', () => {
    it('orders versions and treats a missing one as unknown', () => {
      expect(compareVersions('1.0.1', '1.0.0')! > 0).toBeTrue();
      expect(compareVersions('1.2', '1.10')! < 0).toBeTrue();
      expect(compareVersions('1.0', '1.0.0')).toBe(0);
      expect(compareVersions('1.0.0-rc.1', '1.0.0')! < 0).toBeTrue();
      expect(compareVersions('1.0.0+b1', '1.0.0')).toBe(0);
      expect(compareVersions(undefined, '1.0.0')).toBeUndefined();
    });

    it('compares prerelease identifiers one by one', () => {
      expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')! < 0).toBeTrue();
      expect(compareVersions('1.0.0-rc.10', '1.0.0-rc.2')! > 0).toBeTrue();
      expect(compareVersions('1.0.0-rc', '1.0.0-rc.1')! < 0).toBeTrue();
      expect(compareVersions('1.0.0-1', '1.0.0-alpha')! < 0).toBeTrue();
      expect(compareVersions('1.0.0-alpha', '1.0.0-beta')! < 0).toBeTrue();
    });
  });

  describe('removeZipSuffix', () => {
    it('removes only a trailing .zip, in any case', () => {
      expect(removeZipSuffix('Foo.zip')).toBe('Foo');
      expect(removeZipSuffix('Foo.ZIP')).toBe('Foo');
    });

    it('keeps dotted names such as versions whole', () => {
      expect(removeZipSuffix('Abs-1.0.1')).toBe('Abs-1.0.1');
      expect(removeZipSuffix('Abs-1.0.1.zip')).toBe('Abs-1.0.1');
      expect(removeZipSuffix('zip')).toBe('zip');
    });
  });

  describe('picking a file from the Downloads folder', () => {
    const win = (picker?: unknown) => ({ showOpenFilePicker: picker }) as unknown as Window;

    it('is only offered where the browser has a file dialog', () => {
      expect(canPickFromDownloads(win())).toBeFalse();
      expect(canPickFromDownloads(win(() => Promise.resolve([])))).toBeTrue();
    });

    it('opens the dialog in Downloads, for one zip file, and returns the file', async () => {
      const file = new File(['x'], 'Abs-1.0.1.zip');
      const picker = jasmine.createSpy('picker').and.resolveTo([{ getFile: async () => file }]);

      expect(await pickZipFromDownloads(win(picker))).toBe(file);

      const [options] = picker.calls.mostRecent().args;
      expect(options.startIn).toBe('downloads');
      expect(options.multiple).toBeFalse();
      expect(options.types[0].accept['application/zip']).toEqual(['.zip']);
    });

    it('returns null when the dialog is closed without a choice', async () => {
      const abort = new DOMException('closed', 'AbortError');
      expect(await pickZipFromDownloads(win(() => Promise.reject(abort)))).toBeNull();
    });

    it('passes other errors on', async () => {
      await expectAsync(
        pickZipFromDownloads(win(() => Promise.reject(new Error('denied'))))
      ).toBeRejectedWithError('denied');
    });

    it('refuses when the browser has no file dialog', async () => {
      await expectAsync(pickZipFromDownloads(win())).toBeRejected();
    });
  });

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
      expect(() => githubWebUrlToContentApi('https://example.com/o/r')).toThrowError(
        /Failed to convert GitHub URL/
      );
    });

    it('rejects URLs without a repository', () => {
      expect(() => githubWebUrlToContentApi('https://github.com/o')).toThrowError(
        /missing user or repository/
      );
    });

    it('rejects strings that are not URLs', () => {
      expect(() => githubWebUrlToContentApi('not a url')).toThrowError(
        /Failed to convert GitHub URL/
      );
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
      expect(clicked[0].target).toBe('_blank');
      expect(document.body.contains(clicked[0])).toBeFalse();
    });
  });
});
