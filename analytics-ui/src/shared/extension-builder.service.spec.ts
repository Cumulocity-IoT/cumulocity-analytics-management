import { TestBed } from '@angular/core/testing';
import { IFetchResponse } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import JSZip from 'jszip';
import { Repository, RepositoryItem } from './analytics.model';
import { AnalyticsService } from './analytics.service';
import { ExtensionBuilderService } from './extension-builder.service';
import { GitHubContentService } from './github-content.service';
import { RepositoryBackendService } from './repository-backend.service';
import { RepositoryError } from './repository-error';
import { RepositoryModeService } from './repository-mode.service';

const repository = { id: 'r1', name: 'R', url: 'u', accessToken: '', enabled: true } as Repository;
const item = (file: string, over: Partial<RepositoryItem> = {}): RepositoryItem =>
  ({ id: '', name: file.replace(/\.[^.]+$/, ''), file, type: 'file', url: `https://api/${file}`, downloadUrl: `https://raw/${file}`, repositoryId: 'r1', ...over }) as RepositoryItem;
const MON = 'package com.acme;\n/** My Block. */\nevent MyBlock { BlockBase $base; }';

describe('ExtensionBuilderService', () => {
  let service: ExtensionBuilderService;
  let mode: jasmine.SpyObj<RepositoryModeService>;
  let github: jasmine.SpyObj<GitHubContentService>;
  let backend: jasmine.SpyObj<RepositoryBackendService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let alerts: jasmine.SpyObj<AlertService>;

  beforeEach(() => {
    mode = jasmine.createSpyObj('RepositoryModeService', ['isBackendMode']);
    github = jasmine.createSpyObj('GitHubContentService', ['getItemContent']);
    backend = jasmine.createSpyObj('RepositoryBackendService', ['createExtensionFromList', 'createExtensionFromYaml', 'createExtensionFromRepository']);
    analytics = jasmine.createSpyObj('AnalyticsService', ['uploadExtension', 'restartCepEngine']);
    alerts = jasmine.createSpyObj('AlertService', ['danger']);
    TestBed.configureTestingModule({
      providers: [
        { provide: RepositoryModeService, useValue: mode },
        { provide: GitHubContentService, useValue: github },
        { provide: RepositoryBackendService, useValue: backend },
        { provide: AnalyticsService, useValue: analytics },
        { provide: AlertService, useValue: alerts }
      ]
    });
    service = TestBed.inject(ExtensionBuilderService);
    spyOn(console, 'error');
  });

  describe('backend mode', () => {
    beforeEach(() => mode.isBackendMode.and.resolveTo(true));
    const ok = { status: 201 } as unknown as IFetchResponse;

    it('delegates list builds', async () => {
      backend.createExtensionFromList.and.resolveTo(ok);
      const monitors = [item('A.mon')];
      expect(await service.createExtensionFromList('E', monitors, repository, true, true, false)).toBe(ok);
      expect(backend.createExtensionFromList).toHaveBeenCalledWith('E', monitors, repository, true, true, false);
    });

    it('delegates yaml builds', async () => {
      backend.createExtensionFromYaml.and.resolveTo(ok);
      const yaml = item('extensions.yaml');
      await service.createExtensionFromYaml('E', yaml, ['S'], repository, true);
      expect(backend.createExtensionFromYaml).toHaveBeenCalledWith('E', yaml, ['S'], repository, true, false, false);
    });

    it('delegates repository builds', async () => {
      backend.createExtensionFromRepository.and.resolveTo(ok);
      await service.createExtensionFromRepository('E', repository, false, false, true);
      expect(backend.createExtensionFromRepository).toHaveBeenCalledWith('E', repository, false, false, true);
    });
  });

  describe('browser mode', () => {
    beforeEach(() => {
      mode.isBackendMode.and.resolveTo(false);
      analytics.uploadExtension.and.resolveTo({} as never);
      analytics.restartCepEngine.and.resolveTo();
      github.getItemContent.and.callFake(async (i: RepositoryItem) => (i.file.endsWith('.mon') ? MON : 'other'));
    });

    const uploadedZip = async () => {
      const file = analytics.uploadExtension.calls.mostRecent().args[0] as File;
      return JSZip.loadAsync(await file.arrayBuffer());
    };

    it('rejects yaml and repository builds with a 501 and an explanatory alert', async () => {
      expect(((await service.createExtensionFromYaml('E', item('x.yaml'), [], repository)) as any).status).toBe(501);
      expect(((await service.createExtensionFromRepository('E', repository)) as any).status).toBe(501);
      expect(alerts.danger).toHaveBeenCalledTimes(2);
      expect(backend.createExtensionFromYaml).not.toHaveBeenCalled();
    });

    it('builds a zip with content nested under files/ and uploads it in add mode', async () => {
      const result = await service.createExtensionFromList('E', [item('MyBlock.mon'), item('helper.py')], repository);

      expect((result as any).status).toBe(200);
      const [file, extension, mode_] = analytics.uploadExtension.calls.mostRecent().args as [File, any, string];
      expect(file.name).toBe('E.zip');
      expect(file.type).toBe('application/zip');
      expect(mode_).toBe('add');
      expect(extension.pas_extension).toBe('E');
      expect(extension.build_information.build_type).toBe('external');
      expect(extension.build_information.monitors.map((m: any) => m.file)).toEqual(['MyBlock.mon']);

      const zip = await uploadedZip();
      expect(Object.keys(zip.files).filter(n => !zip.files[n].dir).sort()).toEqual([
        'files/MyBlock.mon', 'files/events/E_messages.evt', 'files/events/E_metadata.evt', 'files/helper.py'
      ]);
      expect(await zip.file('files/events/E_metadata.evt')!.async('string')).toContain('com.acme.MyBlock');
    });

    it('skips directories, build artefacts and .git content', async () => {
      await service.createExtensionFromList('E', [
        item('keep.mon'), item('sub', { type: 'dir' }), item('x.log'), item('.project'), item('a.OUT'), item('.git/config'), item('.github/ci.yml')
      ], repository);

      const names = Object.keys((await uploadedZip()).files).filter(n => !n.endsWith('/'));
      expect(names).toContain('files/keep.mon');
      expect(names.some(n => /x\.log|\.project|a\.OUT|\.git/.test(n))).toBeFalse();
      expect(github.getItemContent).toHaveBeenCalledTimes(1);
    });

    it('omits event files when no block metadata can be derived', async () => {
      github.getItemContent.and.resolveTo('package p;\nmonitor M {}');
      await service.createExtensionFromList('E', [item('M.mon')], repository);
      expect(Object.keys((await uploadedZip()).files).some(n => n.includes('events'))).toBeFalse();
    });

    it('restarts the engine only when deploy is requested', async () => {
      await service.createExtensionFromList('E', [item('A.mon')], repository, false, false);
      expect(analytics.restartCepEngine).not.toHaveBeenCalled();
      await service.createExtensionFromList('E', [item('A.mon')], repository, false, true);
      expect(analytics.restartCepEngine).toHaveBeenCalledTimes(1);
    });

    it('never throws: reports a 500 and alerts when something fails', async () => {
      analytics.uploadExtension.and.rejectWith(new Error('c8y down'));
      const result = await service.createExtensionFromList('MyExt', [item('A.mon')], repository);
      expect((result as any).status).toBe(500);
      expect(alerts.danger).toHaveBeenCalledWith(jasmine.stringContaining('"MyExt"'));
    });

    it('shows the user message of a RepositoryError', async () => {
      github.getItemContent.and.rejectWith(new RepositoryError('x', 'GitHub says no'));
      const result = await service.createExtensionFromList('E', [item('A.mon')], repository);
      expect((result as any).status).toBe(500);
      expect(alerts.danger).toHaveBeenCalledOnceWith('GitHub says no');
      expect(analytics.uploadExtension).not.toHaveBeenCalled();
    });
  });
});
