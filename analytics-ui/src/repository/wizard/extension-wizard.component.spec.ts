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

const repo = (id: string, enabled = true): Repository =>
  ({
    id,
    name: `Repo ${id}`,
    url: 'https://github.com/o/r',
    accessToken: '',
    enabled
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
      new BehaviorSubject<Repository[]>([repo('a'), repo('off', false)])
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
      'uploadExtension'
    ]);
    analytics.isBackendServiceAvailable.and.resolveTo(true);
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
        true
      );
      expect(component.result()).toBe('done');
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('"MyExt.zip"'));
    });

    it('uses the no-restart message when the restart option is off', async () => {
      await toContent();
      component.toggleItem(component.items()[0], true);
      component.next();
      component.restart.set(false);
      component.next();
      component.next();
      await flush();
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('next Apama restart'));
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
        true
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

    it('deploys through the backend and reports success, restarting by default', async () => {
      await toReview();
      component.next(); // result
      await flush();
      expect(repositories.deployReleaseAsset).toHaveBeenCalledWith(
        jasmine.objectContaining({ id: 'a' }),
        jasmine.objectContaining({ name: 'b.zip' }),
        'v2',
        true
      );
      expect(component.result()).toBe('done');
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('"b.zip"'));
    });

    it('does not restart when the option is off', async () => {
      await toReview();
      component.restart.set(false);
      component.next();
      await flush();
      expect(repositories.deployReleaseAsset.calls.mostRecent().args[3]).toBeFalse();
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('next Apama restart'));
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

    it('lets the user continue from the download step without forcing the click', async () => {
      analytics.isBackendServiceAvailable.and.resolveTo(false);
      await toRelease();
      component.next();
      expect(component.step()).toBe('download');
      expect(component.canContinue()).toBeTrue();
      component.next();
      expect(component.step()).toBe('upload');
      expect(repositories.deployReleaseAsset).not.toHaveBeenCalled();
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
