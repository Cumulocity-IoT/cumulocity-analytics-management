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

import { Component, OnInit, ViewChild, ViewEncapsulation } from '@angular/core';
import {
  ActionControl,
  AlertService,
  BulkActionControl,
  Column,
  ColumnDataType,
  DataGridComponent,
  Pagination,
} from '@c8y/ngx-components';
import { BsModalService } from 'ngx-bootstrap/modal';
import {
  BooleanRendererComponent,
  CepBlock,
  DESCRIPTOR_YAML,
  Repository,
  RepositoryItem,
  RepositoryService
} from '../../shared';
import { EditorModalComponent } from '../editor/editor-modal.component';
import { distinctUntilChanged, map, Observable, shareReplay, tap } from 'rxjs';
import { ExtensionCreateComponent } from '../create-extension/extension-create-modal.component';
import { LabelRendererComponent } from '../../shared/renderer/label.renderer';

@Component({
  selector: 'a17t-sample-grid',
  templateUrl: 'block-grid.component.html',
  styleUrls: ['./block-grid.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: false
})
export class BlockGridComponent implements OnInit {
  @ViewChild('dataGrid', { static: false })
  dataGrid: DataGridComponent;

  showConfigSample: boolean = false;
  hideInstalled: boolean = false;
  loading: boolean = false;
  singleSelection: boolean = false;
  showDataGrid: boolean = true;
  showMonitorEditor: boolean = false;
  showConfigRepositories: boolean = false;

  activeRepository: Repository;
  repositoryItems$: Observable<RepositoryItem[]>;
  repositoryItems: RepositoryItem[];

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

  constructor(
    public repositoryService: RepositoryService,
    public alertService: AlertService,
    private bsModalService: BsModalService
  ) {
    this.repositoryItems$ = this.repositoryService.getRepositoryItemsAnalyzed().pipe(
      shareReplay(1),
      tap(items => {
        const isYaml = items.some(item => item.file == DESCRIPTOR_YAML);
        // console.log("isYaml", isYaml, "current singleSelection:", this.singleSelection);

        const type = isYaml ? ' list assets' : ' contains extensions.yaml ';
        this.titleSample = `Blocks from repositories (${type})`;
        // Only recreate the grid if the selection type actually changes
        if (this.singleSelection !== isYaml) {
          //console.log("Selection type changed, recreating grid");
          this.showDataGrid = false;
          this.singleSelection = isYaml;

          // Recreate the grid on the next change detection cycle
          setTimeout(() => {
            this.showDataGrid = true;
          }, 0);
        }
      })
    );
  }

  ngOnInit() {
    this.repositoryItems$?.subscribe((samples) => (this.repositoryItems = samples));
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
      )
    ).subscribe(enabledRepository => {
      // Set the active repository
      this.activeRepository = enabledRepository || null;

      // You can perform additional actions here when active repository changes
      // console.log('Active repository changed:', this.activeRepository);
    });
  }

  viewMonitor(block: CepBlock) {
    const initialState = {
      source$: this.repositoryService.getRepositoryItemContent(
        block,
        true,
        false
      ),
      monitorName: block.name
    };
    this.bsModalService.show(EditorModalComponent, {
      class: 'modal-lg',
      initialState,
      ariaDescribedby: 'modal-body',
      ariaLabelledBy: 'modal-title',
      ignoreBackdropClick: true
    }).content as EditorModalComponent;
  }


  checkSelection(ids: string[]) {
    // console.log("Selected items", ids);
    let errorSelection = false;
    let errorItem;
    this.repositoryItems.forEach((sample) => {
      if (ids.includes(sample.id) && sample.installed) {
        this.alertService.warning(
          `Not allowed to deploy the block twice. Block ${sample.name} is already installed and will be ignored!`
        );
        errorSelection = true;
        errorItem = sample;
      }
      if (ids.includes(sample.id) && sample.type == "file") {
        if (!sample.file.endsWith(".mon") && sample.file !== DESCRIPTOR_YAML) {
          errorSelection = true;
          errorItem = sample;
        }
      }
    });
    if (errorSelection) {
      setTimeout(() => {
        this.dataGrid.setItemsSelected([errorItem], false);
        this.alertService.warning("Only files with extension '.mon', directories or 'expansions.yaml' are selectable!")
      }, 0);
    }
  }

  async createExtension(ids: string[]) {
    const selectedSections: string[] = [];
    const selectedMonitors: RepositoryItem[] = [];
    this.repositoryItems.forEach((sample) => {
      if (ids.includes(sample.id) && !sample.installed) {
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
        class: 'modal-lg',
        initialState
      });

      modalRef.content.closeSubject.subscribe(() => {
        this.dataGrid.cancel()
        modalRef.hide()
      });

    } else {
      const initialState = {
        activeRepository: this.activeRepository,
        monitors: selectedMonitors
      };

      const modalRef = this.bsModalService.show(ExtensionCreateComponent, {
        class: 'modal-lg',
        initialState
      });

      modalRef.content.closeSubject.subscribe(() => {
        this.dataGrid.cancel()
        modalRef.hide()
      });
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

  openRepositoriesDrawer(): void {
    this.showConfigRepositories = true;
  }

  onRepositoryCommit(repository: Repository): void {
    // console.log('Repository saved:', repository);
    this.showConfigRepositories = false;
    // Handle the saved repository
  }

  onRepositoryCancel(): void {
    this.showConfigRepositories = false;

  }
}
