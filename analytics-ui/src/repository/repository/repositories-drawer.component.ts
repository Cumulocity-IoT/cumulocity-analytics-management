import { Component, EventEmitter, Input, OnInit, Output, ViewEncapsulation } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { AlertService } from '@c8y/ngx-components';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { Observable } from 'rxjs';
import {
    ConfirmationModalComponent,
    Repository,
    RepositoryService,
    uuidCustom
} from '../../shared';

@Component({
    selector: 'a17t-name-repositories-drawer',
    templateUrl: './repositories-drawer.component.html',
    encapsulation: ViewEncapsulation.None,
    standalone: false
})
export class RepositoriesDrawerComponent implements OnInit {
    @Input() hideInstalled: boolean = false;
    @Output() cancel = new EventEmitter<void>();
    @Output() commit = new EventEmitter<Repository>();

    repositories$: Observable<Repository[]>;
    repositoriesList: Repository[] = [];
    displayList: Repository[] = [];
    filteredDisplayList: Repository[] = [];
    activeRepository: Repository;
    repositoryForm: FormGroup;
    selectedRepositoryIndex: number = -1;
    isAddingNew: boolean = false;
    tempNewRepository: Repository | null = null;
    searchTerm: string = '';
    
    // Store original form values to detect changes
    originalFormValues: any = null;

    popupPAT = `Enter Personal Access Token (PAT) created <a href="https://github.com/settings/tokens/new" target="_blank">here</a>. Select the scope <code>public_repo</code> and enable SSO for the token!`;
    popRepositoryUrl = `Enter the last parts to a github repository. If no branch name is given, the default branch <code>main</code> is assumed.`;
    GITHUB_API = 'https://api.github.com/repos/';
    GITHUB_URL = 'https://github.com/';
    DUMMY_ACCESS_TOKEN = "_DUMMY_ACCESS_CODE_";

    showAddRepository: boolean = false;
    deleteDisabled: boolean = false;
    isSaving: boolean = false;

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
        this.repositoryForm.get('name').valueChanges.subscribe(name => {
            if (this.isAddingNew && this.tempNewRepository) {
                this.tempNewRepository.name = name || 'New repository';
                this.updateDisplayList();
            }
        });
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
        
        this.repositories$.subscribe(repos => {
            this.repositoriesList = repos;
            this.activeRepository = repos.find(r => r.enabled);
            this.updateDisplayList();
            
            if (this.isAddingNew && this.tempNewRepository) {
                const addedRepo = repos.find(r => r.name === this.tempNewRepository.name);
                if (addedRepo) {
                    this.isAddingNew = false;
                    this.tempNewRepository = null;
                    const index = this.displayList.indexOf(addedRepo);
                    this.setIndex(index);
                }
            }
        });
        
        if (this.repositoriesList.length > 0) {
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
        
        // Get the full URL with prefix for comparison
        const currentUrl = this.GITHUB_URL + (currentValues.url || '');
        const originalUrl = this.originalFormValues.url;
        
        // Check name change
        if (currentValues.name !== this.originalFormValues.name) {
            return true;
        }
        
        // Check URL change
        if (currentUrl !== originalUrl) {
            return true;
        }
        
        // Check access token change
        // Only consider it changed if there's a new non-empty value that's not the dummy token
        const hasNewToken = currentValues.accessToken && 
                           currentValues.accessToken !== '' && 
                           currentValues.accessToken !== this.DUMMY_ACCESS_TOKEN;
        if (hasNewToken) {
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

    onEditRepository(repository: Repository, index: number): void {
        if (this.isAddingNew && this.tempNewRepository && repository.id === this.tempNewRepository.id) {
            return;
        }

        const actualIndex = this.displayList.indexOf(repository);
        this.selectedRepositoryIndex = actualIndex;
        this.isAddingNew = false;
        this.tempNewRepository = null;
        
        const rep = { ...repository };
        rep.url = rep.url.replace(this.GITHUB_URL, '');
        
        // Store original values for change detection
        this.originalFormValues = {
            id: rep.id,
            name: rep.name,
            url: repository.url, // Keep full URL for comparison
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
            this.onEditRepository(repository, index);
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
        // this.alertService.warning("Changing the URL will reset the PAT token. If you don't enter the token again it will be deleted.");
        // const currentUrl = this.repositoryForm.get('url').value;
        // if (currentUrl && currentUrl.endsWith('/')) {
        //     const trimmedUrl = currentUrl.replace(/\/+$/, '');
        //     this.repositoryForm.patchValue({ url: trimmedUrl });
        // }
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
                this.alertService.success(result.message);
            } else {
                this.alertService.danger(result.message);
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
                
                if (hasFormModifications && hasEnabledChanges) {
                    // Both form and enabled status changed
                    // Update the repository details first
                    await this.updateRepository();
                    // Then save all enabled states
                    await this.repositoryService.saveAllRepositories();
                    this.repositoryService.updateHideInstalledFilter(this.hideInstalled);
                } else if (hasFormModifications) {
                    // Only form changed (name, url, token)
                    await this.updateRepository();
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
                            const revertValues = { ...this.originalFormValues };
                            revertValues.url = revertValues.url.replace(this.GITHUB_URL, '');
                            this.repositoryForm.patchValue(revertValues);
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
}