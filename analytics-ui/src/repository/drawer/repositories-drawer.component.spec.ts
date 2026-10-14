import { TestBed } from '@angular/core/testing';
import { AlertService } from '@c8y/ngx-components';
import { BsModalService } from 'ngx-bootstrap/modal';
import { BehaviorSubject, Subject } from 'rxjs';
import { DUMMY_ACCESS_TOKEN, Repository, RepositoryService } from '../../shared';
import { RepositoriesDrawerComponent } from './repositories-drawer.component';

const repo = (over: Partial<Repository> = {}): Repository =>
  ({
    id: 'r1',
    name: 'Contrib',
    url: 'https://github.com/Cumulocity-IoT/blocks/tree/main/blocks',
    accessToken: DUMMY_ACCESS_TOKEN,
    enabled: true,
    ...over
  }) as Repository;

describe('RepositoriesDrawerComponent', () => {
  let component: RepositoriesDrawerComponent;
  let service: jasmine.SpyObj<RepositoryService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let modals: jasmine.SpyObj<BsModalService>;
  let repos$: BehaviorSubject<Repository[]>;
  let modalClose$: Subject<boolean>;
  let modalHide: jasmine.Spy;

  async function create(initial: Repository[] = [repo(), repo({ id: 'r2', name: 'Other', url: 'https://github.com/o/other', enabled: false })]) {
    TestBed.resetTestingModule();
    repos$ = new BehaviorSubject<Repository[]>(initial);
    service.getRepositories.and.returnValue(repos$);
    service.whenReady.and.resolveTo(initial);
    TestBed.configureTestingModule({
      imports: [RepositoriesDrawerComponent],
      providers: [
        { provide: RepositoryService, useValue: service },
        { provide: AlertService, useValue: alerts },
        { provide: BsModalService, useValue: modals }
      ]
    });
    TestBed.overrideComponent(RepositoriesDrawerComponent, {
      set: { template: '', templateUrl: undefined, imports: [] }
    });
    component = TestBed.createComponent(RepositoriesDrawerComponent).componentInstance;
    await component.ngOnInit();
  }

  beforeEach(() => {
    service = jasmine.createSpyObj<RepositoryService>('RepositoryService', [
      'getGlobalAccessTokenMasked',
      'setGlobalAccessToken',
      'getRepositories',
      'whenReady',
      'hasUnsavedChanges',
      'addRepository',
      'updateRepository',
      'deleteRepository',
      'saveAllRepositories',
      'toggleRepositoryEnabled',
      'testRepository',
      'cancelChanges',
      'updateHideInstalledFilter'
    ]);
    service.getGlobalAccessTokenMasked.and.resolveTo('');
    service.hasUnsavedChanges.and.returnValue(false);
    service.addRepository.and.resolveTo();
    service.updateRepository.and.resolveTo();
    service.saveAllRepositories.and.resolveTo();
    service.deleteRepository.and.resolveTo();
    alerts = jasmine.createSpyObj<AlertService>('AlertService', ['success', 'danger', 'warning']);
    modalClose$ = new Subject<boolean>();
    modalHide = jasmine.createSpy('hide');
    modals = jasmine.createSpyObj<BsModalService>('BsModalService', ['show']);
    modals.show.and.returnValue({ content: { closeSubject: modalClose$ }, hide: modalHide } as never);
    spyOn(console, 'error');
  });

  describe('initialisation', () => {
    it('selects the first repository and shows its URL without the github.com prefix', async () => {
      await create();
      expect(component.selectedRepositoryIndex).toBe(0);
      expect(component.showAddRepository).toBeTrue();
      expect(component.repositoryForm.value.url).toBe('Cumulocity-IoT/blocks/tree/main/blocks');
      expect(component.activeRepository.id).toBe('r1');
    });

    it('opens an "add repository" placeholder when there are no repositories', async () => {
      await create([]);
      expect(component.isAddingNew).toBeTrue();
      expect(component.tempNewRepository?.name).toBe('New repository');
      expect(component.deleteDisabled).toBeTrue();
      expect(component.displayList.length).toBe(1);
    });

    it('reflects a configured (masked) global access token', async () => {
      service.getGlobalAccessTokenMasked.and.resolveTo(DUMMY_ACCESS_TOKEN);
      await create();
      expect(component.isGlobalAccessTokenSet).toBeTrue();
      expect(component.globalAccessTokenForm.value.accessToken).toBe(DUMMY_ACCESS_TOKEN);
    });

    it('keeps the display list in sync with repository updates', async () => {
      await create();
      repos$.next([repo(), repo({ id: 'r3', name: 'Third' })]);
      expect(component.displayList.map(r => r.id)).toEqual(['r1', 'r3']);
    });
  });

  describe('validation', () => {
    beforeEach(async () => create());

    it('requires name and url', () => {
      component.repositoryForm.reset();
      expect(component.repositoryForm.get('name')?.hasError('required')).toBeTrue();
      expect(component.repositoryForm.get('url')?.hasError('required')).toBeTrue();
    });

    it('accepts an owner/repo style url', () => {
      component.repositoryForm.patchValue({ name: 'n', url: 'owner/repo' });
      expect(component.repositoryForm.valid).toBeTrue();
    });
  });

  describe('search', () => {
    beforeEach(async () => create());

    it('filters by name, url and id, case-insensitively', () => {
      component.searchTerm = 'OTHER';
      component.searchRepositories();
      expect(component.filteredDisplayList.map(r => r.id)).toEqual(['r2']);

      component.searchTerm = 'r1';
      component.searchRepositories();
      expect(component.filteredDisplayList.map(r => r.id)).toEqual(['r1']);

      component.searchTerm = 'cumulocity-iot';
      component.searchRepositories();
      expect(component.filteredDisplayList.map(r => r.id)).toEqual(['r1']);
    });

    it('reads the term from an input event', () => {
      component.searchRepositories({ target: { value: 'Other' } } as unknown as Event);
      expect(component.searchTerm).toBe('Other');
      expect(component.filteredDisplayList.length).toBe(1);
    });

    it('shows everything for a blank term and after clearSearch()', () => {
      component.searchTerm = '   ';
      component.searchRepositories();
      expect(component.filteredDisplayList.length).toBe(2);

      component.searchTerm = 'zzz';
      component.searchRepositories();
      expect(component.filteredDisplayList.length).toBe(0);
      component.clearSearch();
      expect(component.filteredDisplayList.length).toBe(2);
    });
  });

  describe('change detection (isSaveDisabled / hasUnsavedChanges)', () => {
    beforeEach(async () => create());

    it('is disabled for an untouched, loaded repository', () => {
      expect(component.isSaveDisabled).toBeTrue();
      expect(component.hasUnsavedChanges).toBeFalse();
    });

    it('is enabled after a name change', () => {
      component.repositoryForm.patchValue({ name: 'Renamed' });
      expect(component.isSaveDisabled).toBeFalse();
    });

    it('is enabled after a url change', () => {
      component.repositoryForm.patchValue({ url: 'o/else' });
      expect(component.isSaveDisabled).toBeFalse();
    });

    it('stays disabled while the masked dummy token is untouched', () => {
      component.repositoryForm.patchValue({ accessToken: DUMMY_ACCESS_TOKEN });
      expect(component.isSaveDisabled).toBeTrue();
    });

    it('is enabled when a new token is entered', () => {
      component.repositoryForm.patchValue({ accessToken: 'ghp_new' });
      expect(component.isSaveDisabled).toBeFalse();
    });

    it('is enabled when an existing token is cleared', () => {
      component.repositoryForm.patchValue({ accessToken: '' });
      expect(component.isSaveDisabled).toBeFalse();
    });

    it('is enabled when only enabled-toggles are pending in the service', () => {
      service.hasUnsavedChanges.and.returnValue(true);
      expect(component.isSaveDisabled).toBeFalse();
      expect(component.hasUnsavedChanges).toBeTrue();
    });

    it('is disabled while saving or when the form is invalid', () => {
      component.repositoryForm.patchValue({ name: 'Renamed' });
      component.isSaving = true;
      expect(component.isSaveDisabled).toBeTrue();
      component.isSaving = false;
      component.repositoryForm.patchValue({ name: '' });
      expect(component.isSaveDisabled).toBeTrue();
    });

    it('for a new repository only requires a valid form', () => {
      component.createCustomRepository();
      expect(component.isSaveDisabled).toBeTrue();
      component.repositoryForm.patchValue({ name: 'n', url: 'o/r' });
      expect(component.isSaveDisabled).toBeFalse();
    });
  });

  describe('warnAboutPATReset', () => {
    beforeEach(async () => create());

    it('warns and clears the token when the url changes', () => {
      component.repositoryForm.patchValue({ url: 'o/else', accessToken: DUMMY_ACCESS_TOKEN });
      component.warnAboutPATReset();
      expect(component.showPATWarning).toBeTrue();
      expect(component.repositoryForm.value.accessToken).toBe('');
    });

    it('warns when the name changes', () => {
      component.repositoryForm.patchValue({ name: 'Renamed' });
      component.warnAboutPATReset();
      expect(component.showPATWarning).toBeTrue();
    });

    it('does not warn when nothing identity-related changed', () => {
      component.warnAboutPATReset();
      expect(component.showPATWarning).toBeFalse();
      expect(component.repositoryForm.value.accessToken).toBe(DUMMY_ACCESS_TOKEN);
    });
  });

  describe('creating a repository', () => {
    beforeEach(async () => create());

    it('appends a temporary entry and mirrors the typed name into it', () => {
      component.createCustomRepository();
      expect(component.isAddingNew).toBeTrue();
      expect(component.displayList[component.displayList.length - 1].name).toBe('New repository');
      expect(component.selectedRepositoryIndex).toBe(component.displayList.length - 1);

      component.repositoryForm.patchValue({ name: 'Typed' });
      expect(component.displayList[component.displayList.length - 1].name).toBe('Typed');
    });

    it('onSave() adds a disabled repository with a full github url and a new id, then commits', async () => {
      component.createCustomRepository();
      component.repositoryForm.patchValue({ name: 'New', url: 'o/new', accessToken: 'ghp_x' });
      const committed: Repository[] = [];
      component.commit.subscribe(r => committed.push(r));

      await component.onSave();

      const [added] = service.addRepository.calls.mostRecent().args;
      expect(added.url).toBe('https://github.com/o/new');
      expect(added.enabled).toBeFalse();
      expect(added.id).toBeTruthy();
      expect(added.accessToken).toBe('ghp_x');
      expect(service.updateHideInstalledFilter).toHaveBeenCalled();
      expect(committed.length).toBe(1);
      expect(component.isSaving).toBeFalse();
    });

    it('onSave() does not add an invalid repository', async () => {
      component.createCustomRepository();
      await component.onSave();
      expect(service.addRepository).not.toHaveBeenCalled();
    });

    it('onCancel() discards the placeholder, reselects the first repository and emits cancel', () => {
      component.createCustomRepository();
      let cancelled = 0;
      component.cancelled.subscribe(() => cancelled++);

      component.onCancel();

      expect(component.isAddingNew).toBeFalse();
      expect(component.tempNewRepository).toBeNull();
      expect(component.selectedRepositoryIndex).toBe(0);
      expect(cancelled).toBe(1);
    });
  });

  describe('saving an existing repository', () => {
    beforeEach(async () => create());

    it('persists form changes with a full github url', async () => {
      component.repositoryForm.patchValue({ name: 'Renamed', url: 'o/else' });
      await component.onSave();

      const [updated] = service.updateRepository.calls.mostRecent().args;
      expect(updated.name).toBe('Renamed');
      expect(updated.url).toBe('https://github.com/o/else');
      expect(service.saveAllRepositories).not.toHaveBeenCalled();
    });

    it('persists only the enabled state when the form is untouched', async () => {
      service.hasUnsavedChanges.and.returnValue(true);
      await component.onSave();
      expect(service.saveAllRepositories).toHaveBeenCalled();
      expect(service.updateRepository).not.toHaveBeenCalled();
    });

    it('saves nothing when nothing changed, but still emits commit', async () => {
      const committed: Repository[] = [];
      component.commit.subscribe(r => committed.push(r));
      await component.onSave();
      expect(service.updateRepository).not.toHaveBeenCalled();
      expect(service.saveAllRepositories).not.toHaveBeenCalled();
      expect(committed.length).toBe(1);
    });

    it('does not commit and resets isSaving when saving fails', async () => {
      service.updateRepository.and.rejectWith(new Error('nope'));
      component.repositoryForm.patchValue({ name: 'Renamed' });
      let commits = 0;
      component.commit.subscribe(() => commits++);

      await component.onSave();

      expect(commits).toBe(0);
      expect(component.isSaving).toBeFalse();
    });

    it('resets change detection after a successful update', async () => {
      component.repositoryForm.patchValue({ name: 'Renamed' });
      await component.onSave();
      expect(component.originalFormValues.name).toBe('Renamed');
    });
  });

  describe('cancel with unsaved changes', () => {
    beforeEach(async () => create());

    it('just emits cancel when nothing changed', () => {
      let cancelled = 0;
      component.cancelled.subscribe(() => cancelled++);
      component.onCancel();
      expect(cancelled).toBe(1);
      expect(modals.show).not.toHaveBeenCalled();
    });

    it('asks for confirmation and reverts on discard', () => {
      component.repositoryForm.patchValue({ name: 'Renamed' });
      let cancelled = 0;
      component.cancelled.subscribe(() => cancelled++);

      component.onCancel();
      expect(modals.show).toHaveBeenCalled();
      expect(cancelled).toBe(0);

      modalClose$.next(true);
      expect(component.repositoryForm.value.name).toBe('Contrib');
      expect(service.cancelChanges).toHaveBeenCalled();
      expect(cancelled).toBe(1);
      expect(modalHide).toHaveBeenCalled();
    });

    it('keeps editing when the user declines', () => {
      component.repositoryForm.patchValue({ name: 'Renamed' });
      let cancelled = 0;
      component.cancelled.subscribe(() => cancelled++);

      component.onCancel();
      modalClose$.next(false);

      expect(component.repositoryForm.value.name).toBe('Renamed');
      expect(service.cancelChanges).not.toHaveBeenCalled();
      expect(cancelled).toBe(0);
      expect(modalHide).toHaveBeenCalled();
    });
  });

  describe('deleting', () => {
    beforeEach(async () => create());

    it('does nothing for a repository that is only being added', () => {
      component.createCustomRepository();
      component.deleteButtonClicked();
      expect(modals.show).not.toHaveBeenCalled();
    });

    it('deletes the selected repository after confirmation and selects the next one', async () => {
      component.deleteButtonClicked();
      const {initialState} = (modals.show.calls.mostRecent().args[1] as { initialState: { message: string } });
      expect(initialState.message).toContain('Contrib');

      modalClose$.next(true);
      await Promise.resolve();
      await Promise.resolve();

      expect(service.deleteRepository).toHaveBeenCalledWith('r1');
      expect(component.isSaving).toBeFalse();
      expect(modalHide).toHaveBeenCalled();
    });

    it('does not delete when the confirmation is declined', async () => {
      component.deleteButtonClicked();
      modalClose$.next(false);
      expect(service.deleteRepository).not.toHaveBeenCalled();
      expect(modalHide).toHaveBeenCalled();
    });

    it('opens a new-repository form after the last repository was deleted', async () => {
      await create([repo()]);
      service.deleteRepository.and.callFake(async () => repos$.next([]));
      component.deleteButtonClicked();
      modalClose$.next(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(component.isAddingNew).toBeTrue();
    });
  });

  describe('toggleActivation', () => {
    beforeEach(async () => create());

    it('toggles the repository and tracks the newly activated one', () => {
      const [, other] = component.repositoriesList;
      component.toggleActivation(other);
      expect(service.toggleRepositoryEnabled).toHaveBeenCalledWith('r2');
      expect(component.activeRepository.id).toBe('r2');
    });

    it('ignores the placeholder of a repository being added', () => {
      component.createCustomRepository();
      component.toggleActivation(component.tempNewRepository as Repository);
      expect(service.toggleRepositoryEnabled).not.toHaveBeenCalled();
    });
  });

  describe('testRepository', () => {
    beforeEach(async () => create());

    it('tests with the full url and reports success', async () => {
      service.testRepository.and.resolveTo({ success: true, message: 'Connected' });
      await component.testRepository();
      expect(service.testRepository.calls.mostRecent().args[0].url).toMatch(/^https:\/\/github\.com\//);
      expect(alerts.success).toHaveBeenCalledWith('Connected');
    });

    it('reports failure', async () => {
      service.testRepository.and.resolveTo({ success: false, message: 'Bad token' });
      await component.testRepository();
      expect(alerts.danger).toHaveBeenCalledWith('Bad token');
    });

    it('does not test an invalid form', async () => {
      component.repositoryForm.patchValue({ name: '' });
      await component.testRepository();
      expect(service.testRepository).not.toHaveBeenCalled();
    });
  });

  describe('global access token', () => {
    beforeEach(async () => create());

    it('cannot be saved while it still holds the masked dummy value or while saving', () => {
      component.globalAccessTokenForm.patchValue({ accessToken: DUMMY_ACCESS_TOKEN });
      expect(component.isGlobalAccessTokenSaveDisabled).toBeTrue();
      component.globalAccessTokenForm.patchValue({ accessToken: 'ghp_x' });
      expect(component.isGlobalAccessTokenSaveDisabled).toBeFalse();
      component.isSavingGlobalAccessToken = true;
      expect(component.isGlobalAccessTokenSaveDisabled).toBeTrue();
    });

    it('saves a token and masks it afterwards', async () => {
      service.setGlobalAccessToken.and.resolveTo();
      component.globalAccessTokenForm.patchValue({ accessToken: 'ghp_x' });
      await component.saveGlobalAccessToken();
      expect(service.setGlobalAccessToken).toHaveBeenCalledWith('ghp_x');
      expect(component.isGlobalAccessTokenSet).toBeTrue();
      expect(component.globalAccessTokenForm.value.accessToken).toBe(DUMMY_ACCESS_TOKEN);
      expect(alerts.success).toHaveBeenCalled();
      expect(component.isSavingGlobalAccessToken).toBeFalse();
    });

    it('clears the token when saving an empty value', async () => {
      service.setGlobalAccessToken.and.resolveTo();
      component.globalAccessTokenForm.patchValue({ accessToken: '' });
      await component.saveGlobalAccessToken();
      expect(component.isGlobalAccessTokenSet).toBeFalse();
      expect(component.globalAccessTokenForm.value.accessToken).toBe('');
    });

    it('shows an error when saving fails', async () => {
      service.setGlobalAccessToken.and.rejectWith(new Error('x'));
      component.globalAccessTokenForm.patchValue({ accessToken: 'ghp_x' });
      await component.saveGlobalAccessToken();
      expect(alerts.danger).toHaveBeenCalled();
      expect(component.isSavingGlobalAccessToken).toBeFalse();
    });

    it('clearGlobalAccessToken() only empties the form field', () => {
      component.clearGlobalAccessToken();
      expect(component.globalAccessTokenForm.value.accessToken).toBe('');
      expect(service.setGlobalAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('openInGitHub', () => {
    beforeEach(async () => create());

    it('warns when no url is entered', () => {
      const open = spyOn(window, 'open');
      component.repositoryForm.patchValue({ url: '  ' });
      component.openInGitHub();
      expect(alerts.warning).toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });

    it('opens the full github url in a new, isolated window', () => {
      const open = spyOn(window, 'open');
      component.repositoryForm.patchValue({ url: ' o/r ' });
      component.openInGitHub();
      expect(open).toHaveBeenCalledWith('https://github.com/o/r', '_blank', 'noopener,noreferrer');
    });
  });
});
