import { TestBed } from '@angular/core/testing';
import { AlertService } from '@c8y/ngx-components';
import { firstValueFrom, of, throwError } from 'rxjs';
import { CepBlock, Repository, RepositoryItem } from './analytics.model';
import { AnalyticsService } from './analytics.service';
import { ExtensionBuilderService } from './extension-builder.service';
import { GitHubContentService } from './github-content.service';
import { RepositoryBackendService } from './repository-backend.service';
import { RepositoryConfigService } from './repository-config.service';
import { RepositoryError } from './repository-error';
import { RepositoryItemsService } from './repository-items.service';
import { RepositoryModeService } from './repository-mode.service';
import { RepositoryService } from './repository.service';

const repo = (id: string, enabled = false, over: Partial<Repository> = {}): Repository =>
  ({ id, name: `Repo ${id}`, url: `https://github.com/o/${id}`, accessToken: '', enabled, ...over }) as Repository;
const item = (name: string) => ({ id: name, name, file: `${name}.mon`, type: 'file' }) as RepositoryItem;
const flush = () => new Promise<void>(resolve => setTimeout(resolve));

describe('RepositoryService', () => {
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let mode: jasmine.SpyObj<RepositoryModeService>;
  let config: jasmine.SpyObj<RepositoryConfigService>;
  let items: jasmine.SpyObj<RepositoryItemsService>;
  let github: jasmine.SpyObj<GitHubContentService>;
  let backend: jasmine.SpyObj<RepositoryBackendService>;
  let builder: jasmine.SpyObj<ExtensionBuilderService>;
  let service: RepositoryService;

  const current = () => firstValueFrom(service.getRepositories());
  const create = async (initial: Repository[] = [repo('a', true), repo('b')]) => {
    config.fetchRepositories.and.resolveTo(initial);
    service = TestBed.inject(RepositoryService);
    await service.whenReady();
    return service;
  };

  beforeEach(() => {
    analytics = jasmine.createSpyObj('AnalyticsService', ['getDeployedBlocks']);
    analytics.getDeployedBlocks.and.resolveTo([]);
    alerts = jasmine.createSpyObj('AlertService', ['success', 'danger']);
    mode = jasmine.createSpyObj('RepositoryModeService', ['isBackendMode']);
    mode.isBackendMode.and.resolveTo(false);
    config = jasmine.createSpyObj('RepositoryConfigService', [
      'fetchRepositories', 'saveRepositories', 'getRepositoryAccessToken', 'getExpertMode', 'setExpertMode',
      'getGlobalAccessTokenMasked', 'setGlobalAccessToken'
    ]);
    config.saveRepositories.and.resolveTo();
    items = jasmine.createSpyObj('RepositoryItemsService', [
      'invalidateCache', 'getItemsForRepositories', 'filterRepositoryItems', 'analyzeRepositoryItems', 'getItemContent'
    ]);
    items.getItemsForRepositories.and.returnValue(of([]));
    github = jasmine.createSpyObj('GitHubContentService', ['testRepository']);
    backend = jasmine.createSpyObj('RepositoryBackendService', ['testRepository']);
    builder = jasmine.createSpyObj('ExtensionBuilderService', ['createExtensionFromList', 'createExtensionFromYaml', 'createExtensionFromRepository']);
    TestBed.configureTestingModule({
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: AlertService, useValue: alerts },
        { provide: RepositoryModeService, useValue: mode },
        { provide: RepositoryConfigService, useValue: config },
        { provide: RepositoryItemsService, useValue: items },
        { provide: GitHubContentService, useValue: github },
        { provide: RepositoryBackendService, useValue: backend },
        { provide: ExtensionBuilderService, useValue: builder }
      ]
    });
    spyOn(console, 'error');
    spyOn(console, 'warn');
  });

  describe('initial load', () => {
    it('loads the configured repositories', async () => {
      await create();
      expect((await current()).map(r => r.id)).toEqual(['a', 'b']);
      expect(config.saveRepositories).not.toHaveBeenCalled();
    });

    it('seeds and persists the default repository on a fresh tenant', async () => {
      await create([]);
      const repos = await current();
      expect(repos.length).toBe(1);
      expect(repos[0].enabled).toBeTrue();
      expect(config.saveRepositories).toHaveBeenCalledOnceWith(repos);
    });

    it('still uses the seeded default for the session when persisting it fails', async () => {
      config.saveRepositories.and.rejectWith(new Error('denied'));
      await create([]);
      expect((await current()).length).toBe(1);
    });

    it('alerts and falls back to an empty list when loading fails', async () => {
      config.fetchRepositories.and.rejectWith(new Error('403'));
      service = TestBed.inject(RepositoryService);
      expect(await service.whenReady()).toEqual([]);
      expect(alerts.danger).toHaveBeenCalledTimes(1);
    });
  });

  describe('add / update / delete', () => {
    beforeEach(async () => create());

    it('addRepository persists the live list including the new repository', async () => {
      await service.addRepository(repo('c'));

      expect(config.saveRepositories.calls.mostRecent().args[0].map(r => r.id)).toEqual(['a', 'b', 'c']);
      expect((await current()).map(r => r.id)).toEqual(['a', 'b', 'c']);
      expect(alerts.success).toHaveBeenCalledTimes(1);
      expect(items.invalidateCache).toHaveBeenCalled();
      expect(service.hasUnsavedChanges()).toBeFalse();
    });

    it('addRepository keeps state unchanged and alerts when persisting fails', async () => {
      config.saveRepositories.and.rejectWith(new Error('denied'));
      await expectAsync(service.addRepository(repo('c'))).toBeRejectedWith(jasmine.any(RepositoryError));
      expect((await current()).map(r => r.id)).toEqual(['a', 'b']);
      expect(alerts.danger).toHaveBeenCalledTimes(1);
      expect(alerts.success).not.toHaveBeenCalled();
    });

    it('updateRepository replaces the repository in place', async () => {
      await service.updateRepository(repo('b', false, { name: 'Renamed' }));
      const repos = await current();
      expect(repos.map(r => r.name)).toEqual(['Repo a', 'Renamed']);
      expect(config.saveRepositories).toHaveBeenCalled();
    });

    it('updateRepository rejects an unknown repository without persisting', async () => {
      await expectAsync(service.updateRepository(repo('zzz'))).toBeRejectedWith(jasmine.any(RepositoryError));
      expect(config.saveRepositories).not.toHaveBeenCalled();
    });

    it('updateRepository alerts when persisting fails', async () => {
      config.saveRepositories.and.rejectWith(new Error('x'));
      await expectAsync(service.updateRepository(repo('b', false, { name: 'N' }))).toBeRejected();
      expect(alerts.danger).toHaveBeenCalled();
      expect((await current())[1].name).toBe('Repo b');
    });

    it('deleteRepository removes the repository', async () => {
      await service.deleteRepository('a');
      expect((await current()).map(r => r.id)).toEqual(['b']);
      expect(config.saveRepositories.calls.mostRecent().args[0].map(r => r.id)).toEqual(['b']);
    });

    it('deleteRepository alerts and keeps the repository when persisting fails', async () => {
      config.saveRepositories.and.rejectWith(new Error('x'));
      await expectAsync(service.deleteRepository('a')).toBeRejected();
      expect((await current()).length).toBe(2);
      expect(alerts.danger).toHaveBeenCalled();
    });

    it('serializes concurrent mutations so none is lost', async () => {
      let release!: () => void;
      config.saveRepositories.and.returnValues(new Promise<void>(r => (release = r)), Promise.resolve());

      const first = service.addRepository(repo('c'));
      const second = service.addRepository(repo('d'));
      await flush();
      expect(config.saveRepositories).toHaveBeenCalledTimes(1); // the second waits for the first

      release();
      await Promise.all([first, second]);

      expect((await current()).map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
      expect(config.saveRepositories.calls.mostRecent().args[0].map(r => r.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('a failed mutation does not block the following ones', async () => {
      config.saveRepositories.and.returnValues(Promise.reject(new Error('x')), Promise.resolve());
      await expectAsync(service.addRepository(repo('c'))).toBeRejected();
      await expectAsync(service.addRepository(repo('d'))).toBeResolved();
      expect((await current()).map(r => r.id)).toEqual(['a', 'b', 'd']);
    });
  });

  describe('enabling repositories and unsaved changes', () => {
    beforeEach(async () => create());

    it('enables only one repository at a time', async () => {
      service.toggleRepositoryEnabled('b');
      await flush();
      expect((await current()).map(r => r.enabled)).toEqual([false, true]);
    });

    it('can disable the active repository', async () => {
      service.toggleRepositoryEnabled('a');
      await flush();
      expect((await current()).map(r => r.enabled)).toEqual([false, false]);
    });

    it('tracks the toggle as an unsaved change (also via hasUnsavedChanges$)', async () => {
      const flags: boolean[] = [];
      service.hasUnsavedChanges$.subscribe(f => flags.push(f));
      service.toggleRepositoryEnabled('b');
      await flush();
      expect(service.hasUnsavedChanges()).toBeTrue();
      expect(flags).toEqual([false, true]);
    });

    it('ignores toggles of unknown repositories', async () => {
      service.toggleRepositoryEnabled('zzz');
      await flush();
      expect((await current()).map(r => r.enabled)).toEqual([true, false]);
    });

    it('cancelChanges restores the last saved state', async () => {
      service.toggleRepositoryEnabled('b');
      service.cancelChanges();
      await flush();
      expect((await current()).map(r => r.enabled)).toEqual([true, false]);
      expect(service.hasUnsavedChanges()).toBeFalse();
    });

    it('saveAllRepositories persists the pending state and clears the unsaved flag', async () => {
      service.toggleRepositoryEnabled('b');
      await flush();
      await service.saveAllRepositories();

      expect(config.saveRepositories.calls.mostRecent().args[0].map(r => r.enabled)).toEqual([false, true]);
      expect(service.hasUnsavedChanges()).toBeFalse();
      expect(alerts.success).toHaveBeenCalled();
    });

    it('saveAllRepositories keeps the unsaved flag and alerts on failure', async () => {
      service.toggleRepositoryEnabled('b');
      await flush();
      config.saveRepositories.and.rejectWith(new Error('x'));
      await expectAsync(service.saveAllRepositories()).toBeRejectedWith(jasmine.any(RepositoryError));
      expect(service.hasUnsavedChanges()).toBeTrue();
      expect(alerts.danger).toHaveBeenCalled();
    });

    it('add/update/delete commit pending toggles of other repositories too', async () => {
      service.toggleRepositoryEnabled('b');
      await flush();
      await service.addRepository(repo('c'));
      expect(config.saveRepositories.calls.mostRecent().args[0].map(r => r.enabled)).toEqual([false, true, false]);
      expect(service.hasUnsavedChanges()).toBeFalse();
    });
  });

  describe('testRepository', () => {
    it('tests directly against GitHub without backend', async () => {
      await create();
      github.testRepository.and.resolveTo({ success: true });
      expect(await service.testRepository(repo('a'))).toEqual({ success: true });
      expect(backend.testRepository).not.toHaveBeenCalled();
    });

    it('tests through the backend in backend mode', async () => {
      await create();
      mode.isBackendMode.and.resolveTo(true);
      backend.testRepository.and.resolveTo({ success: false, status: 404 });
      expect(await service.testRepository(repo('a'))).toEqual({ success: false, status: 404 });
      expect(github.testRepository).not.toHaveBeenCalled();
    });
  });

  describe('refresh and reload', () => {
    beforeEach(async () => create());

    it('refreshRepositories reloads from the tenant options and announces success', async () => {
      config.fetchRepositories.and.resolveTo([repo('x', true)]);
      await service.refreshRepositories();
      expect((await current()).map(r => r.id)).toEqual(['x']);
      expect(alerts.success).toHaveBeenCalledTimes(1);
      expect(items.invalidateCache).toHaveBeenCalled();
    });

    it('refreshRepositories alerts once, does not claim success and rejects when the reload fails', async () => {
      config.fetchRepositories.and.rejectWith(new Error('403'));
      await expectAsync(service.refreshRepositories()).toBeRejectedWith(jasmine.any(RepositoryError));
      expect(alerts.danger).toHaveBeenCalledTimes(1);
      expect(alerts.success).not.toHaveBeenCalled();
      expect((await current()).map(r => r.id)).toEqual(['a', 'b']); // state untouched
    });

    it('reload invalidates the item cache; reloadAll refreshes repositories', async () => {
      items.invalidateCache.calls.reset();
      service.reload();
      expect(items.invalidateCache).toHaveBeenCalled();

      config.fetchRepositories.and.resolveTo([repo('y')]);
      await service.reloadAll();
      expect((await current()).map(r => r.id)).toEqual(['y']);
    });
  });

  describe('repository items', () => {
    beforeEach(async () => create());

    it('loads items of the repositories with the deployed blocks', async () => {
      const deployed = [{ id: 'd.X' }] as CepBlock[];
      analytics.getDeployedBlocks.and.resolveTo(deployed);
      items.getItemsForRepositories.and.returnValue(of([item('A')]));
      items.filterRepositoryItems.and.callFake(list => list);

      const result = await firstValueFrom(service.getRepositoryItems());

      expect(result.map(i => i.name)).toEqual(['A']);
      const [repos, loaded, hide] = items.getItemsForRepositories.calls.mostRecent().args;
      expect(repos.map(r => r.id)).toEqual(['a', 'b']);
      expect(loaded).toBe(deployed);
      expect(hide).toBeFalse();
    });

    it('still lists items when the deployed blocks cannot be loaded', async () => {
      analytics.getDeployedBlocks.and.rejectWith(new Error('engine down'));
      items.getItemsForRepositories.and.returnValue(of([item('A')]));
      items.filterRepositoryItems.and.callFake(list => list);
      expect((await firstValueFrom(service.getRepositoryItems())).length).toBe(1);
      expect(items.getItemsForRepositories.calls.mostRecent().args[1]).toEqual([]);
    });

    it('reloads with the new flag when the "hide installed" filter changes', async () => {
      items.filterRepositoryItems.and.callFake(list => list);
      const emissions: RepositoryItem[][] = [];
      const sub = service.getRepositoryItems().subscribe(v => emissions.push(v));
      await flush();

      service.updateHideInstalledFilter(true);
      await flush();

      expect(items.getItemsForRepositories.calls.mostRecent().args[2]).toBeTrue();
      sub.unsubscribe();
    });

    it('applies the item filter to the loaded items', async () => {
      items.getItemsForRepositories.and.returnValue(of([item('A'), item('B')]));
      items.filterRepositoryItems.and.callFake(list => list.filter(i => i.name === 'B'));
      expect((await firstValueFrom(service.getRepositoryItems())).map(i => i.name)).toEqual(['B']);
    });

    it('analyzes the items', async () => {
      items.getItemsForRepositories.and.returnValue(of([item('A')]));
      items.analyzeRepositoryItems.and.returnValue(of([item('Section')]));
      expect((await firstValueFrom(service.getRepositoryItemsAnalyzed())).map(i => i.name)).toEqual(['Section']);
    });

    it('alerts and yields an empty list when analysis fails', async () => {
      items.getItemsForRepositories.and.returnValue(of([item('A')]));
      items.analyzeRepositoryItems.and.returnValue(throwError(() => new Error('bad yaml')));
      expect(await firstValueFrom(service.getRepositoryItemsAnalyzed())).toEqual([]);
      expect(alerts.danger).toHaveBeenCalled();
    });

    it('delegates item content retrieval', async () => {
      items.getItemContent.and.returnValue(of('content'));
      expect(await firstValueFrom(service.getRepositoryItemContent(item('A'), true))).toBe('content');
      expect(items.getItemContent).toHaveBeenCalledWith(jasmine.anything(), true);
    });
  });

  describe('settings and tokens', () => {
    beforeEach(async () => create());

    it('delegates token and expert-mode access to the config service', async () => {
      config.getRepositoryAccessToken.and.resolveTo('tok');
      config.getExpertMode.and.resolveTo(true);
      config.getGlobalAccessTokenMasked.and.resolveTo('masked');
      config.setExpertMode.and.resolveTo();

      expect(await service.getRepositoryAccessToken('a')).toBe('tok');
      expect(await service.getExpertMode()).toBeTrue();
      expect(await service.getGlobalAccessTokenMasked()).toBe('masked');
      await service.setExpertMode(false);
      expect(config.setExpertMode).toHaveBeenCalledWith(false);
    });

    it('setGlobalAccessToken persists the token and invalidates the item cache (private repos may become readable)', async () => {
      config.setGlobalAccessToken.and.resolveTo();
      items.invalidateCache.calls.reset();
      await service.setGlobalAccessToken('ghp_x');
      expect(config.setGlobalAccessToken).toHaveBeenCalledWith('ghp_x');
      expect(items.invalidateCache).toHaveBeenCalled();
    });

    it('does not invalidate the cache when storing the token fails', async () => {
      config.setGlobalAccessToken.and.rejectWith(new Error('x'));
      items.invalidateCache.calls.reset();
      await expectAsync(service.setGlobalAccessToken('ghp_x')).toBeRejected();
      expect(items.invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('extension creation', () => {
    beforeEach(async () => create());

    it('delegates to the builder with the given flags', async () => {
      builder.createExtensionFromList.and.resolveTo({} as never);
      builder.createExtensionFromYaml.and.resolveTo({} as never);
      builder.createExtensionFromRepository.and.resolveTo({} as never);
      const r = repo('a');
      const monitors = [item('A')];
      const yaml = item('extensions');

      await service.createExtensionFromList('E', monitors, r, true, true, true);
      await service.createExtensionFromYaml('E', yaml, ['S'], r);
      await service.createExtensionFromRepository('E', r, false, true);

      expect(builder.createExtensionFromList).toHaveBeenCalledWith('E', monitors, r, true, true, true);
      expect(builder.createExtensionFromYaml).toHaveBeenCalledWith('E', yaml, ['S'], r, false, false, false);
      expect(builder.createExtensionFromRepository).toHaveBeenCalledWith('E', r, false, true, false);
    });
  });

  it('invalidates the item cache when destroyed', async () => {
    await create();
    items.invalidateCache.calls.reset();
    service.ngOnDestroy();
    expect(items.invalidateCache).toHaveBeenCalled();
  });
});
