import { TestBed } from '@angular/core/testing';
import { AlertService } from '@c8y/ngx-components';
import { BsModalService } from 'ngx-bootstrap/modal';
import { BehaviorSubject, firstValueFrom, of, Subject, throwError } from 'rxjs';
import { AnalyticsService, Repository, RepositoryItem, RepositoryService } from '../../shared';
import { EditorModalComponent } from '../editor/editor-modal.component';
import { ExtensionWizardService } from '../wizard/extension-wizard.service';
import { RepositoryBlockGridComponent } from './repository-block-grid.component';

const item = (over: Partial<RepositoryItem>): RepositoryItem =>
  ({
    id: 'x',
    name: 'X',
    file: 'X.mon',
    type: 'file',
    url: 'u',
    downloadUrl: 'd',
    repositoryId: 'r1',
    repositoryName: 'R',
    ...over
  }) as RepositoryItem;
const repo = (id: string): Repository => ({ id, name: id, url: 'u', accessToken: '' });
const flush = () => new Promise<void>(resolve => setTimeout(resolve));

describe('RepositoryBlockGridComponent', () => {
  let component: RepositoryBlockGridComponent;
  let repositories: jasmine.SpyObj<RepositoryService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let modals: jasmine.SpyObj<BsModalService>;
  let repos$: BehaviorSubject<Repository[]>;
  let modalClose$: Subject<void>;
  let modalHide: jasmine.Spy;
  let wizard: jasmine.SpyObj<ExtensionWizardService>;

  const create = async () => {
    component = TestBed.createComponent(RepositoryBlockGridComponent).componentInstance;
    component.ngOnInit();
    await flush();
    return component;
  };

  beforeEach(() => {
    repos$ = new BehaviorSubject<Repository[]>([repo('a'), repo('b')]);
    repositories = jasmine.createSpyObj('RepositoryService', [
      'getRepositories',
      'getRepositoryItemsAnalyzedFor',
      'getRepositoryItemContent',
      'reload',
      'reloadAll',
      'updateHideInstalledFilter'
    ]);
    repositories.getRepositories.and.returnValue(repos$);
    repositories.getRepositoryItemsAnalyzedFor.and.returnValue(of([]));
    repositories.reloadAll.and.resolveTo();
    analytics = jasmine.createSpyObj('AnalyticsService', [
      'isBackendServiceDeployed',
      'recheckBackendServiceDeployed'
    ]);
    analytics.isBackendServiceDeployed.and.resolveTo(true);
    alerts = jasmine.createSpyObj('AlertService', ['danger', 'warning', 'success']);
    modalClose$ = new Subject<void>();
    modalHide = jasmine.createSpy('hide');
    modals = jasmine.createSpyObj('BsModalService', ['show']);
    modals.show.and.returnValue({
      content: { closeSubject: modalClose$ },
      hide: modalHide
    } as never);
    wizard = jasmine.createSpyObj('ExtensionWizardService', ['open']);
    TestBed.configureTestingModule({
      imports: [RepositoryBlockGridComponent],
      providers: [
        { provide: RepositoryService, useValue: repositories },
        { provide: AnalyticsService, useValue: analytics },
        { provide: AlertService, useValue: alerts },
        { provide: BsModalService, useValue: modals },
        { provide: ExtensionWizardService, useValue: wizard }
      ]
    });
    TestBed.overrideComponent(RepositoryBlockGridComponent, {
      set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] }
    });
    spyOn(console, 'error');
  });

  describe('backend service status', () => {
    it('reads the deployed state on init', async () => {
      await create();
      expect(component.backendDeployed).toBeTrue();
    });

    it('re-checks whether the backend service is deployed', async () => {
      analytics.isBackendServiceDeployed.and.resolveTo(false);
      analytics.recheckBackendServiceDeployed.and.resolveTo(true);
      await create();
      expect(component.backendDeployed).toBeFalse();
      await component.recheckBackend();
      expect(component.backendDeployed).toBeTrue();
    });
  });

  describe('repository items', () => {
    it('loads the items when the tab opens', async () => {
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(of([item({ id: '1' })]));
      await create();
      expect(component.repositoryItems.map(i => i.id)).toEqual(['1']);
    });

    it('browses the first repository by default', async () => {
      await create();
      expect(component.selectedRepositoryId).toBe('a');
      expect(repositories.getRepositoryItemsAnalyzedFor).toHaveBeenCalledWith('a');
      expect(component.repositories.map(r => r.id)).toEqual(['a', 'b']);
    });

    it('loads the items of the repository the user picks', async () => {
      await create();
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(of([item({ id: 'x' })]));
      component.selectRepository('b');
      await flush();
      expect(repositories.getRepositoryItemsAnalyzedFor).toHaveBeenCalledWith('b');
      expect(component.repositoryItems.map(i => i.id)).toEqual(['x']);
    });

    it('falls back to another repository when the chosen one is removed', async () => {
      await create();
      repos$.next([repo('a')]);
      expect(component.selectedRepositoryId).toBe('a');
      repos$.next([]);
      expect(component.selectedRepositoryId).toBeNull();
    });

    it('hides installed items on request without another request', async () => {
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(
        of([item({ id: '1' }), item({ id: '2', installed: true })])
      );
      await create();
      expect(component.repositoryItems.length).toBe(2);
      component.hideInstalled = true;
      await component.updateFilter();
      await flush();
      expect(component.repositoryItems.map(i => i.id)).toEqual(['1']);
    });

    it('draws the repository name as a badge, escaping quotes and backslashes', async () => {
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(
        of([item({ repositoryName: 'My "repo" \\ x' })])
      );
      await create();
      expect(component.repositoryBadge).toBe('"My \\"repo\\" \\\\ x"');
    });

    it('names the repository for a yaml listing', async () => {
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(
        of([item({ file: 'extensions.yaml' })])
      );
      await create();
      expect(component.titleRepository).toBe('R');
    });

    it('shows no repository badge when the items come from several repositories', async () => {
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(
        of([item({ repositoryName: 'A' }), item({ id: 'y', repositoryName: 'B' })])
      );
      await create();
      expect(component.titleRepository).toBeNull();
      expect(component.repositoryBadge).toBeNull();
      expect(component.gridTitle).toBe('Browse blocks from repositories');
    });

    it('names the repository for a plain file listing', async () => {
      repositories.getRepositoryItemsAnalyzedFor.and.returnValue(of([item({ file: 'A.mon' })]));
      await create();
      expect(component.titleRepository).toBe('R');
    });
  });

  it('gives the data grid a pagination, which it cannot render rows without', () => {
    expect(component.pagination).toEqual({ pageSize: 25, currentPage: 1 });
  });

  it('offers a "View Source" action for files only', async () => {
    await create();
    const [view] = component.actionControls;
    expect(view.text).toBe('View Source');
    expect(view.showIf!(item({ type: 'file' }) as never)).toBeTrue();
    expect(view.showIf!(item({ type: 'dir' }) as never)).toBeFalse();
  });

  describe('viewMonitor', () => {
    it('opens the editor with the file content', async () => {
      repositories.getRepositoryItemContent.and.returnValue(of('package a;'));
      await create();
      component.viewMonitor(item({ name: 'Foo' }));

      const [type, options] = modals.show.calls.mostRecent().args as [
        unknown,
        { initialState: { source$: any; monitorName: string } }
      ];
      expect(type).toBe(EditorModalComponent);
      expect(options.initialState.monitorName).toBe('Foo');
      expect(await firstValueFrom(options.initialState.source$)).toBe('package a;');
    });

    it('alerts and shows an empty editor when the content cannot be loaded', async () => {
      repositories.getRepositoryItemContent.and.returnValue(throwError(() => new Error('403')));
      await create();
      component.viewMonitor(item({ name: 'Foo' }));
      const [, options] = modals.show.calls.mostRecent().args as [
        unknown,
        { initialState: { source$: any } }
      ];
      expect(await firstValueFrom(options.initialState.source$)).toBe('');
      expect(alerts.danger).toHaveBeenCalledWith(jasmine.stringContaining('"Foo"'));
    });
  });

  describe('reloading and filtering', () => {
    beforeEach(async () => create());

    it('reload only clears the cache', () => {
      component.reload();
      expect(repositories.reload).toHaveBeenCalled();
    });

    it('reloadAll shows the loading state and always leaves it', async () => {
      const pending = component.reloadAll();
      expect(component.loading).toBeTrue();
      await pending;
      expect(component.loading).toBeFalse();
    });

    it('reloadAll swallows errors (the service already alerted)', async () => {
      repositories.reloadAll.and.rejectWith(new Error('x'));
      await expectAsync(component.reloadAll()).toBeResolved();
      expect(component.loading).toBeFalse();
    });

    it('updateFilter hands the "hide installed" flag to the service', async () => {
      component.hideInstalled = true;
      await component.updateFilter();
      expect(repositories.updateHideInstalledFilter).toHaveBeenCalledWith(true);
    });
  });

  describe('panels and dialogs', () => {
    beforeEach(async () => create());

    it('opens and closes the repositories drawer', () => {
      component.openRepositoriesDrawer();
      expect(component.showConfigRepositories).toBeTrue();
      component.onRepositoryCancel();
      expect(component.showConfigRepositories).toBeFalse();
      component.openRepositoriesDrawer();
      component.onRepositoryCommit();
      expect(component.showConfigRepositories).toBeFalse();
    });

    it('starts the wizard with the ticked rows of the shown repository', async () => {
      await create();
      wizard.open.and.returnValue(new Subject<boolean>());
      component.onItemsSelect(['A', 'B']);
      component.addExtension();
      expect(wizard.open).toHaveBeenCalledWith({ repositoryId: 'a', selectedIds: ['A', 'B'] });
    });

    it('starts the plain wizard when nothing is ticked', async () => {
      await create();
      wizard.open.and.returnValue(new Subject<boolean>());
      component.addExtension();
      expect(wizard.open).toHaveBeenCalledWith(undefined);
    });

    it('forgets the ticked rows when another repository is shown, and after an extension was added', async () => {
      await create();
      component.onItemsSelect(['A']);
      component.selectRepository('b');
      expect(component.selectedItemIds).toEqual([]);

      const closed = new Subject<boolean>();
      wizard.open.and.returnValue(closed);
      component.onItemsSelect(['B']);
      component.addExtension();
      closed.next(true);
      expect(component.selectedItemIds).toEqual([]);
    });

    it('opens the add-extension wizard and reloads the items only when one was added', () => {
      const closed = new Subject<boolean>();
      wizard.open.and.returnValue(closed);
      component.addExtension();
      closed.next(false);
      expect(repositories.reload).not.toHaveBeenCalled();
      closed.next(true);
      expect(repositories.reload).toHaveBeenCalled();
    });

    it('shows the layout help and closes it on request', () => {
      component.openLayoutHelp();
      modalClose$.next();
      expect(modalHide).toHaveBeenCalled();
    });
  });
});
