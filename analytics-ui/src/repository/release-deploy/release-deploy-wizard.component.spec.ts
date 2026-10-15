import { TestBed } from '@angular/core/testing';
import { IManagedObject } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { BehaviorSubject } from 'rxjs';
import { AnalyticsService, FetchExtensionService, GitHubRelease, GitHubReleaseAsset, GitHubReleaseService, Repository, RepositoryService } from '../../shared';
import { ReleaseDeployWizardComponent } from './release-deploy-wizard.component';

const repo = (id: string, enabled = false): Repository => ({ id, name: `Repo ${id}`, url: `https://github.com/o/${id}`, accessToken: '_DUMMY_ACCESS_CODE_', enabled }) as Repository;
const asset = (name: string): GitHubReleaseAsset => ({ id: 1, name, size: 10, browserDownloadUrl: `https://dl/${name}`, contentType: 'application/zip' }) as GitHubReleaseAsset;
const release = (tag: string, ...assets: string[]): GitHubRelease => ({ id: 1, tagName: tag, name: tag, publishedAt: '', assets: assets.map(asset) }) as GitHubRelease;
const flush = () => new Promise<void>(resolve => setTimeout(resolve));

describe('ReleaseDeployWizardComponent', () => {
  let component: ReleaseDeployWizardComponent;
  let repositories: jasmine.SpyObj<RepositoryService>;
  let github: jasmine.SpyObj<GitHubReleaseService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let fetchExtension: jasmine.SpyObj<FetchExtensionService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let repos$: BehaviorSubject<Repository[]>;

  const create = async (repos: Repository[] = [repo('a'), repo('b', true)]) => {
    repos$.next(repos);
    component = TestBed.createComponent(ReleaseDeployWizardComponent).componentInstance;
    component.ngOnInit();
    await flush();
  };

  beforeEach(() => {
    repos$ = new BehaviorSubject<Repository[]>([]);
    repositories = jasmine.createSpyObj('RepositoryService', ['getRepositories', 'getRepositoryAccessToken']);
    repositories.getRepositories.and.returnValue(repos$);
    repositories.getRepositoryAccessToken.and.resolveTo('tok');
    github = jasmine.createSpyObj('GitHubReleaseService', ['parseOwnerRepo', 'listReleases']);
    github.parseOwnerRepo.and.callFake((r: Repository) => ({ owner: 'o', repo: r.id }));
    github.listReleases.and.resolveTo([release('1.0.1', 'A.zip', 'readme.md'), release('1.0.0', 'B.zip')]);
    analytics = jasmine.createSpyObj('AnalyticsService', ['uploadExtension']);
    fetchExtension = jasmine.createSpyObj('FetchExtensionService', ['sendFetchExtensionEvent']);
    fetchExtension.sendFetchExtensionEvent.and.resolveTo({ requestId: 'req-1', url: '', name: '' });
    alerts = jasmine.createSpyObj('AlertService', ['info']);
    TestBed.configureTestingModule({
      imports: [ReleaseDeployWizardComponent],
      providers: [
        { provide: RepositoryService, useValue: repositories },
        { provide: GitHubReleaseService, useValue: github },
        { provide: AnalyticsService, useValue: analytics },
        { provide: FetchExtensionService, useValue: fetchExtension },
        { provide: AlertService, useValue: alerts }
      ]
    });
    TestBed.overrideComponent(ReleaseDeployWizardComponent, { set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] } });
  });

  describe('repository and release selection', () => {
    it('preselects the enabled repository (else the first) and its newest release', async () => {
      await create();
      expect(component.selectedRepository?.id).toBe('b');
      expect(github.listReleases).toHaveBeenCalledWith('o', 'b', 'tok');
      expect(component.selectedRelease?.tagName).toBe('1.0.1');
      expect(component.loading).toBeFalse();
    });

    it('falls back to the first repository when none is enabled', async () => {
      await create([repo('a'), repo('b')]);
      expect(component.selectedRepository?.id).toBe('a');
    });

    it('fetches the real token separately, because the stored one is masked', async () => {
      await create();
      expect(repositories.getRepositoryAccessToken).toHaveBeenCalledWith('b');
    });

    it('does not change an existing selection when the repository list updates', async () => {
      await create();
      repos$.next([repo('c', true)]);
      await flush();
      expect(component.selectedRepository?.id).toBe('b');
    });

    it('resets everything when the repository changes or is cleared', async () => {
      await create();
      component.selectedAsset = asset('A.zip');
      await component.onRepositorySelected(null);
      expect(component.releases).toEqual([]);
      expect(component.selectedRelease).toBeNull();
      expect(component.selectedAsset).toBeNull();
      expect(component.errorMessage).toBeNull();
    });

    it('reports an unparsable repository url and loads nothing', async () => {
      github.parseOwnerRepo.and.returnValue(null);
      await create();
      expect(component.errorMessage).toContain('could not be parsed');
      expect(github.listReleases).not.toHaveBeenCalled();
    });

    it('shows the user message when listing releases fails, and stops loading', async () => {
      github.listReleases.and.rejectWith({ userMessage: 'GitHub rate limit exceeded' });
      await create();
      expect(component.errorMessage).toBe('GitHub rate limit exceeded');
      expect(component.loading).toBeFalse();
    });

    it('falls back to a generic message for unexpected errors', async () => {
      github.listReleases.and.rejectWith(new Error('x'));
      await create();
      expect(component.errorMessage).toBe('Failed to list releases.');
    });

    it('deselects the asset when another release is chosen', async () => {
      await create();
      component.selectedAsset = asset('A.zip');
      component.onReleaseSelected(component.releases[1]);
      expect(component.selectedAsset).toBeNull();
      expect(component.selectedRelease?.tagName).toBe('1.0.0');
    });
  });

  it('offers only .zip assets (case-insensitive) of the selected release', async () => {
    await create();
    component.selectedRelease = release('x', 'A.zip', 'B.ZIP', 'notes.md', 'c.zip.sig');
    expect(component.assets.map(a => a.name)).toEqual(['A.zip', 'B.ZIP']);
    component.selectedRelease = null;
    expect(component.assets).toEqual([]);
  });

  describe('download and continue', () => {
    it('does nothing without a selected asset', async () => {
      await create();
      const click = spyOn(HTMLAnchorElement.prototype, 'click');
      component.downloadAndContinue();
      expect(click).not.toHaveBeenCalled();
      expect(component.phase).toBe('select');
    });

    it('downloads the asset, tells the user what to do next and moves on to the upload step', async () => {
      await create();
      const downloads: string[] = [];
      spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) { downloads.push(`${this.href}|${this.download}`); });
      component.selectedAsset = asset('A.zip');
      component.downloadAndContinue();
      expect(downloads).toEqual(['https://dl/A.zip|A.zip']);
      expect(alerts.info).toHaveBeenCalledWith(jasmine.stringContaining('A.zip'));
      expect(component.phase).toBe('upload');
    });
  });

  describe('experimental fetch event', () => {
    it('does nothing without a selected asset', async () => {
      await create();
      await component.sendFetchExtensionEvent();
      expect(fetchExtension.sendFetchExtensionEvent).not.toHaveBeenCalled();
    });

    it('sends the event with the real access token and reports the request id', async () => {
      await create();
      component.selectedAsset = asset('A.zip');
      await component.sendFetchExtensionEvent();
      expect(fetchExtension.sendFetchExtensionEvent).toHaveBeenCalledWith('https://dl/A.zip', 'A.zip', 'tok');
      expect(alerts.info).toHaveBeenCalledWith(jasmine.stringContaining('req-1'));
      expect(component.sendingFetchEvent).toBeFalse();
    });

    it('ignores a second click while one is in flight', async () => {
      await create();
      component.selectedAsset = asset('A.zip');
      component.sendingFetchEvent = true;
      await component.sendFetchExtensionEvent();
      expect(fetchExtension.sendFetchExtensionEvent).not.toHaveBeenCalled();
    });

    it('swallows failures (the service already alerted) and re-enables the button', async () => {
      fetchExtension.sendFetchExtensionEvent.and.rejectWith(new Error('proxy missing'));
      await create();
      component.selectedAsset = asset('A.zip');
      await expectAsync(component.sendFetchExtensionEvent()).toBeResolved();
      expect(component.sendingFetchEvent).toBeFalse();
    });
  });

  it('uploads through the analytics service', async () => {
    await create();
    analytics.uploadExtension.and.resolveTo({} as never);
    const file = new File([], 'A.zip');
    const extension = { name: 'A' } as unknown as IManagedObject;
    await component.uploadExtensionHandler(file, extension, 'add');
    expect(analytics.uploadExtension).toHaveBeenCalledWith(file, extension, 'add');
  });

  it('reports cancelling and a completed upload to the host', async () => {
    await create();
    const events: string[] = [];
    component.cancelled.subscribe(() => events.push('cancelled'));
    component.commit.subscribe(() => events.push('commit'));
    component.onCancel();
    component.onUploadCompleted();
    expect(events).toEqual(['cancelled', 'commit']);
  });
});
