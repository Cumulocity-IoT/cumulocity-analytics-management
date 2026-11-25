import { TestBed } from '@angular/core/testing';
import { IManagedObject } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import JSZip from 'jszip';
import { BsModalService } from 'ngx-bootstrap/modal';
import { BehaviorSubject, Subject } from 'rxjs';
import { buildBlockMetadataEvt, parseApamaBlockMetadata } from '../apama-block-metadata';
import { AnalyticsService } from '../analytics.service';
import { ConfirmationModalComponent } from '../component/confirmation-modal.component';
import { ExtensionAddComponent } from './extension-add.component';

const MON =
  'package com.acme;\n/** Foo Block.\n *\n * Does foo.\n *\n * @$blockCategory Calculation\n */\nevent Foo { BlockBase $base; }';
const flush = () => new Promise<void>(resolve => setTimeout(resolve));

/** Builds an uploadable zip from path -> content. */
async function zipFile(name: string, entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  Object.entries(entries).forEach(([path, content]) => zip.file(path, content));
  return new File([await zip.generateAsync({ type: 'blob' })], name, { type: 'application/zip' });
}

describe('ExtensionAddComponent', () => {
  let component: ExtensionAddComponent;
  let analytics: jasmine.SpyObj<AnalyticsService> & {
    uploadProgress$: BehaviorSubject<number | null>;
  };
  let alerts: jasmine.SpyObj<AlertService>;
  let modals: jasmine.SpyObj<BsModalService>;
  let handler: jasmine.Spy;
  let confirm$: Subject<boolean>;
  let modalHide: jasmine.Spy;
  let completed: number;
  let cancelled: number;

  const uploaded = () => handler.calls.mostRecent().args as [File, Record<string, any>, string];

  const create = (mode: 'add' | 'update' = 'add') => {
    component = TestBed.createComponent(ExtensionAddComponent).componentInstance;
    component.mode = mode;
    component.uploadExtensionHandler = handler as never;
    completed = 0;
    cancelled = 0;
    component.completed.subscribe(() => completed++);
    component.cancelled.subscribe(() => cancelled++);
    return component;
  };

  beforeEach(() => {
    analytics = Object.assign(
      jasmine.createSpyObj('AnalyticsService', [
        'getExtensionsFromInventory',
        'cancelExtensionCreation',
        'triggerCacheReload'
      ]),
      { uploadProgress$: new BehaviorSubject<number | null>(null) }
    );
    analytics.getExtensionsFromInventory.and.resolveTo([]);
    alerts = jasmine.createSpyObj('AlertService', ['success', 'addServerFailure']);
    confirm$ = new Subject<boolean>();
    modalHide = jasmine.createSpy('hide');
    modals = jasmine.createSpyObj('BsModalService', ['show']);
    modals.show.and.returnValue({ content: { closeSubject: confirm$ }, hide: modalHide } as never);
    handler = jasmine.createSpy('uploadExtensionHandler').and.resolveTo({ id: '1' });
    TestBed.configureTestingModule({
      imports: [ExtensionAddComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: AlertService, useValue: alerts },
        { provide: BsModalService, useValue: modals }
      ]
    });
    TestBed.overrideComponent(ExtensionAddComponent, {
      set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] }
    });
    spyOn(console, 'error');
    spyOn(console, 'warn');
  });

  describe('dropping files', () => {
    it('processes the first dropped file', async () => {
      create();
      const spy = spyOn(component, 'onFile').and.resolveTo();
      const file = new File([], 'a.zip');
      component.onFileDroppedEvent([{ file }, { file: new File([], 'b.zip') }]);
      expect(spy).toHaveBeenCalledOnceWith(file);
    });

    it('ignores empty drops', () => {
      create();
      const spy = spyOn(component, 'onFile');
      component.onFileDroppedEvent([]);
      component.onFileDroppedEvent(undefined as never);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('uploading a new extension', () => {
    it('names the extension after the file (without .zip, any case) and uploads it', async () => {
      create();
      const file = await zipFile('My.Ext.ZIP', { 'files/Foo.mon': MON });
      await component.onFile(file);

      const [sent, extension, mode] = uploaded();
      expect(sent).toBe(file);
      expect(extension['name']).toBe('My.Ext');
      expect(extension['pas_extension']).toBe('My.Ext');
      expect(mode).toBe('add');
    });

    const evt = (name: string) => buildBlockMetadataEvt(name, []);

    it('drops the " (1)" a browser adds to a repeated download', async () => {
      create();
      await component.onFile(await zipFile('Foo-1.0.1 (1).zip', { 'files/Foo.mon': MON }));
      expect(uploaded()[1]['name']).toBe('Foo-1.0.1');
    });

    it('drops any number in brackets, with or without a space', async () => {
      for (const [fileName, expected] of [
        ['Foo-1.0.1 (2).zip', 'Foo-1.0.1'],
        ['Foo-1.0.1 (12).zip', 'Foo-1.0.1'],
        ['Foo-1.0.1(3).zip', 'Foo-1.0.1']
      ]) {
        create();
        await component.onFile(await zipFile(fileName, { 'files/Foo.mon': MON }));
        expect(uploaded()[1]['name']).withContext(fileName).toBe(expected);
      }
    });

    it('lets the single metadata file correct any other renaming', async () => {
      for (const fileName of ['Foo-1.0.1 2.zip', 'Foo-1.0.1 copy.zip', 'Foo-1.0.1 - Copy.zip']) {
        create();
        await component.onFile(
          await zipFile(fileName, {
            'files/Foo.mon': MON,
            'files/events/Foo-1.0.1_metadata.evt': evt('Foo-1.0.1')
          })
        );
        expect(uploaded()[1]['name']).withContext(fileName).toBe('Foo-1.0.1');
      }
    });

    it('takes the name from the metadata file when the file name matches none', async () => {
      create();
      await component.onFile(
        await zipFile('renamed.zip', {
          'files/Foo.mon': MON,
          'files/events/Foo-1.0.1_metadata.evt': evt('Foo-1.0.1')
        })
      );
      expect(uploaded()[1]['name']).toBe('Foo-1.0.1');
      expect(uploaded()[1]['pas_extension']).toBe('Foo-1.0.1');
    });

    it('keeps the file name when it matches one of several metadata files (a bundle)', async () => {
      create();
      await component.onFile(
        await zipFile('bundle.zip', {
          'files/events/bundle_metadata.evt': evt('bundle'),
          'files/events/Other_metadata.evt': evt('Other')
        })
      );
      expect(uploaded()[1]['name']).toBe('bundle');
    });

    it('keeps the file name when several metadata files and none matches it', async () => {
      create();
      await component.onFile(
        await zipFile('mine.zip', {
          'files/events/A_metadata.evt': evt('A'),
          'files/events/B_metadata.evt': evt('B')
        })
      );
      expect(uploaded()[1]['name']).toBe('mine');
    });

    it('keeps the whole file name when it has no extension', async () => {
      create();
      const file = await zipFile('README', { 'files/Foo.mon': MON });
      await component.onFile(file);
      expect(uploaded()[1]['name']).toBe('README');
    });

    it('strips only the last extension of other files and keeps dot-only names', async () => {
      for (const [fileName, expected] of [
        ['pkg.v2.tar', 'pkg.v2'],
        ['.zip', '.zip'],
        ['.hidden', '.hidden']
      ]) {
        create();
        await component.onFile(await zipFile(fileName, { 'files/Foo.mon': MON }));
        expect(uploaded()[1]['name']).withContext(fileName).toBe(expected);
      }
    });

    it('reports success, completes the progress and leaves the loading state', async () => {
      create();
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(alerts.success).toHaveBeenCalledWith('Extension "E" uploaded.');
      expect(component.isComplete).toBeTrue();
      expect(component.isLoading).toBeFalse();
      expect(component.progress.value).toBe(100);
      expect(component.errorMessage).toBeNull();
      expect(component.createdApp?.['name']).toBe('E');
    });

    it('says "Updated" in update mode and uploads directly even if the extension exists', async () => {
      analytics.getExtensionsFromInventory.and.resolveTo([
        { id: '9', name: 'E' }
      ] as unknown as IManagedObject[]);
      create('update');
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(uploaded()[2]).toBe('update');
      expect(uploaded()[1]['id']).toBe('9'); // keeps the existing managed object
      expect(alerts.success).toHaveBeenCalledWith('Extension "E" updated.');
      expect(modals.show).not.toHaveBeenCalled();
    });
  });

  describe('analysing the zip', () => {
    const buildInfo = async (entries: Record<string, string>) => {
      create();
      await component.onFile(await zipFile('E.zip', entries));
      return uploaded()[1]['build_information'] as {
        build_type: string;
        monitors: any[];
        files: any[];
      };
    };

    it('marks the extension as externally built and lists monitors and other files separately', async () => {
      const info = await buildInfo({
        'files/Foo.mon': MON,
        'files/helper.py': 'x',
        'files/config.json': '{}',
        'files/blob.bin': 'x'
      });
      expect(info.build_type).toBe('external');
      expect(info.monitors.map(m => m.file)).toEqual(['files/Foo.mon']);
      expect(info.files.map(f => [f.name, f.type])).toEqual(
        jasmine.arrayContaining([
          ['helper.py', 'script'],
          ['config.json', 'config'],
          ['blob.bin', 'file']
        ])
      );
    });

    it('derives monitor name and the block id from the file', async () => {
      const [monitor] = (await buildInfo({ 'files/sub/Foo.mon': MON })).monitors;
      expect(monitor).toEqual(
        jasmine.objectContaining({ name: 'Foo', id: 'com.acme.Foo', custom: true, type: 'file' })
      );
    });

    it('reads category, description and id from the generated metadata event file', async () => {
      const blocks = parseApamaBlockMetadata(MON, 'com.acme');
      const [monitor] = (
        await buildInfo({
          'files/Foo.mon': MON,
          'files/events/Foo_metadata.evt': buildBlockMetadataEvt('E', blocks)
        })
      ).monitors;
      expect(monitor.id).toBe('com.acme.Foo');
      expect(monitor.category).toBe('Calculation');
      expect(monitor.description).toBe('Does foo.');
    });

    it('reads one extension-wide metadata file whose name matches no monitor, for every block', async () => {
      const two =
        'package com.acme;\n/** Bar Block.\n *\n * Does "bar".\n *\n * @$blockCategory Input\n */\nevent Bar { BlockBase $base; }';
      const blocks = [
        ...parseApamaBlockMetadata(MON, 'com.acme'),
        ...parseApamaBlockMetadata(two, 'com.acme')
      ];
      const info = await buildInfo({
        'files/Foo.mon': MON,
        'files/Bar.mon': two,
        'files/events/E_metadata.evt': buildBlockMetadataEvt('E', blocks)
      });
      const byName = Object.fromEntries(info.monitors.map(m => [m.name, m]));
      expect(byName['Foo'].category).toBe('Calculation');
      expect(byName['Bar'].category).toBe('Input');
      expect(byName['Bar'].description).toBe('Does "bar".');
      expect(info.files).toEqual([]);
    });

    it('matches a file that defines several blocks to its metadata, whatever the file is called', async () => {
      const pair =
        'package com.acme;\n/** Send. */\nevent Send { BlockBase $base; }\n/** Receive. */\nevent Receive { BlockBase $base; }';
      const info = await buildInfo({
        'files/Pair.mon': pair,
        'files/events/E_metadata.evt': buildBlockMetadataEvt(
          'E',
          parseApamaBlockMetadata(pair, 'com.acme')
        )
      });
      expect(info.monitors[0].id).toBe('com.acme.Send');
      expect(info.monitors[0].blockIds).toEqual(['com.acme.Send', 'com.acme.Receive']);
      expect(info.monitors[0].name).toBe('Pair');
    });

    it('does not list the consumed metadata file again, but lists other event files', async () => {
      const info = await buildInfo({
        'files/Foo.mon': MON,
        'files/events/Foo_metadata.evt': buildBlockMetadataEvt(
          'E',
          parseApamaBlockMetadata(MON, 'com.acme')
        ),
        'files/events/E_messages.evt': 'x'
      });
      expect(info.files.map(f => f.file)).toEqual(['files/events/E_messages.evt']);
    });

    it('keeps the block id and omits the details when the metadata cannot be parsed', async () => {
      const [monitor] = (
        await buildInfo({ 'files/Foo.mon': MON, 'files/events/Foo_metadata.evt': 'garbage' })
      ).monitors;
      expect(monitor.id).toBe('com.acme.Foo');
      expect(monitor.category).toBeUndefined();
    });

    it('ignores operating system and tooling noise', async () => {
      const info = await buildInfo({
        'files/Foo.mon': MON,
        '__MACOSX/files/._Foo.mon': 'x',
        'files/.DS_Store': 'x',
        '.git/config': 'x',
        'node_modules/a/index.js': 'x'
      });
      expect(info.files).toEqual([]);
    });

    it('rejects files that are not zip archives', async () => {
      create();
      await component.onFile(new File(['not a zip'], 'E.zip'));
      expect(component.errorMessage).toBe('Failed to analyze extension package');
      expect(handler).not.toHaveBeenCalled();
      expect(component.isLoading).toBeFalse();
    });
  });

  describe('when the extension already exists (add mode)', () => {
    beforeEach(() => {
      analytics.getExtensionsFromInventory.and.resolveTo([
        { id: '9', name: 'E' }
      ] as unknown as IManagedObject[]);
    });

    const drop = async () => {
      create('add');
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
    };

    it('asks before updating and does not upload yet', async () => {
      await drop();
      const [type, options] = modals.show.calls.mostRecent().args as [
        unknown,
        { initialState: { message: string } }
      ];
      expect(type).toBe(ConfirmationModalComponent);
      expect(options.initialState.message).toContain('"E" already exists');
      expect(handler).not.toHaveBeenCalled();
      expect(completed).toBe(1); // hands over to the confirmation dialog
    });

    it('updates after confirmation, refreshes the lists and closes the dialog', async () => {
      await drop();
      confirm$.next(true);
      await flush();
      expect(uploaded()[2]).toBe('update');
      expect(analytics.triggerCacheReload).toHaveBeenCalledWith(true);
      expect(modalHide).toHaveBeenCalled();
      expect(component.isLoading).toBeFalse();
    });

    it('does nothing when declined', async () => {
      await drop();
      confirm$.next(false);
      await flush();
      expect(handler).not.toHaveBeenCalled();
      expect(modalHide).toHaveBeenCalled();
    });

    it('shows the server failure when the confirmed update fails', async () => {
      handler.and.rejectWith({ status: 500 });
      await drop();
      confirm$.next(true);
      await flush();
      expect(alerts.addServerFailure).toHaveBeenCalledWith({ status: 500 });
      expect(component.isLoading).toBeFalse();
    });

    it('never deletes the installed extension when the dialog is closed, declined or the wizard is destroyed', async () => {
      await drop();
      component.cancel();
      component.ngOnDestroy();
      expect(analytics.cancelExtensionCreation).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    it('reports a falsy upload result', async () => {
      handler.and.resolveTo(undefined);
      create();
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(component.errorMessage).toBe('Could not create extension!');
      expect(component.isComplete).toBeFalse();
      expect(component.isLoading).toBeFalse();
    });

    it('translates known error codes into their friendly message', async () => {
      handler.and.rejectWith({ message: 'TYPE_VALIDATION' });
      create();
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(component.errorMessage).toContain('Wrong file format');
    });

    it('shows other error messages as they are', async () => {
      handler.and.rejectWith(new Error('Quota exceeded'));
      create();
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(component.errorMessage).toBe('Quota exceeded');
    });

    it('translates error codes passed as plain strings', async () => {
      handler.and.rejectWith('NO_MANIFEST_FILE');
      create();
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(component.errorMessage).toBe('Could not find a manifest.');
    });

    it('falls back to a server failure alert for errors without a message', async () => {
      handler.and.rejectWith(42);
      create();
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(alerts.addServerFailure).toHaveBeenCalledWith(42);
    });

    it('clears the drop area after a failure', async () => {
      handler.and.rejectWith(new Error('x'));
      create();
      const onDelete = jasmine.createSpy('onDelete');
      component.dropAreaComponent = { onDelete } as never;
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(onDelete).toHaveBeenCalled();
    });

    it('starts every upload from a clean state', async () => {
      handler.and.rejectWith(new Error('x'));
      create();
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      handler.and.resolveTo({ id: '2' });
      await component.onFile(await zipFile('E.zip', { 'files/Foo.mon': MON }));
      expect(component.errorMessage).toBeNull();
      expect(component.isComplete).toBeTrue();
    });
  });

  describe('closing', () => {
    it('cancel() reports cancelling', () => {
      create().cancel();
      expect(cancelled).toBe(1);
    });

    it('done() reports completion', () => {
      create().done();
      expect(completed).toBe(1);
    });

    it('rolls back a half-created extension that is not complete', () => {
      create();
      component.state.extension = { id: 'tmp', name: 'E' };
      component.cancel();
      expect(analytics.cancelExtensionCreation).toHaveBeenCalledWith({ id: 'tmp', name: 'E' });
    });

    it('does not roll back a completed upload', () => {
      create();
      component.state.extension = { id: 'tmp', name: 'E' };
      component.state.isComplete = true;
      component.ngOnDestroy();
      expect(analytics.cancelExtensionCreation).not.toHaveBeenCalled();
    });
  });
});
