import { Component, OnInit, Output, ViewEncapsulation } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { AlertService, ModalLabels } from "@c8y/ngx-components";
import { Subject } from "rxjs";
import { Repository } from "../../shared/analytics.model";
import { RepositoryService } from "../../shared/repository.service";
import { uuidCustom } from "../../shared/utils";
import { BsModalRef, BsModalService } from "ngx-bootstrap/modal";
import { ConfirmationModalComponent } from "../../component/confirmation-modal.component";

@Component({
  selector: "name-repositories-modal",
  styleUrls: ["../editor/editor-stepper.component.css"],
  templateUrl: "./repositories-modal.component.html",
  encapsulation: ViewEncapsulation.None,
})
export class RepositoriesModalComponent implements OnInit {
  repositories: Repository[];
  @Output() closeSubject: Subject<Repository[]> = new Subject();
  repositoryForm: FormGroup;

  labels: ModalLabels = { ok: "Save", cancel: "Cancel" };

  constructor(
    private repositoryService: RepositoryService,
    private fb: FormBuilder,
    private bsModalService: BsModalService,
    private alertService: AlertService
  ) {
    this.repositoryForm = this.fb.group({
      id: [null],
      name: ["", Validators.required],
      url: ["", Validators.required],
    });
  }

  ngOnInit(): void {
    this.repositoryService.getRepositories().subscribe((repositories) => {
      this.repositories = repositories;
    });
  }

  addRepository(): void {
    if (this.repositoryForm.valid) {
      const newRepository: Repository = this.repositoryForm.value;
      newRepository.id = uuidCustom();
      newRepository.enabled = true;
      this.repositoryService.addRepository(newRepository);
      this.repositoryForm.reset();
    }
  }

  editRepository(repository: Repository): void {
    this.repositoryForm.patchValue(repository);
  }

  toogleActivation(repository: Repository): void {
    repository.enabled = !repository.enabled;
    this.repositoryService.updateRepository(repository);
  }

  updateRepository(): void {
    if (this.repositoryForm.valid) {
      const updatedRepository: Repository = this.repositoryForm.value;
      this.repositoryService.updateRepository(updatedRepository);
      this.repositoryForm.reset();
    }
  }

  removeRepository(repositoryId: string): void {
    const initialState = {
      title: "Delete connector",
      message: "You are about to delete a repository. Do you want to proceed?",
      labels: {
        ok: "Delete",
        cancel: "Cancel",
      },
    };
    const confirmDeletionModalRef: BsModalRef = this.bsModalService.show(
      ConfirmationModalComponent,
      { initialState }
    );
    confirmDeletionModalRef.content.closeSubject.subscribe(
      async (result: boolean) => {
        //console.log("Confirmation delete result:", result);
        if (!!result) {
          try {
            this.repositoryService.removeRepository(repositoryId);
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

  onSave(event) {
    this.closeSubject.next(this.repositories);
  }

  onCancel(event) {
    this.closeSubject.next();
  }
}
