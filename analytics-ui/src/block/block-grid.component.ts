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

import {
  Component,
  EventEmitter,
  OnInit,
  ViewEncapsulation
} from '@angular/core';
import {
  ActionControl,
  AlertService,
  Column,
  ColumnDataType,
  Pagination
} from '@c8y/ngx-components';
import {
  AnalyticsService,
  BooleanRendererComponent,
  CEP_Block
} from '../shared';
import { LabelRendererComponent } from 'src/shared/renderer/label.renderer';

@Component({
  selector: 'a17t-block-grid',
  templateUrl: 'block-grid.component.html',
  styleUrls: ['./block-grid.component.css'],
  encapsulation: ViewEncapsulation.None,
  standalone: false
})
export class BlockGridComponent implements OnInit {
  loading: boolean = true;

  refresh: EventEmitter<any> = new EventEmitter<any>();

  blocks: CEP_Block[] = [];
  actionControls: ActionControl[] = [];

  titleBlock: string = 'Analytics Builder blocks';

  columnsBlocks: Column[] = [
    {
      name: 'name',
      header: 'Name',
      path: 'name',
      filterable: false,
      dataType: ColumnDataType.TextShort,
      gridTrackSize: '15%',
      visible: true
    },
    {
      header: 'Category',
      name: 'category',
      path: 'category',
      gridTrackSize: '10%',
      dataType: ColumnDataType.TextShort,
      cellRendererComponent: LabelRendererComponent,
      filterable: true
    },
    {
      header: 'Custom Block',
      name: 'custom',
      path: 'custom',
      gridTrackSize: '15%',
      filterable: true,
      dataType: ColumnDataType.TextShort,
      sortable: true,
      // cellCSSClassName: 'text-center',
      cellRendererComponent: BooleanRendererComponent
    },
    {
      header: 'Description',
      name: 'description',
      path: 'description',
      filterable: true,
      sortable: true
    },
    {
      header: 'Extension Name',
      name: 'extension',
      path: 'extension',
      gridTrackSize: '15%',
      cellRendererComponent: LabelRendererComponent,
      filterable: true,
      sortable: true
    }
  ];

  pagination: Pagination = {
    pageSize: 3,
    currentPage: 1
  };

  constructor(
    public analyticsService: AnalyticsService,
    public alertService: AlertService
  ) {}

  async ngOnInit() {
    await this.loadBlocks();
    this.refresh.subscribe(() => {
      this.loadBlocks();
    });
  }

  async loadBlocks() {
    this.loading = true;
    this.blocks = await this.analyticsService.getLoadedBlocksFromCEP();
    this.loading = false;
  }

}
