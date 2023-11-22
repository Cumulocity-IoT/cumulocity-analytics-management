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
import {
  Component,
  OnInit,
  ViewEncapsulation,
} from "@angular/core";
import {
  ActionControl,
  AlertService,
  Column,
  ColumnDataType,
  Pagination,
} from "@c8y/ngx-components";
import { BsModalService } from "ngx-bootstrap/modal";
import { AnalyticsService } from "../../shared/analytics.service";
import { CEP_Block } from "../../shared/analytics.model";

@Component({
  selector: "c8y-block-grid",
  templateUrl: "block.component.html",
  encapsulation: ViewEncapsulation.None,
})
export class BlockGridComponent implements OnInit {

  showConfigBlock: boolean = false;

  blocks: CEP_Block[] = [];
  actionControls: ActionControl[] = [];

  titleBlock: string = "AnalyticsBuilder Blocks";

  columnsBlocks: Column[] = [
    {
      name: "name",
      header: "Name",
      path: "name",
      filterable: false,
      dataType: ColumnDataType.TextShort,
      gridTrackSize: '15%',
      visible: true,
    },
    {
      header: "Category",
      name: "category",
      path: "category",
      gridTrackSize: '10%',
      dataType: ColumnDataType.TextShort,
      filterable: true,
    },
    {
      header: "Custom Block",
      name: "custom",
      path: "custom",
      gridTrackSize: '10%',
      filterable: true,
      dataType: ColumnDataType.TextShort,
      sortable: true,
    },
    {
      header: "Description",
      name: "description",
      path: "description",
      filterable: true,
      sortable: true,
    },
  ];

  pagination: Pagination = {
    pageSize: 3,
    currentPage: 1,
  };

  constructor(
    public analyticsService: AnalyticsService,
    public alertService: AlertService,
    private bsModalService: BsModalService
  ) {}

  async ngOnInit() {
    await this.loadBlocks();
  }
  
  async  loadBlocks() {
    this.blocks = await this.analyticsService.getBlocks();
  }
  
  ngOnDestroy() {
  }
}
