import { Component, OnInit, Output, ViewEncapsulation } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { AlertService, ModalLabels } from "@c8y/ngx-components";
import { Subject } from "rxjs";
import { Repository } from "../../shared/analytics.model";
import { RepositoryService } from "../../shared/repository.service";
import { uuidCustom } from "../../shared/utils";
import { BsModalRef, BsModalService } from "ngx-bootstrap/modal";
import { ConfirmationModalComponent } from "../../component/confirmation-modal.component";
import { AlarmService } from "@c8y/client";

@Component({
  selector: "name-repositories-modal",
  styleUrls: ["./editor-stepper.component.css"],
  template: `<c8y-modal
    title="Show repositories for blocks"
    (onClose)="onSave($event)"
    [labels]="labels"
    [headerClasses]="'modal-header dialog-header'"
  >
    <div>
      <table class="table table-striped">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Url</th>
            <th>Enabled</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let repository of repositories; let i = index">
            <td style="padding-top: 4px" width="5%">
              {{ i }}
            </td>
            <td style="padding-top: 4px" width="15%">
              {{ repository.name }}
            </td>
            <td style="padding-top: 4px" width="65%">
              {{ repository.url }}
            </td>
            <td style="padding-top: 8px" width="5%">
              <!-- <i
                style="text-align: center; width: 100%"
                [c8yIcon]="!repository?.enabled ? 'circle-o' : 'plus-circle-o'"
                class="m-r-5"
              ></i> -->
              <button
                title="{{ 'Toggle Activation' | translate }}"
                class="btn btn-icon btn-clean"
                (click)="toogleActivation(repository)"
              >
                <i
                  [c8yIcon]="!repository?.enabled ? 'toggle-off' : 'toggle-on'"
                  class="m-r-5"
                  c8yIcon="toggle-on"
                  class="text-danger"
                ></i>
                <span class="sr-only" translate>Toogle activation</span>
              </button>
            </td>
            <!-- <td width="10%" style="padding-top: 0px; padding-bottom: 0px"> -->
            <td width="10%" style="padding-top: 8px;">
              <button
                title="{{ 'Update' | translate }}"
                class="btn btn-icon btn-clean p-r-4"
                (click)="editRepository(repository)"
              >
                <i c8yIcon="pencil" class="text-danger"></i>
                <span class="sr-only" translate>Update controller</span>
              </button>
              <button
                title="{{ 'Remove' | translate }}"
                class="btn btn-icon btn-clean"
                (click)="removeRepository(repository.id)"
              >
                <i c8yIcon="trash-o" class="text-danger"></i>
                <span class="sr-only" translate>Remove</span>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="legend form-block">Update Repository</div>
    <form [formGroup]="repositoryForm">
      <input type="hidden" formControlName="id" />
      <c8y-form-group>
        <label for="name">Name</label>
        <input
          type="text"
          id="name"
          formControlName="name"
          class="form-control"
        />
      </c8y-form-group>
      <c8y-form-group>
        <label for="name">Url</label>
        <input
          type="text"
          id="url"
          formControlName="url"
          placeholder="use form: https://api.github.com/repos/{REPO_SAMPLES_OWNER}/{REPO_SAMPLES_NAME}/contents/{REPO_SAMPLES_PATH}"
          class="form-control"
        />
      </c8y-form-group>
      <!-- Add any other form controls based on your repository model -->
      <button (click)="addRepository()" class="btn btn-default">
        Add Repository
      </button>
      <button (click)="updateRepository()" class="btn btn-default">
        Update Repository
      </button>
    </form>
  </c8y-modal>`,
  encapsulation: ViewEncapsulation.None,
})
export class RepositoriesModalComponent implements OnInit {
  repositories: Repository[];
  @Output() closeSubject: Subject<Repository[]> = new Subject();
  repositoryForm: FormGroup;

  labels: ModalLabels = { ok: "Close" };

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
    console.log("Save");
    this.closeSubject.next(this.repositories);
  }
}
