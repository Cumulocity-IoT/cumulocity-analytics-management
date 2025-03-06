import { Component, OnDestroy, OnInit, Output, ViewEncapsulation } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { AlertService, ModalLabels } from '@c8y/ngx-components';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { map, Observable, Subject, take } from 'rxjs';
import {
  ConfirmationModalComponent,
  Repository,
  RepositoryService,
  uuidCustom
} from '../../shared';

@Component({
  selector: 'a17t-name-repositories-modal',
  styleUrls: ['../editor/editor-modal.component.css'],
  templateUrl: './repositories-modal.component.html',
  encapsulation: ViewEncapsulation.None
})
export class RepositoriesModalComponent implements OnInit {
  repositories$: Observable<Repository[]>;
  activeRepository: Repository;
  closeSubject: Subject<Repository> = new Subject();
  repositoryForm: FormGroup;
  subscription: any;
  selectedRepositoryIndex: number = -1;
  saveRequired: boolean = false;
  labels: ModalLabels = { ok: 'Save', cancel: 'Cancel' };
  popupPAT = `Enter Personal Access Token (PAT) created <a href="https://github.com/settings/tokens/new" target="_blank">here</a>. Select the scope <code>public_repo</code> and enable SSO for the token!`;
  popRepositoryUrl = `Enter the last parts to a github repository. If no branch name is given, the default branch <code>main</code> is assumed.`;
  GITHUB_API = 'https://api.github.com/repos/';
  GITHUB_URL = 'https://github.com/';
  DUMMY_ACCESS_TOKEN = "_DUMMY_ACCESS_CODE_";

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
    });
  }

  // Custom validator function

  // Arrow function preserves 'this'
  urlValidator = (control: AbstractControl): ValidationErrors | null => {
    try {
      const url = this.GITHUB_URL + control.value;
      new URL(url);
      return null;
    } catch (e) {
      return { invalidUrl: true };
    }
  }

  ngOnInit(): void {
    this.repositories$ = this.repositoryService.getRepositories();
  }

  warnAboutPATReset(): void {
    this.alertService.warning("Changing the URL will reset the PAT token. If you don't enter the token again it will be deleted.")
  }

  addRepository(): void {
    if (this.repositoryForm.valid) {
      const newRepository: Repository = this.repositoryForm.value;
      newRepository.url = this.GITHUB_URL + this.repositoryForm.value.url;
      newRepository.id = uuidCustom();
      newRepository.enabled = true;
      this.repositoryService.addRepository(newRepository);
      this.saveRequired = true;
      this.repositoryForm.reset();
    }
  }

  editRepository(repository: Repository, index: number): void {
    this.selectedRepositoryIndex = index;
    const r = { ...repository };
    r.url = r.url.replace(this.GITHUB_URL, '');
    this.repositoryForm.patchValue(r);
  }

  toggleActivation(repository: Repository): void {
    // Get the current value of repositories$ and update all repositories
    this.repositories$.pipe(
      take(1)  // Take only the current value
    ).subscribe(repositories => {
      // Process all repositories
      repositories.forEach(repo => {
        if (repo.id === repository.id) {
          // Toggle enabled for the selected repository
          const updatedRepo = {
            ...repo,
            enabled: !repo.enabled
          };
          if (updatedRepo.enabled)
            this.activeRepository = updatedRepo;
          // Update the toggled repository
          this.repositoryService.updateRepository(updatedRepo);
        } else if (repo.enabled) {
          // Only update repositories that are currently enabled
          const updatedRepo = {
            ...repo,
            enabled: false
          };
          // Update other repositories to disabled
          this.repositoryService.updateRepository(updatedRepo);
        }
        // No need to update repositories that are already disabled
      });

      // Set the save required flag
      this.saveRequired = true;
    });
  }

  updateRepository(): void {
    if (this.repositoryForm.valid) {
      const updatedRepository: Repository = this.repositoryForm.value;
      updatedRepository.url = this.GITHUB_URL + updatedRepository.url;
      this.repositoryService.updateRepository(updatedRepository);
      this.saveRequired = true;
      this.repositoryForm.reset();
    }
  }

  async testRepository(): Promise<void> {
    if (this.repositoryForm.valid) {
      const testedRepository: Repository = { ... this.repositoryForm.value };
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
    const initialState = {
      title: 'Delete repository',
      message: `You are about to delete the repository ${repositoryId}. Do you want to proceed?`,
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
        console.log('Confirmation delete result:', result);
        if (result) {
          try {
            this.repositoryService.deleteRepository(repositoryId);
            this.saveRequired = true;
          } catch (ex) {
            if (ex) {
              this.alertService.addServerFailure(ex);
            }
          }
        }
        confirmDeletionModalRef.hide();
      }
    );
  }

  onSave() {
    this.closeSubject.next(this.activeRepository);
    this.closeSubject.complete();
  }

  onCancel() {
    this.closeSubject.next(undefined);
    this.closeSubject.complete();
  }

  resetForm() {
    this.repositoryForm.reset();
    this.selectedRepositoryIndex = -1;
  }
}
