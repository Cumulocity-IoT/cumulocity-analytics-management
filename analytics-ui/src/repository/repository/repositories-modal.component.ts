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
      new URL(control.value);
      return null;
    } catch {
      return { invalidUrl: true };
    }
  }

  ngOnInit(): void {
    this.repositories$ = this.repositoryService.getRepositories();
  }

  addRepository(): void {
    if (this.repositoryForm.valid) {
      const newRepository: Repository = this.repositoryForm.value;
      newRepository.id = uuidCustom();
      newRepository.enabled = true;
      this.repositoryService.addRepository(newRepository);
      this.saveRequired = true;
      this.repositoryForm.reset();
    }
  }

  editRepository(repository: Repository, index: number): void {
    this.selectedRepositoryIndex = index;
    this.repositoryForm.patchValue(repository);
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
