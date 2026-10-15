import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { AlertService } from '@c8y/ngx-components';
import { BsModalService } from 'ngx-bootstrap/modal';
import { BehaviorSubject, firstValueFrom, of, Subject, throwError } from 'rxjs';
import { Repository, RepositoryItem, RepositoryService } from '../../shared';
import { EditorModalComponent } from '../editor/editor-modal.component';
import { ExtensionCreateModalComponent } from '../create-extension/extension-create-modal.component';
import { RepositoryBlockGridComponent } from './repository-block-grid.component';

const item = (over: Partial<RepositoryItem>): RepositoryItem =>
  ({ id: 'x', name: 'X', file: 'X.mon', type: 'file', url: 'u', downloadUrl: 'd', repositoryId: 'r1', repositoryName: 'R', ...over }) as RepositoryItem;
const repo = (id: string, enabled: boolean): Repository => ({ id, name: id, url: 'u', accessToken: '', enabled }) as Repository;
const flush = () => new Promise<void>(resolve => setTimeout(resolve));

describe('RepositoryBlockGridComponent', () => {
  let component: RepositoryBlockGridComponent;
  let repositories: jasmine.SpyObj<RepositoryService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let modals: jasmine.SpyObj<BsModalService>;
  let repos$: BehaviorSubject<Repository[]>;
  let modalClose$: Subject<void>;
  let modalHide: jasmine.Spy;
  let dataGrid: { setItemsSelected: jasmine.Spy; cancel: jasmine.Spy };

  const create = async (expertMode = false) => {
    repositories.getExpertMode.and.resolveTo(expertMode);
    component = TestBed.createComponent(RepositoryBlockGridComponent).componentInstance;
    component.dataGrid = dataGrid as never;
    component.ngOnInit();
    await flush();
    return component;
  };

  beforeEach(() => {
    repos$ = new BehaviorSubject<Repository[]>([repo('a', false), repo('b', true)]);
    repositories = jasmine.createSpyObj('RepositoryService', [
      'getRepositories', 'getRepositoryItemsAnalyzed', 'getRepositoryItemContent', 'getExpertMode', 'setExpertMode',
      'reload', 'reloadAll', 'updateHideInstalledFilter'
    ]);
    repositories.getRepositories.and.returnValue(repos$);
    repositories.getRepositoryItemsAnalyzed.and.returnValue(of([]));
    repositories.setExpertMode.and.resolveTo();
    repositories.reloadAll.and.resolveTo();
    alerts = jasmine.createSpyObj('AlertService', ['danger', 'warning']);
    modalClose$ = new Subject<void>();
    modalHide = jasmine.createSpy('hide');
    modals = jasmine.createSpyObj('BsModalService', ['show']);
    modals.show.and.returnValue({ content: { closeSubject: modalClose$ }, hide: modalHide } as never);
    dataGrid = { setItemsSelected: jasmine.createSpy('setItemsSelected'), cancel: jasmine.createSpy('cancel') };
    TestBed.configureTestingModule({
      imports: [RepositoryBlockGridComponent],
      providers: [
        { provide: RepositoryService, useValue: repositories },
        { provide: AlertService, useValue: alerts },
        { provide: BsModalService, useValue: modals }
      ]
    });
    TestBed.overrideComponent(RepositoryBlockGridComponent, { set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] } });
    spyOn(console, 'error');
  });

  describe('expert mode (loading items is opt-in)', () => {
    it('loads nothing while expert mode is off', async () => {
      await create(false);
      expect(repositories.getRepositoryItemsAnalyzed).not.toHaveBeenCalled();
      expect(component.repositoryItems).toEqual([]);
      expect(component.expertMode).toBeFalse();
    });

    it('restores the persisted expert mode and then loads the items', async () => {
      repositories.getRepositoryItemsAnalyzed.and.returnValue(of([item({ id: '1' })]));
      await create(true);
      expect(component.expertMode).toBeTrue();
      expect(component.repositoryItems.map(i => i.id)).toEqual(['1']);
    });

    it('starts loading as soon as the user switches it on, and persists the choice', async () => {
      repositories.getRepositoryItemsAnalyzed.and.returnValue(of([item({ id: '1' })]));
      await create(false);
      component.expertMode = true;
      await component.updateMode();
      expect(component.repositoryItems.map(i => i.id)).toEqual(['1']);
      expect(repositories.setExpertMode).toHaveBeenCalledWith(true);
    });

    it('keeps the in-memory switch when persisting fails', async () => {
      repositories.setExpertMode.and.rejectWith(new Error('denied'));
      await create(false);
      component.expertMode = true;
      await expectAsync(component.updateMode()).toBeResolved();
      expect(repositories.getRepositoryItemsAnalyzed).toHaveBeenCalled();
    });

    it('selects whole items instead of single ones and updates the title', async () => {
      repositories.getRepositoryItemsAnalyzed.and.returnValue(of([item({ file: 'extensions.yaml' })]));
      await create(true);
      expect(component.titleSample).toContain('contains extensions.yaml');
      expect(component.singleSelection).toBeFalse();
    });
  });

  it('tracks the enabled repository as the active one, and an empty one when none is enabled', async () => {
    await create();
    expect(component.activeRepository.id).toBe('b');
    repos$.next([repo('a', false)]);
    expect(component.activeRepository).toEqual({} as Repository);
  });

  it('offers a bulk "Create extension" action and a "View Source" action for files only', async () => {
    await create();
    expect(component.bulkActionControls.map(a => a.text)).toEqual(['Create extension']);
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

      const [type, options] = modals.show.calls.mostRecent().args as [unknown, { initialState: { source$: any; monitorName: string } }];
      expect(type).toBe(EditorModalComponent);
      expect(options.initialState.monitorName).toBe('Foo');
      expect(await firstValueFrom(options.initialState.source$)).toBe('package a;');
    });

    it('alerts and shows an empty editor when the content cannot be loaded', async () => {
      repositories.getRepositoryItemContent.and.returnValue(throwError(() => new Error('403')));
      await create();
      component.viewMonitor(item({ name: 'Foo' }));
      const [, options] = modals.show.calls.mostRecent().args as [unknown, { initialState: { source$: any } }];
      expect(await firstValueFrom(options.initialState.source$)).toBe('');
      expect(alerts.danger).toHaveBeenCalledWith(jasmine.stringContaining('"Foo"'));
    });
  });

  describe('checkSelection', () => {
    beforeEach(async () => {
      await create();
      component.repositoryItems = [
        item({ id: '1', name: 'Good', file: 'Good.mon' }),
        item({ id: '2', name: 'Installed', file: 'Inst.mon', installed: true }),
        item({ id: '3', name: 'Readme', file: 'README.md' }),
        item({ id: '4', name: 'sub', file: 'sub', type: 'dir' }),
        item({ id: '5', name: 'extensions', file: 'extensions.yaml' })
      ];
    });

    it('accepts .mon files, directories and extensions.yaml', fakeAsync(() => {
      component.checkSelection(['1', '4', '5']);
      tick();
      expect(dataGrid.setItemsSelected).not.toHaveBeenCalled();
      expect(alerts.warning).not.toHaveBeenCalled();
    }));

    it('refuses to select an already installed block, naming it', fakeAsync(() => {
      component.checkSelection(['2']);
      expect(alerts.warning).toHaveBeenCalledWith(jasmine.stringContaining('Block Installed is already installed'));
      tick();
      expect(dataGrid.setItemsSelected).toHaveBeenCalledOnceWith([component.repositoryItems[1]], false);
    }));

    it('deselects files of other types and explains what is allowed', fakeAsync(() => {
      component.checkSelection(['1', '3']);
      tick();
      expect(dataGrid.setItemsSelected).toHaveBeenCalledOnceWith([component.repositoryItems[2]], false);
      expect(alerts.warning).toHaveBeenCalledWith(jasmine.stringContaining("'extensions.yaml'"));
    }));

    it('ignores items that are not part of the selection', fakeAsync(() => {
      component.checkSelection([]);
      tick();
      expect(dataGrid.setItemsSelected).not.toHaveBeenCalled();
    }));
  });

  describe('createExtension', () => {
    const opened = () => modals.show.calls.mostRecent().args as [unknown, { initialState: Record<string, any> }];

    beforeEach(async () => {
      await create();
      component.repositoryItems = [
        item({ id: '1', name: 'A', file: 'A.mon' }),
        item({ id: '2', name: 'B', file: 'B.mon' }),
        item({ id: '3', name: 'Done', file: 'Done.mon', installed: true })
      ];
    });

    it('opens the create dialog for the selected, not yet installed files', async () => {
      await component.createExtension(['1', '3', '2']);
      const [type, options] = opened();
      expect(type).toBe(ExtensionCreateModalComponent);
      expect(options.initialState['monitors'].map((m: RepositoryItem) => m.name)).toEqual(['A', 'B']);
      expect(options.initialState['sections']).toBeUndefined();
      expect(options.initialState['activeRepository'].id).toBe('b');
    });

    it('passes the yaml item once and the chosen section names for yaml sections', async () => {
      const yaml = item({ id: 'y', name: 'extensions', file: 'extensions.yaml' });
      component.repositoryItems = [
        item({ id: 's1', name: 'Python', extensionsYamlItem: yaml }),
        item({ id: 's2', name: 'Offset', extensionsYamlItem: yaml })
      ];
      await component.createExtension(['s1', 's2']);
      const [, { initialState }] = opened();
      expect(initialState['sections']).toEqual(['Python', 'Offset']);
      expect(initialState['monitors']).toEqual([yaml]);
    });

    it('clears the selection and closes the dialog when it reports back', async () => {
      await component.createExtension(['1']);
      modalClose$.next();
      expect(dataGrid.cancel).toHaveBeenCalled();
      expect(modalHide).toHaveBeenCalled();
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

    it('opens the release wizard, and reloads after a completed deployment only', () => {
      component.deployFromRelease();
      expect(component.showDeployRelease).toBeTrue();
      component.onDeployReleaseCancel();
      expect(component.showDeployRelease).toBeFalse();
      expect(repositories.reload).not.toHaveBeenCalled();

      component.deployFromRelease();
      component.onDeployReleaseCommit();
      expect(component.showDeployRelease).toBeFalse();
      expect(repositories.reload).toHaveBeenCalled();
    });

    it('shows the layout help and closes it on request', () => {
      component.openLayoutHelp();
      modalClose$.next();
      expect(modalHide).toHaveBeenCalled();
    });
  });
});
