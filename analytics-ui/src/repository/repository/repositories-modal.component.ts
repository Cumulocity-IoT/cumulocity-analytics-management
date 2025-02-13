import { Component, OnDestroy, OnInit, Output, ViewEncapsulation } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { AlertService, ModalLabels } from '@c8y/ngx-components';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { Observable, Subject } from 'rxjs';
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
  closeSubject: Subject<boolean> = new Subject();
  repositoryForm: FormGroup;
  subscription: any;
  selectedRepositoryIndex: number = -1;
  saveRequired: boolean = false;
  labels: ModalLabels = { ok: 'Save', cancel: 'Cancel' };
  popup = `Enter Personal Access Token (PAT) created <a href="https://github.com/settings/tokens/new" target="_blank">here</a>. Select the scope <code>public_repo</code> and enable SSO for the token!`;
  static readonly GITHUB_API = 'https://api.github.com/repos/';
  DUMMY_ACCESS_TOKEN = "_DUMMY_ACCESS_CODE_";


  constructor(
    private repositoryService: RepositoryService,
    private fb: FormBuilder,
    private bsModalService: BsModalService,
    private alertService: AlertService
  ) {
    this.repositoryForm = this.fb.group({
      id: [null],
      name: ['', Validators.required],
      url: ['', [Validators.required, this.urlValidator]],
      accessToken: [''],
    });
  }

  // Custom validator function

  urlValidator(control: AbstractControl): ValidationErrors | null {
    try {
      const url = RepositoriesModalComponent.GITHUB_API + control.value;
      new URL(url);
      return null;
    } catch (e) {
      return { invalidUrl: true };
    }
  }

  ngOnInit(): void {
    this.repositories$ = this.repositoryService.getRepositories();
  }

  addRepository(): void {
    if (this.repositoryForm.valid) {
      const newRepository: Repository = this.repositoryForm.value;
      newRepository.url = RepositoriesModalComponent.GITHUB_API + this.repositoryForm.value.url;
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
    r.url = r.url.replace(RepositoriesModalComponent.GITHUB_API, '');
    this.repositoryForm.patchValue(r);
  }

  toggleActivation(repository: Repository): void {
    repository.enabled = !repository.enabled;
    this.saveRequired = true;
    this.repositoryService.updateRepository(repository);
  }

  updateRepository(): void {
    if (this.repositoryForm.valid) {
      const updatedRepository: Repository = this.repositoryForm.value;
      this.repositoryService.updateRepository(updatedRepository);
      this.saveRequired = true;
      this.repositoryForm.reset();
    }
  }

  async testRepository(repository: Repository): Promise<void> {
    if (this.repositoryForm.valid) {
      const testedRepository: Repository = {... this.repositoryForm.value};
      testedRepository.url = RepositoriesModalComponent.GITHUB_API + testedRepository.url;
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
    this.closeSubject.next(true);
    this.closeSubject.complete();
  }

  onCancel() {
    this.closeSubject.next(false);
    this.closeSubject.complete();
  }

  resetForm() {
    this.repositoryForm.reset();
    this.selectedRepositoryIndex = -1;
  }
}
