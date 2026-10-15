import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { IManagedObject } from '@c8y/client';
import { AlertService, WizardModalService } from '@c8y/ngx-components';
import { BsModalService } from 'ngx-bootstrap/modal';
import { Subject } from 'rxjs';
import { AnalyticsService, RepositoryService } from '../shared';
import { ExtensionCardComponent } from './extension-card.component';

const repo = { id: 'r1', name: 'Repo' };
const ext = (over: Record<string, unknown> = {}) => ({ id: '1', name: 'MyExt', ...over }) as unknown as IManagedObject;
const flush = () => new Promise<void>(resolve => setTimeout(resolve));

describe('ExtensionCardComponent', () => {
  let component: ExtensionCardComponent;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let repositories: jasmine.SpyObj<RepositoryService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let router: jasmine.SpyObj<Router>;
  let modals: jasmine.SpyObj<BsModalService>;
  let wizard: jasmine.SpyObj<WizardModalService>;
  let confirm$: Subject<boolean>;
  let hide: jasmine.Spy;
  let changed: number;

  const create = (extension: IManagedObject) => {
    component = TestBed.createComponent(ExtensionCardComponent).componentInstance;
    component.extension = extension;
    changed = 0;
    component.extensionChanged.subscribe(() => changed++);
    return component;
  };

  beforeEach(() => {
    analytics = jasmine.createSpyObj('AnalyticsService', ['deleteExtension', 'downloadExtension']);
    repositories = jasmine.createSpyObj('RepositoryService', ['createExtensionFromRepository', 'createExtensionFromList', 'createExtensionFromYaml']);
    repositories.createExtensionFromRepository.and.resolveTo({} as never);
    repositories.createExtensionFromList.and.resolveTo({} as never);
    repositories.createExtensionFromYaml.and.resolveTo({} as never);
    alerts = jasmine.createSpyObj('AlertService', ['addServerFailure', 'warning', 'info', 'success', 'danger']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    confirm$ = new Subject<boolean>();
    hide = jasmine.createSpy('hide');
    modals = jasmine.createSpyObj('BsModalService', ['show']);
    modals.show.and.returnValue({ content: { closeSubject: confirm$ }, hide } as never);
    wizard = jasmine.createSpyObj('WizardModalService', ['show']);
    TestBed.configureTestingModule({
      imports: [ExtensionCardComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: RepositoryService, useValue: repositories },
        { provide: AlertService, useValue: alerts },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: {} },
        { provide: BsModalService, useValue: modals },
        { provide: WizardModalService, useValue: wizard }
      ]
    });
    TestBed.overrideComponent(ExtensionCardComponent, { set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] } });
    spyOn(console, 'error');
  });

  describe('build information helpers', () => {
    it('recognizes extensions built by the service (repository, list, yaml)', () => {
      for (const type of ['repository', 'list', 'yaml']) {
        expect(create(ext({ build_information: { build_type: type } })).isBuildInternally()).toBeTrue();
      }
    });

    it('does not treat externally built extensions or those without information as internal', () => {
      expect(create(ext({ build_information: { build_type: 'external' } })).isBuildInternally()).toBeFalse();
      expect(create(ext()).isBuildInternally()).toBeFalsy();
    });

    it('reports build information presence and type', () => {
      expect(create(ext()).hasBuildInformation()).toBeFalsy();
      const withInfo = create(ext({ build_information: { build_type: 'yaml' } }));
      expect(withInfo.hasBuildInformation()).toBeTruthy();
      expect(withInfo.getBuildType()).toBe('yaml');
      expect(create(ext()).getBuildType()).toBe('Unknown');
    });
  });

  it('detail() navigates to the details page relative to the current route, handing over the extension', async () => {
    const extension = ext();
    await create(extension).detail();
    const [commands, options] = router.navigate.calls.mostRecent().args;
    expect(commands).toEqual(['details', 'MyExt']);
    expect((options as { state: { extension: unknown } }).state.extension).toBe(extension);
  });

  describe('delete', () => {
    it('asks for confirmation naming the extension', async () => {
      await create(ext()).delete();
      const [, options] = modals.show.calls.mostRecent().args as [unknown, { initialState: { message: string } }];
      expect(options.initialState.message).toContain('"MyExt"');
    });

    it('deletes after confirmation, announces the change and closes the dialog', async () => {
      analytics.deleteExtension.and.resolveTo({} as never);
      const extension = ext();
      await create(extension).delete();
      confirm$.next(true);
      await flush();
      expect(analytics.deleteExtension).toHaveBeenCalledWith(extension, true);
      expect(changed).toBe(1);
      expect(hide).toHaveBeenCalled();
    });

    it('does nothing when the user declines', async () => {
      await create(ext()).delete();
      confirm$.next(false);
      await flush();
      expect(analytics.deleteExtension).not.toHaveBeenCalled();
      expect(changed).toBe(0);
      expect(hide).toHaveBeenCalled();
    });

    it('shows the server failure and does not announce a change when deleting fails', async () => {
      const failure = new Error('403');
      analytics.deleteExtension.and.rejectWith(failure);
      await create(ext()).delete();
      confirm$.next(true);
      await flush();
      expect(alerts.addServerFailure).toHaveBeenCalledWith(failure);
      expect(changed).toBe(0);
    });
  });

  describe('download', () => {
    it('saves the binary as <name>.zip', async () => {
      analytics.downloadExtension.and.resolveTo(new ArrayBuffer(4));
      const saved: string[] = [];
      spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
      // file-saver triggers the download by dispatching a click event on a temporary anchor
      spyOn(EventTarget.prototype, 'dispatchEvent').and.callFake(function (this: EventTarget) {
        if (this instanceof HTMLAnchorElement) saved.push(this.download);
        return true;
      });
      await create(ext()).download();
      await new Promise(resolve => setTimeout(resolve, 50)); // file-saver clicks asynchronously
      expect(saved).toEqual(['MyExt.zip']);
    });

    it('shows the server failure when the download fails', async () => {
      const failure = new Error('404');
      analytics.downloadExtension.and.rejectWith(failure);
      await create(ext()).download();
      expect(alerts.addServerFailure).toHaveBeenCalledWith(failure);
    });
  });

  describe('update', () => {
    it('opens the upload wizard in update mode with the extension to replace and refreshes when it closes', async () => {
      const onClose = new Subject<void>();
      wizard.show.and.returnValue({ content: { onClose } } as never);
      const extension = ext();
      await create(extension).update();

      const [options] = wizard.show.calls.mostRecent().args as [{ initialState: Record<string, any> }];
      expect(options.initialState['id']).toBe('uploadAnalyticsExtension');
      expect(options.initialState['componentInitialState']).toEqual(jasmine.objectContaining({ mode: 'update', extensionToReplace: extension }));
      expect(changed).toBe(0);
      onClose.next();
      expect(changed).toBe(1);
    });

    it('tolerates a wizard without content', async () => {
      wizard.show.and.returnValue({} as never);
      await expectAsync(create(ext()).update()).toBeResolved();
    });
  });

  describe('rebuild', () => {
    const rebuildable = (buildInformation: Record<string, unknown>) => create(ext({ build_information: { repository: repo, ...buildInformation } }));
    const confirmRebuild = async (component: ExtensionCardComponent, answer = true) => {
      await component.rebuild();
      confirm$.next(answer);
      await flush();
    };

    it('warns and does nothing without build information', async () => {
      await create(ext()).rebuild();
      expect(alerts.warning).toHaveBeenCalledWith(jasmine.stringContaining('No build information'));
      expect(modals.show).not.toHaveBeenCalled();
    });

    it('warns and does nothing when the repository is unknown', async () => {
      await create(ext({ build_information: { build_type: 'repository' } })).rebuild();
      expect(alerts.warning).toHaveBeenCalledWith(jasmine.stringContaining('Repository information'));
      expect(modals.show).not.toHaveBeenCalled();
    });

    it('asks for confirmation naming extension and repository, and does nothing when declined', async () => {
      const component = rebuildable({ build_type: 'repository' });
      await confirmRebuild(component, false);
      const [, options] = modals.show.calls.mostRecent().args as [unknown, { initialState: { message: string } }];
      expect(options.initialState.message).toContain('"MyExt"');
      expect(options.initialState.message).toContain('"Repo"');
      expect(repositories.createExtensionFromRepository).not.toHaveBeenCalled();
    });

    it('rebuilds a repository build with upload, deploy and rebuild flags', async () => {
      const component = rebuildable({ build_type: 'repository' });
      await confirmRebuild(component);
      expect(repositories.createExtensionFromRepository).toHaveBeenCalledWith('MyExt', repo as never, true, true, true);
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('rebuilt successfully'));
      expect(changed).toBe(1);
    });

    it('rebuilds a list build from the stored monitors', async () => {
      const monitors = [{ name: 'A' }];
      await confirmRebuild(rebuildable({ build_type: 'list', monitors }));
      expect(repositories.createExtensionFromList).toHaveBeenCalledWith('MyExt', monitors as never, repo as never, true, true, true);
    });

    it('rejects a list build without stored monitors', async () => {
      await confirmRebuild(rebuildable({ build_type: 'list', monitors: [] }));
      expect(alerts.addServerFailure).toHaveBeenCalled();
      expect(repositories.createExtensionFromList).not.toHaveBeenCalled();
      expect(changed).toBe(0);
    });

    it('rebuilds a yaml build for just its section', async () => {
      const yaml = { url: 'u' };
      await confirmRebuild(rebuildable({ build_type: 'yaml', yaml, section_name: 'Python' }));
      expect(repositories.createExtensionFromYaml).toHaveBeenCalledWith('MyExt', yaml as never, ['Python'], repo as never, true, true, true);
    });

    it('rebuilds all sections when the section name is unknown', async () => {
      await confirmRebuild(rebuildable({ build_type: 'yaml', yaml: { url: 'u' } }));
      expect(repositories.createExtensionFromYaml.calls.mostRecent().args[2]).toEqual([]);
    });

    it('rejects a yaml build without stored yaml information', async () => {
      await confirmRebuild(rebuildable({ build_type: 'yaml' }));
      expect(alerts.addServerFailure).toHaveBeenCalled();
    });

    it('rejects unknown build types', async () => {
      await confirmRebuild(rebuildable({ build_type: 'magic' }));
      expect(alerts.addServerFailure).toHaveBeenCalled();
      expect(changed).toBe(0);
    });

    it('explains that the extension no longer exists when the backend answers 404', async () => {
      repositories.createExtensionFromRepository.and.rejectWith({ status: 404 });
      await confirmRebuild(rebuildable({ build_type: 'repository' }));
      expect(alerts.danger).toHaveBeenCalledWith(jasmine.stringContaining('was not found in Cumulocity'));
      expect(alerts.addServerFailure).not.toHaveBeenCalled();
    });

    it('recognizes the backend\'s "no existing extension" message as not found', async () => {
      repositories.createExtensionFromRepository.and.rejectWith({ message: 'Rebuild requested but no existing extension named X' });
      await confirmRebuild(rebuildable({ build_type: 'repository' }));
      expect(alerts.danger).toHaveBeenCalledWith(jasmine.stringContaining('was not found'));
    });

    it('shows other failures as server failures', async () => {
      const failure = { status: 500, message: 'boom' };
      repositories.createExtensionFromRepository.and.rejectWith(failure);
      await confirmRebuild(rebuildable({ build_type: 'repository' }));
      expect(alerts.addServerFailure).toHaveBeenCalledWith(failure);
      expect(changed).toBe(0);
    });
  });
});
