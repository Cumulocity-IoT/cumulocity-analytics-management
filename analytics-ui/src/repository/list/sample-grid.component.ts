/*
 * Copyright (c) 2022 Software AG, Darmstadt, Germany and/or Software AG USA Inc., Reston, VA, USA,
 * and/or its subsidiaries and/or its affiliates and/or their licensors.
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
  Pagination
} from '@c8y/ngx-components';
import { BsModalService } from 'ngx-bootstrap/modal';
import {
  BooleanRendererComponent,
  CEP_Block,
  Repository,
  RepositoryService
} from '../../shared';
import { EditorModalComponent } from '../editor/editor-modal.component';
import { RepositoriesModalComponent } from '../repository/repositories-modal.component';
import { LinkRendererComponent } from '../../shared/component/link-renderer.component';
import { catchError, distinctUntilChanged, filter, map, Observable, of, tap } from 'rxjs';
import { ExtensionCreateComponent } from '../create-extension/extension-create-modal.component';
import { LabelRendererComponent } from 'src/shared/renderer/label.renderer';
import * as jsyaml from 'js-yaml';

@Component({
  selector: 'a17t-sample-grid',
  templateUrl: 'sample-grid.component.html',
  styleUrls: ['./sample-grid.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class SampleGridComponent implements OnInit {
  @ViewChild('dataGrid', { static: false })
  dataGrid: DataGridComponent;
  showConfigSample: boolean = false;
  hideInstalled: boolean = false;
  loading: boolean = false;
  showMonitorEditor: boolean = false;
  activeRepository: Repository;
  samples$: Observable<CEP_Block[]>;
  samples: CEP_Block[];
  actionControls: ActionControl[] = [];
  bulkActionControls: BulkActionControl[] = [];

  titleSample: string = 'Blocks from repositories';

  columnsSamples: Column[] = [
    {
      name: 'File',
      header: 'File',
      path: 'url',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: true,
      cellRendererComponent: LinkRendererComponent
    },
    // {
    //   name: 'file',
    //   header: 'File',
    //   path: 'file',
    //   dataType: ColumnDataType.TextLong,
    //   filterable: true,
    //   visible: true
    // },
    {
      name: 'type',
      header: 'Type',
      path: 'type',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      cellRendererComponent: LabelRendererComponent,
      visible: true
    },
    // {
    //   name: 'name',
    //   header: 'Name',
    //   path: 'name',
    //   dataType: ColumnDataType.TextLong,
    //   filterable: true,
    //   visible: true
    // },
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
  ) { }

  ngOnInit() {
    this.samples$ = this.repositoryService.getCEP_BlockSamples();
    this.samples$?.subscribe((samples) => (this.samples = samples));
    this.bulkActionControls.push({
      type: 'CREATE',
      text: 'Create extension',
      icon: 'export',
      callback: this.createExtensionFromList.bind(this)
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

  viewMonitor(block: CEP_Block) {
    const initialState = {
      source$: this.repositoryService.getCEP_BlockContent(
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

  async updateRepositories() {
    const initialState = {};
    const modalRef = this.bsModalService.show(RepositoriesModalComponent, {
      class: 'modal-lg',
      initialState,
      ignoreBackdropClick: true
    });

    modalRef.content.closeSubject.subscribe(async (response) => {
      console.log('Repositories response after edit:', response);
      if (response) {
        this.activeRepository = response;
        await this.repositoryService.updateRepositories();
        this.repositoryService.updateCEP_BlockSamples(this.hideInstalled);
      } else {
        this.repositoryService.cancelChanges();
      }
    });
  }

  checkSelection(ids: string[]) {
    // console.log("Selected items", ids);
    let errorSelection = false;
    let errorItem;
    this.samples.forEach((sample) => {
      if (ids.includes(sample.id) && sample.installed) {
        this.alertService.warning(
          `Not allowed to deploy the block twice. Block ${sample.name} is already installed and will be ignored!`
        );
        errorSelection = true;
        errorItem = sample;
      }
      if (ids.includes(sample.id) && sample.type == "file") {
        if (!sample.file.endsWith(".mon") && sample.file !== "extensions.yaml") {
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

  async createExtensionFromList(ids: string[]) {
    const monitors = [];
    this.samples.forEach((sample) => {
      if (ids.includes(sample.id) && !sample.installed) {
        monitors.push(sample);
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

    if (this.samples[0].file === 'extensions.yaml') {
      let extensionNames;
      const source$ = this.repositoryService.getCEP_BlockContent(
        this.samples[0],
        true,
        false
      ).pipe(
        // Parse content of YAML file and return list of first level entries as string[]
        map(content => {
          try {
            // Parse the YAML content
            const yamlContent = jsyaml.load(content);

            // Extract the first level keys (extension names)
            if (yamlContent && typeof yamlContent === 'object') {
              return Object.keys(yamlContent);
            } else {
              console.warn('Invalid YAML content structure in extensions.yaml');
              return [];
            }
          } catch (error) {
            console.error('Error parsing extensions.yaml content:', error);
            return [];
          }
        }),
        tap(exN => {
          console.log('Available extensions:', extensionNames);
          // You can store the result in a class property if needed
          extensionNames = exN;
        }),
        catchError(error => {
          console.error('Error processing extensions.yaml:', error);
          return of([]);  // Return empty array in case of error
        })
      );

      // Subscribe to the observable to process the data
      source$.subscribe(extensionNames => {
        const initialState = {
          activeRepository: this.activeRepository,
          extensionNames
        };
  
        const modalRef = this.bsModalService.show(ExtensionCreateComponent, {
          class: 'modal-lg',
          initialState
        });
  
        modalRef.content.closeSubject.subscribe(() => {
          this.dataGrid.cancel()
          modalRef.hide()
        });
      });
    } else {
      const initialState = {
        activeRepository: this.activeRepository,
        monitors
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


  async createExtensionFromRepository() {
    const initialState = {
      activeRepository: this.activeRepository
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

  async loadSamples() {
    this.repositoryService.updateCEP_BlockSamples(this.hideInstalled);
  }

}
