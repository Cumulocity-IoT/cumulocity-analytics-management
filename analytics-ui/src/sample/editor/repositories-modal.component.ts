import { Component, OnInit, Output, ViewEncapsulation } from "@angular/core";
import { FormBuilder, FormGroup, Validators } from "@angular/forms";
import { ModalLabels } from "@c8y/ngx-components";
import { Subject } from "rxjs";
import { Repository, uuidCustom } from "../../shared/analytics.model";
import { RepositoryService } from "./repository.service";

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
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let repository of repositories; let i = index">
            <td style="padding-top: 4px" width="15%">
              {{ i }}
            </td>
            <td style="padding-top: 4px" width="15%">
              {{ repository.name }}
            </td>
            <td style="padding-top: 4px" width="600%">
              {{ repository.url }}
            </td>
            <td width="10%" style="padding-top: 0px; padding-bottom: 0px">
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
    private fb: FormBuilder
  ) {
    this.repositoryForm = this.fb.group({
      id: [null],
      name: ["", Validators.required],
      url: ["", Validators.required],
      // Add any other form controls based on your repository model
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
      this.repositoryService.addRepository(newRepository);
      this.repositoryForm.reset();
    }
  }

  editRepository(repository: Repository): void {
    this.repositoryForm.patchValue(repository);
  }

  updateRepository(): void {
    if (this.repositoryForm.valid) {
      const updatedRepository: Repository = this.repositoryForm.value;
      this.repositoryService.updateRepository(updatedRepository);
      this.repositoryForm.reset();
    }
  }

  removeRepository(repositoryId: string): void {
    this.repositoryService.removeRepository(repositoryId);
  }

  onSave(event) {
    console.log("Save");
    this.closeSubject.next(this.repositories);
  }
}
