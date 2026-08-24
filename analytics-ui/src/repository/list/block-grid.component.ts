/*
 * Copyright (c) 2025 Cumulocity GmbH
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @authors Christof Strack
 */

import { Component, DestroyRef, OnInit, ViewChild, ViewEncapsulation, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ActionControl,
  AlertService,
  BulkActionControl,
  Column,
  ColumnDataType,
  CoreModule,
  DataGridComponent,
  Pagination,
} from '@c8y/ngx-components';
import { BsModalService } from 'ngx-bootstrap/modal';
import {
  BooleanRendererComponent,
  DESCRIPTOR_YAML,
  Repository,
  RepositoryItem,
  RepositoryService
} from '../../shared';
import { BehaviorSubject, distinctUntilChanged, map, Observable, shareReplay, switchMap, tap } from 'rxjs';
import { catchError, of } from 'rxjs';
import { ExtensionCreateComponent } from '../create-extension/extension-create-modal.component';
import { LabelRendererComponent } from '../../shared/renderer/label.renderer';
import { RepositoriesDrawerComponent } from '../repository/repositories-drawer.component';
import { ReleaseDeployWizardComponent } from '../release-deploy/release-deploy-wizard.component';
import { EditorModalComponent } from '../editor/editor-modal.component';
import { ExtensionLayoutHelpModalComponent } from './extension-layout-help-modal.component';
import { PopoverModule } from 'ngx-bootstrap/popover';

@Component({
  selector: 'a17t-sample-grid',
  templateUrl: 'block-grid.component.html',
  styleUrls: ['./block-grid.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [CommonModule, FormsModule, CoreModule, PopoverModule, RepositoriesDrawerComponent, ReleaseDeployWizardComponent]
})
export class BlockGridComponent implements OnInit {
  @ViewChild(DataGridComponent, { static: false }) dataGrid!: DataGridComponent;

  showConfigSample: boolean = false;
  hideInstalled: boolean = false;
  // Loading items from a repository (GitHub calls, FQN extraction, deployed-
  // blocks lookup) is comparatively expensive, so it's opt-in: off by
  // default, and persisted as a tenant option (see updateMode()) — not
  // localStorage — the same way repository config/PAT is stored.
  expertMode: boolean = false;
  loading: boolean = false;
  singleSelection: boolean = false;
  showDataGrid: boolean = true;
  showMonitorEditor: boolean = false;
  showConfigRepositories: boolean = false;
  showDeployRelease: boolean = false;

  activeRepository!: Repository;
  repositoryItems$!: Observable<RepositoryItem[]>;
  repositoryItems!: RepositoryItem[];

  actionControls: ActionControl[] = [];
  bulkActionControls: BulkActionControl[] = [];

  titleSample: string = 'Blocks from repositories';

  columnsSamples: Column[] = [
    {
      name: 'File',
      header: 'File',
      path: 'name',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: true,
    },
    {
      name: 'type',
      header: 'Type',
      path: 'type',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      cellRendererComponent: LabelRendererComponent,
      visible: true
    },
    {
      name: 'installed',
      header: 'Installed',
      path: 'installed',
      dataType: ColumnDataType.Icon,
      filterable: true,
      visible: true,
      cellRendererComponent: BooleanRendererComponent
    },
    {
      name: 'repositoryName',
      header: 'Repository Name',
      path: 'repositoryName',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: true
    },
    {
      name: 'repositoryId',
      header: 'Repository Id',
      path: 'repositoryId',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: false
    },
  ];

  pagination: Pagination = {
    pageSize: 3,
    currentPage: 1
  };

  private destroyRef = inject(DestroyRef);
  // Drives repositoryItems$ below — starts at the same `false` default as
  // `expertMode` so nothing is fetched until the persisted setting (or a
  // user toggle) says otherwise.
  private readonly expertMode$ = new BehaviorSubject<boolean>(false);

  constructor(
    public repositoryService: RepositoryService,
    public alertService: AlertService,
    private bsModalService: BsModalService
  ) {
    this.repositoryItems$ = this.expertMode$.pipe(
      switchMap(expertMode => expertMode
        ? this.repositoryService.getRepositoryItemsAnalyzed()
        : of([])
      ),
      shareReplay(1),
      tap(items => {
        const isYaml = items.some(item => item.file == DESCRIPTOR_YAML);
        // console.log("isYaml", isYaml, "current singleSelection:", this.singleSelection);

        const type = isYaml ? ' contains extensions.yaml ': ' list assets' ;
        this.titleSample = `Blocks from repositories (${type})`;
        this.singleSelection = false;
        // Only recreate the grid if the selection type actually changes
        // if (this.singleSelection !== isYaml) {
        //   //console.log("Selection type changed, recreating grid");
        //   this.showDataGrid = false;
        //   this.singleSelection = isYaml;

        //   // Recreate the grid on the next change detection cycle
        //   setTimeout(() => {
        //     this.showDataGrid = true;
        //   }, 0);
        // }
      })
    );
  }

  ngOnInit() {
    this.repositoryItems$?.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((samples) => (this.repositoryItems = samples));

    this.repositoryService.getExpertMode().then(expertMode => {
      this.expertMode = expertMode;
      this.expertMode$.next(expertMode);
    });

    this.bulkActionControls.push({
      type: 'CREATE',
      text: 'Create extension',
      icon: 'export',
      callback: this.createExtension.bind(this)
    });

    this.actionControls.push({
      text: 'View Source',
      type: 'VIEW',
      icon: 'document-with-code',
      showIf: (item) => item['type'] == 'file',
      callback: this.viewMonitor.bind(this)
    });

    this.initializeActiveRepository();
  }


  initializeActiveRepository(): void {
    // Subscribe to repositories$ to find and set the active repository

    this.repositoryService.getRepositories().pipe(
      // Transform the array to find the enabled repository
      map(repositories => repositories.find(repo => repo.enabled)),
      // Only emit when the enabled repository changes
      distinctUntilChanged((prev, curr) =>
        prev?.id === curr?.id && prev?.enabled === curr?.enabled
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(enabledRepository => {
      // Set the active repository
      this.activeRepository = enabledRepository || ({} as Repository);

      // You can perform additional actions here when active repository changes
      // console.log('Active repository changed:', this.activeRepository);
    });
  }

  viewMonitor(block: RepositoryItem) {
    const initialState = {
      source$: this.repositoryService.getRepositoryItemContent(
        block,
        false
      ).pipe(
        catchError(() => {
          this.alertService.danger(`Failed to load content for "${block.name}".`);
          return of('');
        })
      ),
      monitorName: block.name
    };
    this.bsModalService.show(EditorModalComponent, {
      class: 'modal-editor-wide',
      initialState,
      ariaDescribedby: 'modal-body',
      ariaLabelledBy: 'modal-title',
      ignoreBackdropClick: true
    }).content as EditorModalComponent;
  }


  checkSelection(ids: string[]) {
    const idSet = new Set(ids);
    const invalid: RepositoryItem[] = [];
    let hasInvalidType = false;
    this.repositoryItems.forEach((sample) => {
      if (!idSet.has(sample.id)) return;
      if (sample.installed) {
        this.alertService.warning(
          `Not allowed to deploy the block twice. Block ${sample.name} is already installed and will be ignored!`
        );
        invalid.push(sample);
        return;
      }
      if (sample.type == "file" && !sample.file.endsWith(".mon") && sample.file !== DESCRIPTOR_YAML) {
        invalid.push(sample);
        hasInvalidType = true;
      }
    });
    if (invalid.length > 0) {
      setTimeout(() => {
        this.dataGrid.setItemsSelected(invalid, false);
        if (hasInvalidType) {
          this.alertService.warning("Only files with extension '.mon', directories or 'expansions.yaml' are selectable!");
        }
      }, 0);
    }
  }

  async createExtension(ids: string[]) {
    const idSet = new Set(ids);
    const selectedSections: string[] = [];
    const selectedMonitors: RepositoryItem[] = [];
    this.repositoryItems.forEach((sample) => {
      if (idSet.has(sample.id) && !sample.installed) {
        if (sample.extensionsYamlItem) {
          selectedSections.push(sample.name);
          selectedMonitors[0] = sample.extensionsYamlItem;
        } else {
          selectedMonitors.push(sample);
        }
      }
    });

    // parse content of yaml file and return list of first level entries as string[], e.g. Python, Offset
    // Python:
    //   - plugin.yaml
    //   - Python.mon
    //   - pythonBlockPlugin.py
    //   - venv
    // Offset:
    //   - Offset.mon

    if (selectedSections.length > 0) {
      // Subscribe to the observable to process the data

      const initialState = {
        activeRepository: this.activeRepository,
        monitors: selectedMonitors,
        sections: selectedSections
      };

      const modalRef = this.bsModalService.show(ExtensionCreateComponent, {
        class: 'modal-md',
        initialState
      });

      if (modalRef.content) {
        modalRef.content.closeSubject.subscribe(() => {
          this.dataGrid.cancel()
          modalRef.hide()
        });
      }

    } else {
      const initialState = {
        activeRepository: this.activeRepository,
        monitors: selectedMonitors
      };

      const modalRef = this.bsModalService.show(ExtensionCreateComponent, {
        class: 'modal-md',
        initialState
      });

      if (modalRef.content) {
        modalRef.content.closeSubject.subscribe(() => {
          this.dataGrid.cancel()
          modalRef.hide()
        });
      }
    }
  }

  /**
 * Reload repository items (clears cache only)
 */
  reload(): void {
    this.repositoryService.reload();
  }

  /**
   * Reload repositories and items from backend
   */
  async reloadAll(): Promise<void> {
    this.loading = true;
    try {
      await this.repositoryService.reloadAll();
    } catch (error) {
      // Error already handled in service
      console.error('Failed to reload:', error);
    } finally {
      this.loading = false;
    }
  }

  async updateFilter() {
    this.repositoryService.updateHideInstalledFilter(this.hideInstalled);
  }

  /**
   * Toggling Expert mode on/off immediately gates whether `repositoryItems$`
   * loads anything (see the constructor); persisting is best-effort — a
   * failed save only logs, since the in-memory toggle already took effect
   * for this session.
   */
  async updateMode() {
    this.expertMode$.next(this.expertMode);
    try {
      await this.repositoryService.setExpertMode(this.expertMode);
    } catch (error) {
      console.error('Failed to persist Expert mode setting:', error);
    }
  }

  openRepositoriesDrawer(): void {
    this.showConfigRepositories = true;
  }

  deployFromRelease(): void {
    this.showDeployRelease = true;
  }

  onDeployReleaseCancel(): void {
    this.showDeployRelease = false;
  }

  onDeployReleaseCommit(): void {
    this.showDeployRelease = false;
    this.reload();
  }

  openLayoutHelp(): void {
    const modalRef = this.bsModalService.show(ExtensionLayoutHelpModalComponent, {
      class: 'modal-lg',
      ariaLabelledBy: 'modal-title',
      ignoreBackdropClick: false
    });
    modalRef.content?.closeSubject.subscribe(() => modalRef.hide());
  }

  onRepositoryCommit(): void {
    // console.log('Repository saved:', repository);
    this.showConfigRepositories = false;
    // Handle the saved repository
  }

  onRepositoryCancel(): void {
    this.showConfigRepositories = false;

  }
}
