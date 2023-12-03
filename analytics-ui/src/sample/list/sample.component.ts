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
  EventEmitter,
  OnInit,
  ViewEncapsulation,
} from "@angular/core";
import {
  ActionControl,
  AlertService,
  BulkActionControl,
  Column,
  ColumnDataType,
  Pagination,
} from "@c8y/ngx-components";
import { AnalyticsService } from "../../shared/analytics.service";
import { CEP_Block } from "../../shared/analytics.model";
import { BsModalService } from "ngx-bootstrap/modal";
import { CreateExtensionComponent } from "../../wizard/create-extension-modal.component";
import { EditorModalComponent } from "../editor/editor-modal.component";
import { RepositoriesModalComponent } from "../editor/repositories-modal.component";
import { RepositoryService } from "../editor/repository.service";

@Component({
  selector: "c8y-sample-grid",
  templateUrl: "sample.component.html",
  styleUrls: ["./sample.component.css"],
  encapsulation: ViewEncapsulation.None,
})
export class SampleGridComponent implements OnInit {
  showConfigSample: boolean = false;
  refresh: EventEmitter<any> = new EventEmitter<any>();
  showMonitorEditor: boolean = false;
  samples: CEP_Block[] = [];
  actionControls: ActionControl[] = [];
  bulkActionControls: BulkActionControl[] = [];
  source: string = "";

  titleSample: string = "AnalyticsBuilder Community Samples";

  columnsSamples: Column[] = [
    {
      name: "name",
      header: "Name",
      path: "name",
      dataType: ColumnDataType.TextLong,
      filterable: true,
      gridTrackSize: "15%",
      visible: true,
    },
    {
      name: "repositoryName",
      header: "Repository Name",
      path: "repositoryName",
      dataType: ColumnDataType.TextLong,
      filterable: true,
      gridTrackSize: "15%",
      visible: true,
    },
    {
      name: "url",
      header: "URL",
      path: "url",
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: true,
    },
  ];

  pagination: Pagination = {
    pageSize: 3,
    currentPage: 1,
  };

  constructor(
    public analyticsService: AnalyticsService,
    public repositoryService: RepositoryService,
    public alertService: AlertService,
    private bsModalService: BsModalService
  ) {}

  async ngOnInit() {
    await this.loadSamples();
    this.refresh.subscribe(() => {
      this.loadSamples();
    });

    this.bulkActionControls.push({
      type: "CREATE",
      text: "Create Extension",
      icon: "export",
      callback: this.createExtension.bind(this),
    });

    this.actionControls.push({
      text: "View Source",
      type: "VIEW",
      icon: "document-with-code",
      callback: this.viewMonitor.bind(this),
    });
  }

  async viewMonitor(block: CEP_Block) {
    try {
      this.source = await this.repositoryService.getCEP_BlockContent(
        block, true
      );
    } catch (error) {
      console.log("Something happended:", error);
    }
    //this.showMonitorEditor = true;

    const initialState = {
      source: this.source,
      monitor: block.name,
    };
    this.bsModalService.show(EditorModalComponent, {
      class: "modal-lg",
      initialState,
      ariaDescribedby: "modal-body",
      ariaLabelledBy: "modal-title",
      ignoreBackdropClick: true,
    }).content as EditorModalComponent;
  }

  async updateRepositories() {
    const initialState = {};
    const modalRef = this.bsModalService.show(RepositoriesModalComponent, {
      class: "modal-lg",
      initialState,
      ignoreBackdropClick: true,
    });

    modalRef.content.closeSubject.subscribe(async (repositories) => {
      console.log("Repositories after edit:", repositories);
      if (repositories) {
        const response = await this.repositoryService.saveRepositories(
          repositories
        );

      }
    });
  }

  public async createExtension(ids: string[]) {
    const monitors = [];
    for (let i = 0; i < this.samples.length; i++) {
      if (ids.includes(this.samples[i].id)) {
        monitors.push(this.samples[i].downloadUrl);
      }
    }
    const initialState = {
      monitors
    };

    const modalRef = this.bsModalService.show(CreateExtensionComponent, {
      class: "modal-lg",
      initialState,
    });

    modalRef.content.closeSubject.subscribe ( () => modalRef.hide())
  }

  async loadSamples() {
    // TODO filter out already loaded blocks
    // we need to develop a concept how we manage the retrieved information form git, in order to processing all the informatiion again.
    // we need to remove the already loaded blocks
    // this.analyticsService.resetCEP_Block_Cache();
    // const loadedBlocks: CEP_Block[] = await this.analyticsService.getLoadedCEP_Blocks()
    const s = await this.repositoryService.getAll_CEP_BlockSamples();
    this.samples = s;
  }

  ngOnDestroy() {}
}
