import { Component, EventEmitter, Input, OnInit, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { AlertService, CoreModule } from '@c8y/ngx-components';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { Observable } from 'rxjs';
import {
    DUMMY_ACCESS_TOKEN,
    Repository,
    RepositoryService,
    uuidCustom
} from '../../shared';
import { ConfirmationModalComponent } from '../../shared/component/confirmation-modal.component';
import { gettext } from '@c8y/ngx-components/gettext';
import { PopoverModule } from 'ngx-bootstrap/popover';

@Component({
    selector: 'a17t-name-repositories-drawer',
    templateUrl: './repositories-drawer.component.html',
    encapsulation: ViewEncapsulation.None,
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule, CoreModule, PopoverModule, ConfirmationModalComponent]
})
export class RepositoriesDrawerComponent implements OnInit {
    @Input() hideInstalled: boolean = false;
    @Output() cancel = new EventEmitter<void>();
    @Output() commit = new EventEmitter<Repository>();

    repositories$!: Observable<Repository[]>;
    repositoriesList: Repository[] = [];
    displayList: Repository[] = [];
    filteredDisplayList: Repository[] = [];
    activeRepository!: Repository;
    repositoryForm: FormGroup;
    selectedRepositoryIndex: number = -1;
    isAddingNew: boolean = false;
    tempNewRepository: Repository | null = null;
    searchTerm: string = '';

    // Store original form values to detect changes
    originalFormValues: any = null;

    popupPAT = `Enter Personal Access Token (PAT) created <a href="https://github.com/settings/tokens/new" target="_blank">here</a>. Select the scope <code>public_repo</code> and enable SSO for the token!`;

    GITHUB_API = 'https://api.github.com/repos/';
    GITHUB_URL = 'https://github.com/';

    showAddRepository: boolean = false;
    deleteDisabled: boolean = false;
    isSaving: boolean = false;
    showPATWarning: boolean = false;

    constructor(
        private repositoryService: RepositoryService,
        private fb: FormBuilder,
        private bsModalService: BsModalService,
        private alertService: AlertService
    ) {
        this.repositoryForm = this.fb.group({
            id: [null],
            name: ['', {
                validators: Validators.required,
                autocomplete: 'off'
            }],
            url: ['', {
                validators: [Validators.required, this.urlValidator],
                autocomplete: 'off'
            }],
            accessToken: ['', {
                autocomplete: 'new-password'
            }],
            enabled: [false]
        });

        // Subscribe to form changes to update the temporary repository name
        const nameControl = this.repositoryForm.get('name');
        if (nameControl) {
          nameControl.valueChanges.subscribe(name => {
            if (this.isAddingNew && this.tempNewRepository) {
              this.tempNewRepository.name = name || 'New repository';
              this.updateDisplayList();
            }
          });
        }
    }

    private stripGithubPrefix(url: string | undefined | null): string {
        if (!url) return '';
        return url.replace(/^https?:\/\/(www\.)?github\.com\//i, '');
    }

    urlValidator = (control: AbstractControl): ValidationErrors | null => {
        try {
            const url = this.GITHUB_URL + control.value;
            new URL(url);
            return null;
        } catch (e) {
            return { invalidUrl: true };
        }
    }

    async ngOnInit(): Promise<void> {
        this.repositories$ = this.repositoryService.getRepositories();

        // Wait for the real initial fetch to settle before deciding whether
        // to open an "add repository" placeholder — the observable's
        // synchronous replay value is still the empty seed at this point,
        // not a reliable signal that there really are no repositories yet.
        const initialRepos = await this.repositoryService.whenReady();

        this.repositories$.subscribe(repos => {
            this.repositoriesList = repos;
            const enabledRepo = repos.find(r => r.enabled);
            if (enabledRepo) {
              this.activeRepository = enabledRepo;
            }

            if (this.isAddingNew && this.tempNewRepository) {
                const addedRepo = repos.find(r => r.name === this.tempNewRepository?.name);
                if (addedRepo) {
                    this.isAddingNew = false;
                    this.tempNewRepository = null;
                    this.updateDisplayList();
                    const index = this.displayList.indexOf(addedRepo);
                    this.setIndex(index);
                    return;
                }
            }

            this.updateDisplayList();
        });

        if (initialRepos.length > 0) {
            this.setIndex(0);
        } else {
            this.createCustomRepository();
        }
    }

    private updateDisplayList(): void {
        if (this.isAddingNew && this.tempNewRepository) {
            this.displayList = [...this.repositoriesList, this.tempNewRepository];
        } else {
            this.displayList = [...this.repositoriesList];
        }

        this.applySearchFilter();
    }

    private applySearchFilter(): void {
        if (!this.searchTerm || this.searchTerm.trim() === '') {
            this.filteredDisplayList = [...this.displayList];
        } else {
            const searchLower = this.searchTerm.toLowerCase().trim();
            this.filteredDisplayList = this.displayList.filter(repo => {
                return repo.name?.toLowerCase().includes(searchLower) ||
                    repo.url?.toLowerCase().includes(searchLower) ||
                    repo.id?.toLowerCase().includes(searchLower);
            });
        }
    }

    searchRepositories(event?: Event): void {
        if (event) {
            const target = event.target as HTMLInputElement;
            this.searchTerm = target.value;
        }

        this.applySearchFilter();
    }

    clearSearch(): void {
        this.searchTerm = '';
        this.applySearchFilter();
    }

    /**
     * Check if the current form has unsaved changes
     */
    private hasFormChanges(): boolean {
        if (!this.originalFormValues) {
            return false;
        }

        const currentValues = this.repositoryForm.value;

        // Both compared in form-normalized (prefix-stripped) form
        const currentUrl = currentValues.url || '';
        const originalUrl = this.originalFormValues.url;

        // Check name change
        if (currentValues.name !== this.originalFormValues.name) {
            return true;
        }

        // Check URL change
        if (currentUrl !== originalUrl) {
            return true;
        }

        // Check access token change. An existing token is loaded as the masked
        // DUMMY_ACCESS_TOKEN, so detect two kinds of change:
        const originalToken = this.originalFormValues.accessToken || '';
        const currentToken = currentValues.accessToken || '';

        // 1. A new, real token was entered (non-empty and not the masked dummy)
        const enteredNewToken = currentToken !== '' && currentToken !== DUMMY_ACCESS_TOKEN;
        // 2. An existing token was cleared (had one before, now empty) — needed to
        //    remove a stale/invalid PAT and fall back to unauthenticated access.
        const clearedToken = originalToken !== '' && currentToken === '';
        if (enteredNewToken || clearedToken) {
            return true;
        }

        return false;
    }

    get isSaveDisabled(): boolean {
        // For new repositories, just check form validity
        if (this.isAddingNew) {
            return this.repositoryForm.invalid || this.isSaving;
        }

        // For existing repositories, enable save if:
        // 1. Form is valid AND
        // 2. (There are form changes OR there are unsaved enabled changes)
        if (this.repositoryForm.invalid || this.isSaving) {
            return true;
        }

        return !this.hasFormChanges() && !this.repositoryService.hasUnsavedChanges();
    }

    get hasUnsavedChanges(): boolean {
        return this.hasFormChanges() || this.repositoryService.hasUnsavedChanges();
    }

    onEditRepository(repository: Repository): void {
        if (this.isAddingNew && this.tempNewRepository && repository.id === this.tempNewRepository.id) {
            return;
        }

        const actualIndex = this.displayList.indexOf(repository);
        this.selectedRepositoryIndex = actualIndex;
        this.isAddingNew = false;
        this.tempNewRepository = null;
        this.showPATWarning = false;

        const rep = { ...repository };
        rep.url = this.stripGithubPrefix(rep.url);

        // Store original values for change detection (URL stored in form-normalized form)
        this.originalFormValues = {
            id: rep.id,
            name: rep.name,
            url: rep.url,
            accessToken: rep.accessToken || '',
            enabled: rep.enabled
        };

        // Set form with URL without prefix
        this.repositoryForm.patchValue(rep);
        this.showAddRepository = true;
        this.deleteDisabled = false;
        this.updateDisplayList();
    }

    setIndex(index: number): void {
        if (index < this.displayList.length) {
            const repository = this.displayList[index];
            this.onEditRepository(repository);
        }
    }

    deselectRepository(): void {
        this.selectedRepositoryIndex = -1;
        this.isAddingNew = false;
        this.tempNewRepository = null;
        this.showAddRepository = false;
        this.originalFormValues = null;
        this.repositoryForm.reset();
        this.updateDisplayList();
    }

    createCustomRepository(): void {
        this.resetForm();
        this.selectedRepositoryIndex = -1;
        this.isAddingNew = true;
        this.showAddRepository = true;
        this.deleteDisabled = true;
        this.originalFormValues = null;
        this.showPATWarning = false;

        this.tempNewRepository = {
            id: 'temp-' + uuidCustom(),
            name: 'New repository',
            url: '',
            enabled: false
        } as Repository;

        this.updateDisplayList();
        this.selectedRepositoryIndex = this.displayList.length - 1;
    }

    warnAboutPATReset(): void {
        // Show warning if URL or name is changed and there's an existing token
        if (!this.isAddingNew && this.originalFormValues) {
            const currentUrl = this.repositoryForm.get('url')?.value || '';
            const originalUrl = this.originalFormValues.url;
            const currentName = this.repositoryForm.get('name')?.value || '';
            const originalName = this.originalFormValues.name;

            if (currentUrl !== originalUrl || currentName !== originalName) {
                this.showPATWarning = true;
                // Clear the access token when URL or name changes
                this.repositoryForm.patchValue({ accessToken: '' });
            } else {
                this.showPATWarning = false;
            }
        }
    }

    private async addRepository(): Promise<void> {
        if (this.repositoryForm.valid) {
            const newRepository: Repository = this.repositoryForm.value;
            newRepository.url = this.GITHUB_URL + this.repositoryForm.value.url;
            newRepository.id = uuidCustom();
            newRepository.enabled = false;

            await this.repositoryService.addRepository(newRepository);

            this.repositoryService.updateHideInstalledFilter(this.hideInstalled);
        }
    }

    toggleActivation(repository: Repository): void {
        if (this.isAddingNew && this.tempNewRepository && repository.id === this.tempNewRepository.id) {
            return;
        }

        this.repositoryService.toggleRepositoryEnabled(repository.id);

        if (!repository.enabled) {
            this.activeRepository = repository;
        }
    }

    private async updateRepository(): Promise<void> {
        if (this.repositoryForm.valid) {
            const updatedRepository: Repository = this.repositoryForm.value;
            updatedRepository.url = this.GITHUB_URL + updatedRepository.url;

            await this.repositoryService.updateRepository(updatedRepository);

            // Update original form values after successful save
            this.originalFormValues = {
                id: updatedRepository.id,
                name: updatedRepository.name,
                url: updatedRepository.url,
                accessToken: updatedRepository.accessToken || '',
                enabled: updatedRepository.enabled
            };

            this.repositoryService.updateHideInstalledFilter(this.hideInstalled);
        }
    }

    async testRepository(): Promise<void> {
        if (this.repositoryForm.valid) {
            const testedRepository: Repository = { ...this.repositoryForm.value };
            testedRepository.url = this.GITHUB_URL + testedRepository.url;
            const result = await this.repositoryService.testRepository(testedRepository);
            if (result.success) {
                this.alertService.success(result.message || 'Operation successful');
            } else {
                this.alertService.danger(result.message || 'Operation failed');
            }
        }
    }

    deleteRepository(repositoryId: string): void {
        const repository = this.repositoriesList.find(r => r.id === repositoryId);
        const initialState = {
            title: 'Delete repository',
            message: `You are about to delete the repository "${repository?.name || repositoryId}". Do you want to proceed?`,
            labels: {
                ok: 'Delete',
                cancel: 'Cancel'
            }
        };
        const confirmDeletionModalRef: BsModalRef = this.bsModalService.show(
            ConfirmationModalComponent,
            { initialState }
        );
        confirmDeletionModalRef.content.closeSubject.subscribe(
            async (result: boolean) => {
                if (result) {
                    this.isSaving = true;
                    try {
                        await this.repositoryService.deleteRepository(repositoryId);

                        if (this.repositoriesList.length > 0) {
                            this.setIndex(0);
                        } else {
                            this.createCustomRepository();
                        }

                        this.repositoryService.updateHideInstalledFilter(this.hideInstalled);
                    } catch (ex) {
                        console.error('Failed to delete repository:', ex);
                    } finally {
                        this.isSaving = false;
                    }
                }
                confirmDeletionModalRef.hide();
            }
        );
    }

    deleteButtonClicked(): void {
        if (this.selectedRepositoryIndex !== -1 && !this.isAddingNew) {
            const repository = this.displayList[this.selectedRepositoryIndex];
            this.deleteRepository(repository.id);
        }
    }

    async onSave(): Promise<void> {
        this.isSaving = true;
        try {
            if (this.isAddingNew) {
                // Adding a new repository
                await this.addRepository();
            } else if (this.selectedRepositoryIndex !== -1) {
                const hasFormModifications = this.hasFormChanges();
                const hasEnabledChanges = this.repositoryService.hasUnsavedChanges();

                if (hasFormModifications) {
                    // Form changed (name, url, token), possibly alongside enabled
                    // toggles. updateRepository() persists the whole repository
                    // list — which already includes any enabled-state changes — so
                    // it covers both cases in a single save (and a single toast).
                    await this.updateRepository();
                    this.repositoryService.updateHideInstalledFilter(this.hideInstalled);
                } else if (hasEnabledChanges) {
                    // Only enabled status changed
                    await this.repositoryService.saveAllRepositories();
                    this.repositoryService.updateHideInstalledFilter(this.hideInstalled);
                }
            }

            this.commit.emit(this.activeRepository);
        } catch (error) {
            console.error('Failed to save:', error);
        } finally {
            this.isSaving = false;
        }
    }

    onCancel(): void {
        if (this.isAddingNew) {
            this.tempNewRepository = null;
            this.isAddingNew = false;
            this.updateDisplayList();

            if (this.repositoriesList.length > 0) {
                this.setIndex(0);
            } else {
                this.deselectRepository();
            }
            this.cancel.emit();
        } else if (this.hasUnsavedChanges) {
            const initialState = {
                title: 'Unsaved Changes',
                message: 'You have unsaved changes. Do you want to discard these changes?',
                labels: {
                    ok: 'Discard',
                    cancel: 'Keep Editing'
                }
            };
            const confirmCancelModalRef: BsModalRef = this.bsModalService.show(
                ConfirmationModalComponent,
                { initialState }
            );
            confirmCancelModalRef.content.closeSubject.subscribe(
                (result: boolean) => {
                    if (result) {
                        // Revert form changes
                        if (this.originalFormValues) {
                            this.repositoryForm.patchValue(this.originalFormValues);
                        }
                        // Revert enabled changes
                        this.repositoryService.cancelChanges();
                        this.cancel.emit();
                    }
                    confirmCancelModalRef.hide();
                }
            );
        } else {
            this.cancel.emit();
        }
    }

    resetForm(): void {
        this.repositoryForm.reset();
        this.selectedRepositoryIndex = -1;
        this.isAddingNew = false;
        this.originalFormValues = null;
    }

    /**
 * Open the full GitHub URL in a new browser window
 */
openInGitHub(): void {
    const urlValue = this.repositoryForm.get('url')?.value || '';
    
    if (!urlValue || urlValue.trim() === '') {
        this.alertService.warning(gettext('Please enter a repository URL first'));
        return;
    }

    // Construct the full GitHub URL
    const fullUrl = this.GITHUB_URL + urlValue.trim();
    
    // Validate the URL before opening
    try {
        new URL(fullUrl);
        
        // Open in new window/tab
        window.open(fullUrl, '_blank', 'noopener,noreferrer');
        
        // Check if popup was blocked
        // if (!newWindow || newWindow.closed || typeof newWindow.closed === 'undefined') {
        //     this.alertService.warning(
        //         gettext('Pop-up blocked. Please allow pop-ups for this site and try again.')
        //     );
        // } else {
        //     this.alertService.success(gettext('Repository opened in new tab'));
        // }
    } catch (error) {
        this.alertService.danger(
            gettext('Invalid URL. Please check the repository URL format.')
        );
    }
}
}