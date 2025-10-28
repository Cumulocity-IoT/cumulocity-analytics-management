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
    displayList: Repository[] = []; // For display including temporary items
    filteredDisplayList: Repository[] = []; // Filtered list based on search
    activeRepository: Repository;
    repositoryForm: FormGroup;
    selectedRepositoryIndex: number = -1;
    isAddingNew: boolean = false;
    tempNewRepository: Repository | null = null;
    searchTerm: string = ''; // Search term

    // popupPAT = `Enter Personal Access Token (PAT) created <a href="https://github.com/settings/tokens/new" target="_blank">here</a>. Select the scope <code>public_repo</code> and enable SSO for the token!`;
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
        
        // Subscribe to repository changes and update local list
        this.repositories$.subscribe(repos => {
            this.repositoriesList = repos;
            this.activeRepository = repos.find(r => r.enabled);
            this.updateDisplayList();
            
            // If we just added a new repository, select it
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
        
        // Select first repository if available
        if (this.repositoriesList.length > 0) {
            this.setIndex(0);
        } else {
            // If no repositories, show the add form
            this.createCustomRepository();
        }
    }

    /**
     * Update the display list with real repositories + temporary new one if adding
     */
    private updateDisplayList(): void {
        if (this.isAddingNew && this.tempNewRepository) {
            this.displayList = [...this.repositoriesList, this.tempNewRepository];
        } else {
            this.displayList = [...this.repositoriesList];
        }
        
        // Apply search filter
        this.applySearchFilter();
    }

    /**
     * Apply search filter to the display list
     */
    private applySearchFilter(): void {
        if (!this.searchTerm || this.searchTerm.trim() === '') {
            this.filteredDisplayList = [...this.displayList];
        } else {
            const searchLower = this.searchTerm.toLowerCase().trim();
            this.filteredDisplayList = this.displayList.filter(repo => {
                // Search in name, url, and id
                return repo.name?.toLowerCase().includes(searchLower) ||
                       repo.url?.toLowerCase().includes(searchLower) ||
                       repo.id?.toLowerCase().includes(searchLower);
            });
        }
    }

    /**
     * Search/filter repositories based on input
     * Called on keyup event in the search input
     */
    searchRepositories(event?: Event): void {
        if (event) {
            const target = event.target as HTMLInputElement;
            this.searchTerm = target.value;
        }
        
        this.applySearchFilter();
    }

    /**
     * Clear the search filter
     */
    clearSearch(): void {
        this.searchTerm = '';
        this.applySearchFilter();
    }

    get isSaveDisabled(): boolean {
        if (this.isAddingNew) {
            return this.repositoryForm.invalid || this.isSaving;
        }
        
        return this.repositoryForm.invalid || 
               (this.isSaving) ||
               (!this.repositoryService.hasUnsavedEnabledChanges() && this.selectedRepositoryIndex !== -1);
    }

    get hasUnsavedChanges(): boolean {
        return this.repositoryService.hasUnsavedEnabledChanges();
    }

    onEditRepository(repository: Repository, index: number): void {
        // Check if this is the temporary repository
        if (this.isAddingNew && this.tempNewRepository && repository.id === this.tempNewRepository.id) {
            // Already in add mode, just keep the form
            return;
        }

        // Find the actual index in displayList (not filteredDisplayList)
        const actualIndex = this.displayList.indexOf(repository);
        this.selectedRepositoryIndex = actualIndex;
        this.isAddingNew = false;
        this.tempNewRepository = null;
        
        const rep = { ...repository };
        rep.url = rep.url.replace(this.GITHUB_URL, '');
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
        this.repositoryForm.reset();
        this.updateDisplayList();
    }

    /**
     * Switch to "Add New Repository" mode
     * Creates a temporary placeholder in the list
     */
    createCustomRepository(): void {
        this.resetForm();
        this.selectedRepositoryIndex = -1;
        this.isAddingNew = true;
        this.showAddRepository = true;
        this.deleteDisabled = true;
        
        // Create temporary repository for display
        this.tempNewRepository = {
            id: 'temp-' + uuidCustom(),
            name: 'New repository',
            url: '',
            enabled: false
        } as Repository;
        
        this.updateDisplayList();
        
        // Select the temporary repository (last in list)
        this.selectedRepositoryIndex = this.displayList.length - 1;
    }

    warnAboutPATReset(): void {
        this.alertService.warning("Changing the URL will reset the PAT token. If you don't enter the token again it will be deleted.");
        const currentUrl = this.repositoryForm.get('url').value;
        if (currentUrl && currentUrl.endsWith('/')) {
            const trimmedUrl = currentUrl.replace(/\/+$/, '');
            this.repositoryForm.patchValue({ url: trimmedUrl });
        }
    }

    /**
     * Actually add the repository to the backend
     */
    private async addRepository(): Promise<void> {
        if (this.repositoryForm.valid) {
            const newRepository: Repository = this.repositoryForm.value;
            newRepository.url = this.GITHUB_URL + this.repositoryForm.value.url;
            newRepository.id = uuidCustom();
            newRepository.enabled = false;
            
            await this.repositoryService.addRepository(newRepository);
            
            // The subscription will handle updating the UI and selecting the new repo
            this.repositoryService.updateRepositoryItems(this.hideInstalled);
        }
    }

    /**
     * Toggle repository enabled status - LOCAL ONLY
     */
    toggleActivation(repository: Repository): void {
        // Don't allow toggling the temporary repository
        if (this.isAddingNew && this.tempNewRepository && repository.id === this.tempNewRepository.id) {
            return;
        }

        this.repositoryService.toggleRepositoryEnabled(repository.id);
        
        if (!repository.enabled) {
            this.activeRepository = repository;
        }
    }

    /**
     * Actually update the repository in the backend
     */
    private async updateRepository(): Promise<void> {
        if (this.repositoryForm.valid) {
            const updatedRepository: Repository = this.repositoryForm.value;
            updatedRepository.url = this.GITHUB_URL + updatedRepository.url;
            
            await this.repositoryService.updateRepository(updatedRepository);
            
            this.repositoryService.updateRepositoryItems(this.hideInstalled);
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
                        
                        this.repositoryService.updateRepositoryItems(this.hideInstalled);
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
                await this.addRepository();
            } else if (this.selectedRepositoryIndex !== -1) {
                const currentRepo = this.displayList[this.selectedRepositoryIndex];
                const actualRepo = this.repositoriesList.find(r => r.id === currentRepo.id);
                
                if (actualRepo) {
                    const formValue = this.repositoryForm.value;
                    const formUrl = this.GITHUB_URL + formValue.url;
                    
                    const hasFormChanges = 
                        actualRepo.name !== formValue.name ||
                        actualRepo.url !== formUrl ||
                        (formValue.accessToken && formValue.accessToken !== '' && formValue.accessToken !== this.DUMMY_ACCESS_TOKEN);
                    
                    if (hasFormChanges) {
                        await this.updateRepository();
                    } else if (this.hasUnsavedChanges) {
                        await this.repositoryService.saveAllRepositories();
                        this.repositoryService.updateRepositoryItems(this.hideInstalled);
                    }
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
            // Remove temporary repository and go back
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
                message: 'You have unsaved changes to repository enabled status. Do you want to discard these changes?',
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
                        this.repositoryService.cancelEnabledChanges();
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
    }
}