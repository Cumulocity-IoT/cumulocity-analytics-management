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

import { Component, OnInit } from '@angular/core';

import { ActivatedRoute, Router } from '@angular/router';
import {
  CoreModule,
  SplitViewComponent,
  SplitViewDetailsComponent,
  SplitViewListComponent
} from '@c8y/ngx-components';
import { AnalyticsService, CepExtension, PAGE_LABELS, ROUTES } from '../shared';

type SectionId = 'blocks' | 'files' | 'build';

@Component({
  selector: 'a17t-extension-details',
  templateUrl: './extension-details.component.html',
  styleUrls: ['./extension-details.component.css'],
  imports: [CoreModule, SplitViewComponent, SplitViewListComponent, SplitViewDetailsComponent]
})
export class ExtensionDetailsComponent implements OnInit {
  readonly labels = PAGE_LABELS;
  readonly routes = ROUTES;

  extensionFromCep!: CepExtension;
  extension!: CepExtension;
  extensionContent: string[] = [];
  buildInformation: any[] = [];
  /** The sections of the split view list. The first one is selected when the page opens. */
  readonly sections: { id: SectionId; label: string; icon: string }[] = [
    { id: 'blocks', label: 'Blocks', icon: 'c8y-apama-epl' },
    { id: 'files', label: 'Files', icon: 'file' },
    { id: 'build', label: 'Build information', icon: 'monitoring' }
  ];
  breadcrumbConfig!: { icon: string; label: string; path: string };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private analyticsService: AnalyticsService
  ) {
    // Get the extension from navigation state in constructor
    const navigation = this.router.currentNavigation();
    this.extension = navigation?.extras?.state?.['extension'];
    // console.log("Navigation", navigation?.extras);
  }
  async ngOnInit(): Promise<void> {
    this.extensionFromCep = await this.route.snapshot.data['extensionFromCep'];

    // Alternative: Get extension from history state if not set in constructor
    if (!this.extension) {
      this.extension = history.state.extension;
    }

    const buildInfo = this.extension?.build_information;

    if (buildInfo) {
      // Add Build Type
      if (buildInfo.build_type) {
        this.buildInformation.push({
          label: 'Build Type',
          type: 'string',
          value: buildInfo.build_type
        });
      }

      if (buildInfo.version) {
        this.buildInformation.push({
          label: 'Version',
          type: 'string',
          value: buildInfo.version
        });
      }

      // Add Repository information if available
      const repo = buildInfo.repository;
      if (repo?.name) {
        this.buildInformation.push({
          label: 'Repository Name',
          type: 'string',
          value: repo.name
        });
      }

      if (repo?.url) {
        this.buildInformation.push({
          label: 'Repository Url',
          type: 'link',
          value: repo.url,
          action: (_event: unknown, link: string) =>
            window.open(link, '_blank', 'noopener,noreferrer')
        });
      }
    }

    await this.init();
  }

  async init() {
    this.setBreadcrumbConfig();
    const { name } = this.route.snapshot.params;
    const buildInformation = this.extension?.build_information;
    const contentPaths = new Set<string>();
    // Real extension zips nest everything under a top-level "files/" folder
    // (apama-ctrl's copyExtensions looks specifically there), so every source
    // below reports paths with that prefix. Strip it uniformly so paths from
    // build_information and from the CEP diagnostics endpoint dedupe and
    // display consistently.
    const stripFilesPrefix = (path: string) =>
      path.startsWith('files/') ? path.substring(6) : path;

    // build_information keeps the full relative path of every file within the
    // extension zip (including nested subfolders), regardless of deployment
    // status, so it is always the primary source for the Files list.
    (buildInformation?.['monitors'] || []).forEach(monitor => {
      if (monitor?.['file']) {
        contentPaths.add(stripFilesPrefix(monitor['file']));
      }
    });
    (buildInformation?.['files'] || []).forEach(file => {
      if (file?.['file']) {
        contentPaths.add(stripFilesPrefix(file['file']));
      }
    });

    if (this.extensionFromCep) {
      const extensionNames = await this.analyticsService.getExtensionNamesFromCep();
      const key = `${name}.zip`;
      (
        (extensionNames as unknown as Record<string, { contents?: string[] }>)[key]?.contents || []
      ).forEach((fileName: string) => {
        contentPaths.add(stripFilesPrefix(fileName));
      });
    }

    this.extensionContent = Array.from(contentPaths);
  }

  private setBreadcrumbConfig() {
    this.breadcrumbConfig = {
      icon: 'plugin',
      label: PAGE_LABELS.extensions,
      path: ROUTES.manage
    };
  }

  /** Number shown next to a section in the list. Zero hides the badge. */
  sectionCount(id: SectionId): number {
    switch (id) {
      case 'blocks':
        return this.extensionFromCep?.analytics?.length ?? 0;
      case 'files':
        return this.extensionContent.length;
      default:
        return 0;
    }
  }

  sectionLabel(id: SectionId | null | undefined): string {
    return this.sections.find(section => section.id === id)?.label ?? '';
  }
}
