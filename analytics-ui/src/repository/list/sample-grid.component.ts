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
import { BehaviorSubject, Observable } from 'rxjs';
import { switchMap, tap } from 'rxjs/operators';
import {
  AnalyticsService,
  BooleanRendererComponent,
  CEP_Block,
  ExtensionCreateComponent,
  RepositoryService
} from '../../shared';
import { EditorModalComponent } from '../editor/editor-modal.component';
import { RepositoriesModalComponent } from '../repository/repositories-modal.component';
import { LinkRendererComponent } from '../../shared/component/link-renderer.component';

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
  reload$: BehaviorSubject<void> = new BehaviorSubject(null);
  loading: boolean = false;
  showMonitorEditor: boolean = false;
  samples$: Observable<CEP_Block[]>;
  samples: CEP_Block[];
  actionControls: ActionControl[] = [];
  bulkActionControls: BulkActionControl[] = [];

  titleSample: string = 'Blocks from repositories';

  columnsSamples: Column[] = [
    {
      name: 'name',
      header: 'Name',
      path: 'name',
      dataType: ColumnDataType.TextLong,
      filterable: true,
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
      visible: true
    },
    {
      name: 'url',
      header: 'Link Github',
      path: 'url',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: true,
      cellRendererComponent: LinkRendererComponent
    }
  ];

  pagination: Pagination = {
    pageSize: 3,
    currentPage: 1
  };

  constructor(
    public analyticsService: AnalyticsService,
    public repositoryService: RepositoryService,
    public alertService: AlertService,
    private bsModalService: BsModalService
  ) {}

  async ngOnInit() {
    this.samples$ = this.reload$.pipe(
      tap(() => (this.loading = true)),
      switchMap(() =>
        this.repositoryService.getAll_CEP_BlockSamples(this.hideInstalled)
      ),
      tap(() => (this.loading = false))
    );
    this.samples$.subscribe((samples) => (this.samples = samples));
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
      callback: this.viewMonitor.bind(this)
    });
  }

  async viewMonitor(block: CEP_Block) {
    let source;
    try {
      source = await this.repositoryService.getCEP_BlockContent(
        block,
        true,
        false
      );
    } catch (error) {
      console.log('Something happened:', error);
    }
    const initialState = {
      source: source,
      monitor: block.name
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

    modalRef.content.closeSubject.subscribe(async (repositories) => {
      console.log('Repositories after edit:', repositories);
      if (repositories) {
        await this.repositoryService.saveRepositories(repositories);
      }
    });
  }

  checkSelection(ids: string[]) {
    this.samples.forEach((sample) => {
      if (ids.includes(sample.id) && sample.installed) {
        this.alertService.warning(
          `Not allowed to deploy the block twice. Block ${sample.name} is already installed and will be ignored!`
        );
        // does not work and results in loops
        // this.dataGrid.setItemsSelected([], true);
        // this.dataGrid.setAllItemsSelected(false)
      }
    });
  }

  async createExtension(ids: string[]) {
    const monitors = [];
    this.samples.forEach((sample) => {
      if (ids.includes(sample.id) && !sample.installed) {
        monitors.push(sample);
      }
    });
    const initialState = {
      monitors
    };

    const modalRef = this.bsModalService.show(ExtensionCreateComponent, {
      class: 'modal-lg',
      initialState
    });

    modalRef.content.closeSubject.subscribe(() => modalRef.hide());
  }

  async loadSamples() {
    this.reload$.next();
  }
}
