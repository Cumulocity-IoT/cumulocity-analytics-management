import { TestBed } from '@angular/core/testing';
import { AlertService } from '@c8y/ngx-components';
import { AnalyticsService, Repository, RepositoryItem, RepositoryService } from '../../shared';
import { ExtensionCreateModalComponent } from './extension-create-modal.component';

const item = (name: string) => ({ id: name, name, file: `${name}.mon`, type: 'file' }) as RepositoryItem;
const repository = { id: 'r1', name: 'Repo' } as Repository;
const flush = () => new Promise<void>(resolve => setTimeout(resolve));

describe('ExtensionCreateModalComponent', () => {
  let component: ExtensionCreateModalComponent;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let repositories: jasmine.SpyObj<RepositoryService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let closed: unknown[];

  const create = (inputs: Partial<ExtensionCreateModalComponent> = {}) => {
    component = TestBed.createComponent(ExtensionCreateModalComponent).componentInstance;
    Object.assign(component, { activeRepository: repository }, inputs);
    closed = [];
    component.closeSubject.subscribe(v => closed.push(v));
    return component;
  };

  beforeEach(() => {
    analytics = jasmine.createSpyObj('AnalyticsService', ['isBackendServiceAvailable']);
    analytics.isBackendServiceAvailable.and.resolveTo(false);
    repositories = jasmine.createSpyObj('RepositoryService', ['createExtensionFromList', 'createExtensionFromYaml', 'createExtensionFromRepository']);
    repositories.createExtensionFromList.and.resolveTo({ status: 200 } as never);
    repositories.createExtensionFromYaml.and.resolveTo({ status: 200 } as never);
    repositories.createExtensionFromRepository.and.resolveTo({ status: 200 } as never);
    alerts = jasmine.createSpyObj('AlertService', ['success', 'warning']);
    TestBed.configureTestingModule({
      imports: [ExtensionCreateModalComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: RepositoryService, useValue: repositories },
        { provide: AlertService, useValue: alerts }
      ]
    });
    TestBed.overrideComponent(ExtensionCreateModalComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    spyOn(console, 'error');
  });

  describe('initialisation', () => {
    it('proposes the name of the first selected block and deploys by default', async () => {
      create({ monitors: [item('Foo'), item('Bar')] }).ngOnInit();
      expect(component.configForm.value).toEqual({ name: 'Foo', deploy: true });
    });

    it('requires a name', () => {
      create({ monitors: [] }).ngOnInit();
      expect(component.configForm.valid).toBeFalse();
      component.configForm.patchValue({ name: 'X' });
      expect(component.configForm.valid).toBeTrue();
    });

    it('treats a build with sections as an extension build', () => {
      expect(create({ sections: ['A'] }).configurationIsExtension).toBeUndefined();
      component.ngOnInit();
      expect(component.configurationIsExtension).toBeTrue();
      create({ monitors: [item('A')] }).ngOnInit();
      expect(component.configurationIsExtension).toBeFalse();
    });
  });

  describe('backend requirement', () => {
    it('is waived when the backend is available', async () => {
      analytics.isBackendServiceAvailable.and.resolveTo(true);
      create({ monitors: [item('A')] }).ngOnInit();
      await flush();
      expect(component.backendDeployed$.value).toBeTrue();
      expect(component.requiresBackend).toBeFalse();
      expect(alerts.warning).not.toHaveBeenCalled();
    });

    it('is waived for a plain list of files without backend (built in the browser)', async () => {
      create({ monitors: [item('A')] }).ngOnInit();
      await flush();
      expect(component.requiresBackend).toBeFalse();
      expect(alerts.warning).not.toHaveBeenCalled();
    });

    it('is required for yaml sections, with a warning naming the service', async () => {
      create({ monitors: [item('extensions')], sections: ['A'] }).ngOnInit();
      await flush();
      expect(component.requiresBackend).toBeTrue();
      expect(alerts.warning).toHaveBeenCalledWith(jasmine.stringContaining('extensions.yaml sections'));
      expect(alerts.warning).toHaveBeenCalledWith(jasmine.stringContaining('analytics-ext-service'));
    });

    it('is required for whole repository builds (no monitors)', async () => {
      create({}).ngOnInit();
      await flush();
      expect(component.requiresBackend).toBeTrue();
      expect(alerts.warning).toHaveBeenCalledWith(jasmine.stringContaining('a whole repository path'));
    });

    it('falls back to "no backend" when the availability check fails', async () => {
      analytics.isBackendServiceAvailable.and.rejectWith(new Error('x'));
      create({ monitors: [item('A')] }).ngOnInit();
      await flush();
      expect(component.backendDeployed$.value).toBeFalse();
      expect(component.requiresBackend).toBeFalse(); // list builds still possible
    });

    it('starts blocked until the check has finished', () => {
      expect(create({ monitors: [item('A')] }).requiresBackend).toBeTrue();
    });
  });

  describe('createExtension', () => {
    it('builds from the selected files', async () => {
      create({ monitors: [item('Foo')] });
      component.configForm.patchValue({ name: 'MyExt', deploy: false });
      await component.createExtension();

      expect(repositories.createExtensionFromList).toHaveBeenCalledWith('MyExt', component.monitors, repository, true, false);
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('available in Analytics Builder after the next Apama restart'));
      expect(closed).toEqual([true]);
      expect(component.loading).toBeFalse();
    });

    it('announces the engine restart when deploying', async () => {
      create({ monitors: [item('Foo')] });
      component.configForm.patchValue({ name: 'MyExt', deploy: true });
      await component.createExtension();
      expect(alerts.success).toHaveBeenCalledWith(jasmine.stringContaining('MyExt.zip has been uploaded and Streaming Analytics Engine is restarting'));
    });

    it('builds yaml sections from the yaml item', async () => {
      create({ monitors: [item('extensions')], sections: ['A', 'B'] });
      component.configForm.patchValue({ name: 'E' });
      await component.createExtension();
      expect(repositories.createExtensionFromYaml).toHaveBeenCalledWith('E', component.monitors[0], ['A', 'B'], repository, true, true);
    });

    it('builds the whole repository when nothing is selected', async () => {
      create({});
      component.configForm.patchValue({ name: 'E' });
      await component.createExtension();
      expect(repositories.createExtensionFromRepository).toHaveBeenCalledWith('E', repository, true, true);
    });

    it('uses "extension" when no name is given', async () => {
      create({});
      component.configForm.patchValue({ name: '' });
      await component.createExtension();
      expect(repositories.createExtensionFromRepository.calls.mostRecent().args[0]).toBe('extension');
    });

    it('does not announce success for error responses (the service already alerted)', async () => {
      repositories.createExtensionFromList.and.resolveTo({ status: 500 } as never);
      create({ monitors: [item('Foo')] });
      component.configForm.patchValue({ name: 'E' });
      await component.createExtension();
      expect(alerts.success).not.toHaveBeenCalled();
      expect(closed).toEqual([true]);
    });

    it('still closes and stops loading when the build throws', async () => {
      repositories.createExtensionFromList.and.rejectWith(new Error('boom'));
      create({ monitors: [item('Foo')] });
      component.configForm.patchValue({ name: 'E' });
      await component.createExtension();
      expect(alerts.success).not.toHaveBeenCalled();
      expect(component.loading).toBeFalse();
      expect(closed).toEqual([true]);
    });
  });

  it('dismissing and closing report different results', () => {
    create({});
    component.onDismiss({});
    component.onClose();
    expect(closed).toEqual([undefined, false]);
  });
});
