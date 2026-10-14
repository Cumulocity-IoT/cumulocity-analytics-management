import { TestBed } from '@angular/core/testing';
import { AlertService } from '@c8y/ngx-components';
import { firstValueFrom } from 'rxjs';
import { CepBlock, Repository, RepositoryItem } from './analytics.model';
import { GitHubContentService } from './github-content.service';
import { RepositoryBackendService } from './repository-backend.service';
import { RepositoryError } from './repository-error';
import { RepositoryItemsService } from './repository-items.service';
import { RepositoryModeService } from './repository-mode.service';

const repo = (id = 'r1', enabled = true): Repository => ({ id, name: `Repo ${id}`, url: 'u', accessToken: '', enabled }) as Repository;
const item = (over: Partial<RepositoryItem>): RepositoryItem =>
  ({ id: '', name: 'A', file: 'A.mon', type: 'file', url: 'https://api/A.mon', downloadUrl: 'https://raw/A.mon', repositoryId: 'r1', repositoryName: 'Repo r1', ...over }) as RepositoryItem;
const ghEntry = (name: string, type = 'file') => ({ name, type, url: `https://api/${name}`, download_url: `https://raw/${name}` });
const monContent = (pkg: string, ...blocks: string[]) =>
  `package ${pkg};\n${blocks.map(b => `event ${b} { BlockBase $base; }`).join('\n')}`;

describe('RepositoryItemsService', () => {
  let service: RepositoryItemsService;
  let mode: jasmine.SpyObj<RepositoryModeService>;
  let github: jasmine.SpyObj<GitHubContentService>;
  let backend: jasmine.SpyObj<RepositoryBackendService>;
  let alerts: jasmine.SpyObj<AlertService>;

  beforeEach(() => {
    mode = jasmine.createSpyObj('RepositoryModeService', ['isBackendMode']);
    github = jasmine.createSpyObj('GitHubContentService', ['getContent', 'getItemContent']);
    backend = jasmine.createSpyObj('RepositoryBackendService', ['getContent', 'getItemContent']);
    alerts = jasmine.createSpyObj('AlertService', ['danger']);
    mode.isBackendMode.and.resolveTo(false);
    github.getContent.and.resolveTo([]);
    TestBed.configureTestingModule({
      providers: [
        { provide: RepositoryModeService, useValue: mode },
        { provide: GitHubContentService, useValue: github },
        { provide: RepositoryBackendService, useValue: backend },
        { provide: AlertService, useValue: alerts }
      ]
    });
    service = TestBed.inject(RepositoryItemsService);
    spyOn(console, 'error');
    spyOn(console, 'warn');
  });

  describe('filterRepositoryItems', () => {
    it('keeps .mon files and non-hidden directories', () => {
      const result = service.filterRepositoryItems([
        item({ file: 'A.mon' }),
        item({ file: 'B.txt' }),
        item({ file: 'sub', type: 'dir' }),
        item({ file: '.github', type: 'dir' })
      ]);
      expect(result.map(i => i.file)).toEqual(['A.mon', 'sub']);
    });

    it('reduces the list to extensions.yaml when present (case-insensitive)', () => {
      const result = service.filterRepositoryItems([item({ file: 'A.mon' }), item({ file: 'Extensions.YAML' })]);
      expect(result.map(i => i.file)).toEqual(['Extensions.YAML']);
    });
  });

  describe('analyzeRepositoryItems', () => {
    it('returns the filtered list when there is no extensions.yaml', async () => {
      const result = await firstValueFrom(service.analyzeRepositoryItems([item({ file: 'A.mon' }), item({ file: 'x.md' })]));
      expect(result.map(i => i.file)).toEqual(['A.mon']);
    });

    it('turns the sections of extensions.yaml into items', async () => {
      const yaml = item({ file: 'extensions.yaml', name: 'extensions' });
      github.getItemContent.and.resolveTo('Python:\n  files: [a.py]\nOffset:\n  files: [o.mon]\n');

      const result = await firstValueFrom(service.analyzeRepositoryItems([yaml, item({ file: 'A.mon' })]));

      expect(result.map(i => i.name)).toEqual(['Python', 'Offset']);
      expect(result.every(i => i.extensionsYamlItem === yaml)).toBeTrue();
      expect(new Set(result.map(i => i.id)).size).toBe(2);
    });

    it('yields no sections for an unparsable or non-object yaml', async () => {
      const yaml = item({ file: 'extensions.yaml' });
      github.getItemContent.and.resolveTo('key: [unclosed');
      expect(await firstValueFrom(service.analyzeRepositoryItems([yaml]))).toEqual([]);
      github.getItemContent.and.resolveTo('just a string');
      expect(await firstValueFrom(service.analyzeRepositoryItems([yaml]))).toEqual([]);
    });

    it('yields no sections when the yaml cannot be loaded', async () => {
      github.getItemContent.and.rejectWith(new Error('404'));
      expect(await firstValueFrom(service.analyzeRepositoryItems([item({ file: 'extensions.yaml' })]))).toEqual([]);
    });
  });

  describe('getItemContent', () => {
    it('uses direct GitHub access when the backend is unavailable', async () => {
      github.getItemContent.and.resolveTo('direct');
      expect(await firstValueFrom(service.getItemContent(item({}), true))).toBe('direct');
      expect(github.getItemContent).toHaveBeenCalledWith(jasmine.anything(), true);
      expect(backend.getItemContent).not.toHaveBeenCalled();
    });

    it('uses the backend in backend mode', async () => {
      mode.isBackendMode.and.resolveTo(true);
      backend.getItemContent.and.resolveTo('proxied');
      expect(await firstValueFrom(service.getItemContent(item({})))).toBe('proxied');
      expect(github.getItemContent).not.toHaveBeenCalled();
    });

    it('rethrows failures as RepositoryError without alerting the user', async () => {
      github.getItemContent.and.rejectWith(new Error('boom'));
      const error = await firstValueFrom(service.getItemContent(item({}))).catch(e => e);
      expect(error).toBeInstanceOf(RepositoryError);
      expect(alerts.danger).not.toHaveBeenCalled();
    });
  });

  describe('getItemsForRepositories', () => {
    it('returns nothing without enabled repositories', async () => {
      expect(await firstValueFrom(service.getItemsForRepositories([repo('r1', false)], [], false))).toEqual([]);
      expect(github.getContent).not.toHaveBeenCalled();
    });

    it('maps GitHub entries to items, skipping .json files, and extracts block FQNs from .mon files', async () => {
      github.getContent.and.resolveTo([ghEntry('Foo.mon'), ghEntry('config.json'), ghEntry('README.md'), ghEntry('sub', 'dir')]);
      github.getItemContent.and.resolveTo(monContent('com.acme', 'Foo'));

      const items = await firstValueFrom(service.getItemsForRepositories([repo()], [], false));

      expect(items.map(i => i.file)).toEqual(['Foo.mon', 'README.md', 'sub']);
      const [foo] = items;
      expect(foo.name).toBe('Foo');
      expect(foo.id).toBe('com.acme.Foo');
      expect(foo.blockIds).toEqual(['com.acme.Foo']);
      expect(foo.downloadUrl).toBe('https://raw/Foo.mon');
      expect(foo.repositoryId).toBe('r1');
      expect(items[1].id).toBe('README.md'); // non-.mon items use their file name as id
    });

    it('falls back to the file name when FQN extraction fails for one item', async () => {
      github.getContent.and.resolveTo([ghEntry('Foo.mon')]);
      github.getItemContent.and.rejectWith(new Error('rate limited'));
      const [foo] = await firstValueFrom(service.getItemsForRepositories([repo()], [], false));
      expect(foo.id).toBe('Foo.mon');
      expect(alerts.danger).not.toHaveBeenCalled();
    });

    it('marks installed items, including multi-block files, and can hide them', async () => {
      github.getContent.and.resolveTo([ghEntry('Pair.mon'), ghEntry('Other.mon')]);
      github.getItemContent.and.callFake(async (b: RepositoryItem) =>
        b.name === 'Pair' ? monContent('p', 'Send', 'Receive') : monContent('p', 'Other'));
      const deployed = [{ id: 'p.Receive' }] as CepBlock[];

      const all = await firstValueFrom(service.getItemsForRepositories([repo()], deployed, false));
      expect(all.map(i => [i.name, i.installed])).toEqual([['Pair', true], ['Other', false]]);

      service.invalidateCache();
      const hidden = await firstValueFrom(service.getItemsForRepositories([repo()], deployed, true));
      expect(hidden.map(i => i.name)).toEqual(['Other']);
    });

    it('combines items of several repositories', async () => {
      github.getContent.and.callFake(async (r: Repository) => [ghEntry(`${r.id}.md`)]);
      const items = await firstValueFrom(service.getItemsForRepositories([repo('a'), repo('b')], [], false));
      expect(items.map(i => i.file)).toEqual(['a.md', 'b.md']);
    });

    it('alerts with GitHub\'s reason and yields no items for a failing repository', async () => {
      github.getContent.and.rejectWith(new RepositoryError('x', 'API rate limit exceeded', undefined, 403));
      const items = await firstValueFrom(service.getItemsForRepositories([repo()], [], false));
      expect(items).toEqual([]);
      expect(alerts.danger).toHaveBeenCalledOnceWith(jasmine.stringContaining('API rate limit exceeded'));
    });

    it('uses a generic alert when the failure has no detail', async () => {
      github.getContent.and.rejectWith(new Error('network'));
      await firstValueFrom(service.getItemsForRepositories([repo()], [], false));
      expect(alerts.danger).toHaveBeenCalledOnceWith(jasmine.stringContaining('Repo r1'));
    });

    it('caches per repository until invalidated', async () => {
      github.getContent.and.resolveTo([ghEntry('a.md')]);
      await firstValueFrom(service.getItemsForRepositories([repo()], [], false));
      await firstValueFrom(service.getItemsForRepositories([repo()], [], false));
      expect(github.getContent).toHaveBeenCalledTimes(1);

      service.invalidateCache();
      await firstValueFrom(service.getItemsForRepositories([repo()], [], false));
      expect(github.getContent).toHaveBeenCalledTimes(2);
    });

    it('uses the backend for listing in backend mode', async () => {
      mode.isBackendMode.and.resolveTo(true);
      backend.getContent.and.resolveTo([ghEntry('a.md')]);
      await firstValueFrom(service.getItemsForRepositories([repo()], [], false));
      expect(backend.getContent).toHaveBeenCalled();
      expect(github.getContent).not.toHaveBeenCalled();
    });
  });
});
