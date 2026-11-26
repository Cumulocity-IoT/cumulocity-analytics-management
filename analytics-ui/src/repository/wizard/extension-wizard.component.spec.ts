import { TestBed } from '@angular/core/testing';
import { AlertService, BottomDrawerRef } from '@c8y/ngx-components';
import { BehaviorSubject, of } from 'rxjs';
import {
  AnalyticsService,
  GitHubRelease,
  GitHubReleaseService,
  Repository,
  RepositoryItem,
  RepositoryService
} from '../../shared';
import { ExtensionWizardComponent } from './extension-wizard.component';

const repo = (id: string): Repository =>
  ({
    id,
    name: `Repo ${id}`,
    url: 'https://github.com/o/r',
    accessToken: ''
  }) as Repository;
const item = (name: string, over: Partial<RepositoryItem> = {}): RepositoryItem =>
  ({
    id: name,
    name,
    file: `${name}.mon`,
    type: 'file',
    url: '',
    downloadUrl: '',
    repositoryId: 'a',
    repositoryName: 'Repo a',
    ...over
  }) as RepositoryItem;
const release = (id: number, assets: string[]): GitHubRelease =>
  ({
    id,
    tagName: `v${id}`,
    name: `v${id}`,
    publishedAt: '',
    assets: assets.map((name, i) => ({
      id: id * 10 + i,
      name,
      size: 1,
      browserDownloadUrl: `u/${name}`,
      contentType: 'application/zip'
    }))
  }) as GitHubRelease;
const flush = () => new Promise<void>(resolve => setTimeout(resolve));

describe('ExtensionWizardComponent', () => {
  let component: ExtensionWizardComponent;
  let repositories: jasmine.SpyObj<RepositoryService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let github: jasmine.SpyObj<GitHubReleaseService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let drawer: jasmine.SpyObj<BottomDrawerRef<ExtensionWizardComponent>>;

  const create = async (initialSource?: 'release' | 'build' | 'upload') => {
    const fixture = TestBed.createComponent(ExtensionWizardComponent);
    component = fixture.componentInstance;
    if (initialSource) {
      component.initialSource = initialSource;
    }
    component.ngOnInit();
    await flush();
    return component;
  };

  beforeEach(() => {
    repositories = jasmine.createSpyObj('RepositoryService', [
      'getRepositories',
      'getRepositoryItemsAnalyzedFor',
      'getRepositoryAccessToken',
      'createExtensionFromList',
      'createExtensionFromYaml',
      'deployReleaseAsset'
    ]);
    repositories.getRepositories.and.returnValue(
      new BehaviorSubject<Repository[]>([repo('a'), repo('off')])
    );
    repositories.getRepositoryItemsAnalyzedFor.and.returnValue(
      of([item('Good'), item('Installed', { installed: true })])
    );
    repositories.getRepositoryAccessToken.and.resolveTo('tok');
    repositories.createExtensionFromList.and.resolveTo({ status: 200 } as never);
    repositories.createExtensionFromYaml.and.resolveTo({ status: 200 } as never);
    repositories.deployReleaseAsset.and.resolveTo({ id: '55' });
    analytics = jasmine.createSpyObj('AnalyticsService', [
      'isBackendServiceAvailable',
      'uploadExtension',
      'restartCepEngine',
      'getExtensionsFromInventory'
    ]);
    analytics.isBackendServiceAvailable.and.resolveTo(true);
    analytics.restartCepEngine.and.resolveTo();
    analytics.getExtensionsFromInventory.and.resolveTo([]);
    github = jasmine.createSpyObj('GitHubReleaseService', ['parseOwnerRepo', 'listReleases']);
    github.parseOwnerRepo.and.returnValue({ owner: 'o', repo: 'r' });
    github.listReleases.and.resolveTo([release(2, ['b.zip', 'notes.txt']), release(1, ['a.zip'])]);
    alerts = jasmine.createSpyObj('AlertService', ['success', 'danger', 'warning']);
    drawer = jasmine.createSpyObj('BottomDrawerRef', ['close']);
    drawer.close.and.resolveTo();
    spyOn(console, 'error');
    TestBed.configureTestingModule({
      imports: [ExtensionWizardComponent],
      providers: [
        { provide: RepositoryService, useValue: repositories },
        { provide: AnalyticsService, useValue: analytics },
        { provide: GitHubReleaseService, useValue: github },
        { provide: AlertService, useValue: alerts },
        { provide: BottomDrawerRef, useValue: drawer }
      ]
    });
    TestBed.overrideComponent(ExtensionWizardComponent, {
      set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] }
    });
  });

  describe('steps', () => {
    it('starts on the source step and cannot continue without a choice', async () => {
      await create();
      expect(component.step()).toBe('source');
      expect(component.canContinue()).toBeFalse();
    });

    it('has a different step list per source', async () => {
      await create();
      component.chooseSource('release');
      expect(component.steps()).toEqual(['source', 'repository', 'release', 'review', 'result']);
      component.chooseSource('build');
      expect(component.steps()).toEqual([
        'source',
        'repository',
        'content',
        'details',
        'review',
        'result'
      ]);
      component.chooseSource('upload');
      expect(component.steps()).toEqual(['source', 'upload']);
    });

    it('splits the release path into a download and an upload step without the backend', async () => {
      analytics.isBackendServiceAvailable.and.resolveTo(false);
      await create();
      component.chooseSource('release');
      expect(component.steps()).toEqual(['source', 'repository', 'release', 'download', 'upload']);
    });

    it('skips the source step when the caller names one', async () => {
      await create('upload');
      expect(component.step()).toBe('upload');
    });

    it('needs a repository to continue, and accepts disabled ones too', async () => {
      await create();
      component.chooseSource('build');
      component.next();
      expect(component.canContinue()).toBeFalse();
      expect(component.blockedReason()).toBe('Select a repository to continue.');
      component.chooseRepository('off');
      expect(component.canContinue()).toBeTrue();
      component.chooseRepository('a');
      expect(component.canContinue()).toBeTrue();
    });

    it('goes back and clears nothing but the position', async () => {
      await create();
      component.chooseSource('build');
      component.next();
      component.back();
      expect(component.step()).toBe('source');
      expect(component.source()).toBe('build');
    });

    it('drops the selection when the repository changes', async () => {
      await create();
      component.chooseSource('build');
      component.next();
      component.chooseRepository('a');
      component.next();
      await flush();
      component.toggleItem(component.items()[0], true);
      component.back();
      component.chooseRepository('off');
      expect(component.selectedIds().size).toBe(0);
      expect(component.items()).toEqual([]);
    });
  });

  describe('build path', () => {
    const toContent = async () => {
      await create();
      component.chooseSource('build');
      component.next();
      component.chooseRepository('a');
      component.next();
      await flush();
    };

    it('loads the items of the chosen repository only', async () => {
      await toContent();
      expect(repositories.getRepositoryItemsAnalyzedFor).toHaveBeenCalledWith('a');
      expect(component.items().map(i => i.name)).toEqual(['Good', 'Installed']);
    });

    it('shows installed items as not selectable, with a reason', async () => {
      await toContent();
      const [, installed] = component.items();
      expect(component.isDisabled(installed)).toBeTrue();
      expect(component.reason(installed)).toBe('Already installed');
      expect(component.selectableCount()).toBe(1);
    });

    it('needs a selection to continue and selects every available item at once', async () => {
      await toContent();
      expect(component.canContinue()).toBeFalse();
      component.toggleAll(true);
      expect([...component.selectedIds()]).toEqual(['Good']);
      expect(component.allSelected()).toBeTrue();
      component.toggleAll(false);
      expect(component.selectedIds().size).toBe(0);
    });

    it('filters the visible items by name', async () => {
      await toContent();
      component.filter.set('inst');
      expect(component.visibleItems().map(i => i.name)).toEqual(['Installed']);
    });

    it('suggests the first selected name, without the .mon suffix, and needs a name', async () => {
      await toContent();
      component.toggleItem(component.items()[0], true);
      component.next();
      expect(component.step()).toBe('details');
      expect(component.name()).toBe('Good');
      component.name.set('  ');
      expect(component.canContinue()).toBeFalse();
    });

    it('creates the extension from the selected files and reports success', async () => {
      await toContent();
      component.toggleItem(component.items()[0], true);
      component.next();
      component.name.set('MyExt');
      component.next(); // review
      component.next(); // result
      await flush();
      expect(repositories.createExtensionFromList).toHaveBeenCalledWith(
        'MyExt',
        [component.items()[0]],
        jasmine.objectContaining({ id: 'a' }),
        true,
        false
      );
      expect(component.result()).toBe('done');
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('"MyExt.zip"'));
    });

    it('builds from yaml sections through the yaml path', async () => {
      const yaml = item('extensions', { file: 'extensions.yaml' });
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(
        of([item('Python', { extensionsYamlItem: yaml, sectionFiles: ['Python.mon'] })])
      );
      await toContent();
      component.toggleItem(component.items()[0], true);
      component.next();
      component.next();
      component.next();
      await flush();
      expect(repositories.createExtensionFromYaml).toHaveBeenCalledWith(
        'Python',
        yaml,
        ['Python'],
        jasmine.objectContaining({ id: 'a' }),
        true,
        false
      );
    });

    it('does not offer sections without the backend service', async () => {
      analytics.isBackendServiceAvailable.and.resolveTo(false);
      const yaml = item('extensions', { file: 'extensions.yaml' });
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(
        of([item('Python', { extensionsYamlItem: yaml })])
      );
      await toContent();
      expect(component.reason(component.items()[0])).toBe('Needs the backend service');
    });

    it('shows a failed result when the build throws (the service already alerted)', async () => {
      repositories.createExtensionFromList.and.rejectWith(new Error('x'));
      await toContent();
      component.toggleItem(component.items()[0], true);
      component.next();
      component.next();
      component.next();
      await flush();
      expect(component.result()).toBe('failed');
      expect(alerts.success).not.toHaveBeenCalled();
    });

    it('treats an error status as a failure', async () => {
      repositories.createExtensionFromList.and.resolveTo({ status: 500 } as never);
      await toContent();
      component.toggleItem(component.items()[0], true);
      component.next();
      component.next();
      component.next();
      await flush();
      expect(component.result()).toBe('failed');
    });
  });

  describe('release path', () => {
    const toRelease = async () => {
      await create();
      component.chooseSource('release');
      component.next();
      component.chooseRepository('a');
      component.next();
      await flush();
    };

    it('lists the releases with the repository token and picks the newest', async () => {
      await toRelease();
      expect(github.listReleases).toHaveBeenCalledWith('o', 'r', 'tok');
      expect(component.release()?.tagName).toBe('v2');
    });

    it('offers only zip assets and selects a single one on its own', async () => {
      await toRelease();
      expect(component.assets().map(a => a.name)).toEqual(['b.zip']);
      expect(component.asset()?.name).toBe('b.zip');
      expect(component.canContinue()).toBeTrue();
    });

    it('needs a choice when a release has several zip assets, and says so', async () => {
      github.listReleases.and.resolveTo([release(3, ['a.zip', 'b.zip'])]);
      await toRelease();
      expect(component.canContinue()).toBeFalse();
      expect(component.blockedReason()).toBe('Select an asset to continue.');
      component.assetId.set(component.assets()[0].id);
      expect(component.canContinue()).toBeTrue();
      expect(component.blockedReason()).toBe('');
    });

    it('filters a long asset list by name and resets the filter for another release', async () => {
      github.listReleases.and.resolveTo([
        release(3, ['Abs-1.zip', 'Constant-1.zip', 'Offset-1.zip']),
        release(1, ['x.zip'])
      ]);
      await toRelease();
      component.assetFilter.set('con');
      expect(component.visibleAssets().map(a => a.name)).toEqual(['Constant-1.zip']);
      component.chooseRelease(1);
      expect(component.assetFilter()).toBe('');
    });

    it('re-evaluates the asset when another release is chosen', async () => {
      github.listReleases.and.resolveTo([release(3, ['a.zip', 'b.zip']), release(1, ['c.zip'])]);
      await toRelease();
      expect(component.asset()).toBeNull();
      component.chooseRelease(1);
      expect(component.asset()?.name).toBe('c.zip');
    });

    it('says so when the repository has no releases, and remembers it for the list', async () => {
      github.listReleases.and.resolveTo([]);
      await toRelease();
      expect(component.noReleases()).toBeTrue();
      expect(component.canContinue()).toBeFalse();
      expect(component.blockedReason()).toBe('This repository has no releases.');
      expect(component.reposWithoutReleases().has('a')).toBeTrue();
    });

    it('offers to build from the same repository instead', async () => {
      github.listReleases.and.resolveTo([]);
      await toRelease();
      component.buildFromRepository();
      await flush();
      expect(component.source()).toBe('build');
      expect(component.step()).toBe('content');
      expect(component.repositoryId()).toBe('a');
      expect(repositories.getRepositoryItemsAnalyzedFor).toHaveBeenCalledWith('a');
    });

    const toReview = async () => {
      await toRelease();
      component.next(); // review
    };

    it('goes from the release to a review that names the extension after the asset', async () => {
      await toReview();
      expect(component.step()).toBe('review');
      expect(component.assetExtensionName()).toBe('b');
    });

    it('keeps the version out of the extension name', async () => {
      github.listReleases.and.resolveTo([release(3, ['Abs-1.0.1.zip'])]);
      await toRelease();
      expect(component.assetExtension()).toEqual({ name: 'Abs', version: '1.0.1' });
    });

    it('says what the deployment replaces, and asks the service to replace it', async () => {
      github.listReleases.and.resolveTo([release(3, ['Abs-1.0.1.zip'])]);
      analytics.getExtensionsFromInventory.and.resolveTo([
        { name: 'Abs', build_information: { version: '1.0.0' } } as never
      ]);
      await toRelease();
      component.next();
      await flush();
      expect(component.replaceNote()).toContain('"Abs" (version 1.0.0) will be replaced');
      component.next();
      await flush();
      expect(repositories.deployReleaseAsset.calls.mostRecent().args[4]).toBeTrue();
    });

    it('does not replace anything when the extension is new', async () => {
      await toReview();
      await flush();
      expect(component.replaceNote()).toBe('');
      component.next();
      await flush();
      expect(repositories.deployReleaseAsset.calls.mostRecent().args[4]).toBeFalse();
    });

    it('deploys through the backend and reports success without restarting', async () => {
      await toReview();
      component.next(); // result
      await flush();
      expect(repositories.deployReleaseAsset).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: 'a' }),
        jasmine.objectContaining({ name: 'b.zip' }),
        'v2',
        false,
        false
      );
      expect(component.result()).toBe('done');
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('"b.zip"'));
    });

    it('passes the service warning on to the user', async () => {
      repositories.deployReleaseAsset.and.resolveTo({ id: '1', warning: 'old one stays' });
      await toReview();
      component.next();
      await flush();
      expect(alerts.warning).toHaveBeenCalledWith('old one stays');
    });

    it('shows a failed result when the backend refuses (the service already alerted)', async () => {
      repositories.deployReleaseAsset.and.rejectWith(new Error('409'));
      await toReview();
      component.next();
      await flush();
      expect(component.result()).toBe('failed');
      expect(alerts.success).not.toHaveBeenCalled();
    });

    it('needs the download before continuing, and says so', async () => {
      analytics.isBackendServiceAvailable.and.resolveTo(false);
      await toRelease();
      component.next();
      expect(component.step()).toBe('download');
      expect(component.canContinue()).toBeFalse();
      expect(component.blockedReason()).toBe('Download the file to continue.');
      component.downloadAsset();
      expect(component.downloaded()).toBeTrue();
      expect(component.canContinue()).toBeTrue();
      component.next();
      expect(component.step()).toBe('upload');
      expect(repositories.deployReleaseAsset).not.toHaveBeenCalled();
    });

    it('lets users who already have the file skip the download', async () => {
      analytics.isBackendServiceAvailable.and.resolveTo(false);
      await toRelease();
      component.next();
      component.skipDownload();
      expect(component.step()).toBe('upload');
    });

    it('forgets the download when another release is chosen', async () => {
      github.listReleases.and.resolveTo([release(3, ['a.zip', 'b.zip']), release(1, ['c.zip'])]);
      await toRelease();
      component.assetId.set(component.assets()[0].id);
      component.downloadAsset();
      component.chooseRelease(1);
      expect(component.downloaded()).toBeFalse();
    });

    it('shows the reason when the releases cannot be listed', async () => {
      github.listReleases.and.rejectWith({ userMessage: 'Rate limit' });
      await toRelease();
      expect(component.loadError()).toBe('Rate limit');
    });

    it('explains an unparsable repository URL', async () => {
      github.parseOwnerRepo.and.returnValue(null);
      await toRelease();
      expect(component.loadError()).toContain('could not be parsed');
      expect(github.listReleases).not.toHaveBeenCalled();
    });
  });

  describe('the optional restart', () => {
    it('is not a step on any path', async () => {
      analytics.isBackendServiceAvailable.and.resolveTo(false);
      await create();
      for (const source of ['release', 'build', 'upload'] as const) {
        component.chooseSource(source);
        expect(component.steps()).not.toContain('restart' as never);
      }
    });

    it('is never done by the add itself: the service calls ask for no restart', async () => {
      await create();
      component.chooseSource('build');
      component.next();
      component.chooseRepository('a');
      component.next();
      await flush();
      component.toggleItem(component.items()[0], true);
      component.next();
      component.next();
      component.next();
      await flush();
      expect(repositories.createExtensionFromList.calls.mostRecent().args[4]).toBeFalse();
      expect(analytics.restartCepEngine).not.toHaveBeenCalled();
    });

    it('is offered after a finished build', async () => {
      await create();
      component.chooseSource('build');
      component.next();
      component.chooseRepository('a');
      component.next();
      await flush();
      component.toggleItem(component.items()[0], true);
      component.next();
      component.next();
      expect(component.completed()).toBeFalse();
      component.next();
      await flush();
      expect(component.completed()).toBeTrue();
    });

    it('is offered after a finished backend release deployment', async () => {
      await create();
      component.chooseSource('release');
      component.next();
      component.chooseRepository('a');
      component.next();
      await flush();
      component.next();
      component.next();
      await flush();
      expect(component.completed()).toBeTrue();
      expect(repositories.deployReleaseAsset.calls.mostRecent().args[3]).toBeFalse();
    });

    it('is offered after a finished manual upload, which has no step after it', async () => {
      await create('upload');
      expect(component.completed()).toBeFalse();
      component.onUploaded();
      expect(component.completed()).toBeTrue();
    });

    it('is not offered after a failed build', async () => {
      repositories.createExtensionFromList.and.rejectWith(new Error('x'));
      await create();
      component.chooseSource('build');
      component.next();
      component.chooseRepository('a');
      component.next();
      await flush();
      component.toggleItem(component.items()[0], true);
      component.next();
      component.next();
      component.next();
      await flush();
      expect(component.completed()).toBeFalse();
    });

    it('restarts the engine on request', async () => {
      await create('upload');
      component.onUploaded();
      await component.restartNow();
      expect(analytics.restartCepEngine).toHaveBeenCalledTimes(1);
      expect(component.restartState()).toBe('done');
    });

    it('reports a failed restart', async () => {
      analytics.restartCepEngine.and.rejectWith(new Error('down'));
      await create('upload');
      component.onUploaded();
      await component.restartNow();
      expect(component.restartState()).toBe('failed');
    });
  });

  describe('starting from rows ticked in the Block library', () => {
    const start = async (ids: string[], items?: RepositoryItem[]) => {
      if (items) {
        repositories.getRepositoryItemsAnalyzedFor.and.returnValue(of(items));
      }
      const fixture = TestBed.createComponent(ExtensionWizardComponent);
      component = fixture.componentInstance;
      component.initialRepositoryId = 'a';
      component.initialSelectedIds = ids;
      component.ngOnInit();
      await flush();
      await flush();
    };

    it('starts as a build from that repository, at the name step, with the rows chosen', async () => {
      await start(['Good']);
      expect(component.source()).toBe('build');
      expect(component.repositoryId()).toBe('a');
      expect(component.step()).toBe('details');
      expect([...component.selectedIds()]).toEqual(['Good']);
      expect(component.name()).toBe('Good');
    });

    it('can go back to change the content', async () => {
      await start(['Good']);
      component.back();
      expect(component.step()).toBe('content');
      expect(component.selectedIds().size).toBe(1);
    });

    it('leaves out what cannot be built and stays on the content step to show it', async () => {
      await start(['Good', 'Installed']);
      expect(component.step()).toBe('content');
      expect([...component.selectedIds()]).toEqual(['Good']);
    });

    it('stays on the content step when nothing ticked can be built', async () => {
      await start(['Installed']);
      expect(component.step()).toBe('content');
      expect(component.selectedIds().size).toBe(0);
    });

    it('does not choose two rows that define the same block', async () => {
      await start(
        ['A', 'B'],
        [item('A', { blockIds: ['x.Block'] }), item('B', { blockIds: ['x.Block'] })]
      );
      expect([...component.selectedIds()]).toEqual(['A']);
      expect(component.step()).toBe('content');
    });

    it('builds the ticked row like any other selection', async () => {
      await start(['Good']);
      component.next();
      component.next();
      await flush();
      expect(repositories.createExtensionFromList).toHaveBeenCalled();
      expect(component.result()).toBe('done');
    });
  });

  describe('selecting the downloaded file', () => {
    it('hands the file from the Downloads dialog to the upload', async () => {
      const file = new File(['x'], 'b.zip');
      await create();
      const spy = jasmine.createSpy('pick').and.resolveTo(file);
      component.pickDownloadedFile = spy;
      const onFile = jasmine.createSpy('onFile').and.resolveTo();
      spyOn(component as never, 'extensionAdd' as never).and.returnValue({ onFile } as never);

      await component.selectDownloadedFile();

      expect(spy).toHaveBeenCalled();
      expect(onFile).toHaveBeenCalledOnceWith(file);
    });

    it('does nothing when the dialog is closed without a choice', async () => {
      await create();
      component.pickDownloadedFile = () => Promise.resolve(null);
      const onFile = jasmine.createSpy('onFile');
      spyOn(component as never, 'extensionAdd' as never).and.returnValue({ onFile } as never);
      await component.selectDownloadedFile();
      expect(onFile).not.toHaveBeenCalled();
    });

    it('survives a browser that cannot open the dialog', async () => {
      await create();
      component.pickDownloadedFile = () => Promise.reject(new Error('no dialog'));
      await expectAsync(component.selectDownloadedFile()).toBeResolved();
    });
  });

  describe('closing', () => {
    it('keeps the wizard open after an upload until Done is pressed', async () => {
      await create('upload');
      component.onUploaded();
      expect(component.uploaded()).toBeTrue();
      expect(drawer.close).not.toHaveBeenCalled();
    });

    it('closes the drawer and remembers whether an extension was added', async () => {
      await create();
      component.finish(true);
      expect(drawer.close).toHaveBeenCalledTimes(1);
      expect(component.added).toBeTrue();
      component.finish(false);
      expect(component.added).toBeFalse();
    });
  });
});
