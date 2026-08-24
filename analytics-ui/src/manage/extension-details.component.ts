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
import { CoreModule } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import { AnalyticsService, CepExtension } from '../shared';

@Component({
  selector: 'a17t-extension-details',
  templateUrl: './extension-details.component.html',
  styleUrls: ['./extension-details.component.css'],
  standalone: true,
  imports: [CoreModule]
})
export class ExtensionDetailsComponent implements OnInit {
  extensionFromCep!: CepExtension;
  extension!: CepExtension;
  extensionContent: string[] = [];
  buildInformation: any[] = [];
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

    const buildInfo = (this.extension as any)?.['build_information'];

    if (buildInfo) {
      // Add Build Type
      if (buildInfo.build_type) {
        this.buildInformation.push({
          label: 'Build Type',
          type: 'string',
          value: buildInfo.build_type
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
          action: (_event: any, link: string) =>
            window.open(link, '_blank', 'noopener,noreferrer')
        });
      }
    }

    await this.init();
  }

  async init() {
    this.setBreadcrumbConfig();
    const { name } = this.route.snapshot.params;
    const buildInformation = (this.extension as any)?.['build_information'];
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
    (buildInformation?.['monitors'] || []).forEach((monitor: any) => {
      if (monitor?.['file']) {
        contentPaths.add(stripFilesPrefix(monitor['file']));
      }
    });
    (buildInformation?.['files'] || []).forEach((file: any) => {
      if (file?.['file']) {
        contentPaths.add(stripFilesPrefix(file['file']));
      }
    });

    if (this.extensionFromCep) {
      const extensionNames =
        await this.analyticsService.getExtensionNamesFromCep();
      const key = `${name}.zip`;
      ((extensionNames as any)[key]?.contents || []).forEach(
        (fileName: string) => {
          contentPaths.add(stripFilesPrefix(fileName));
        }
      );
    }

    this.extensionContent = Array.from(contentPaths);
  }

  private setBreadcrumbConfig() {
    this.breadcrumbConfig = {
      icon: 'c8y-modules',
      label: gettext('Extensions'),
      path: 'c8y-pkg-analytics-extension/manage'
    };
  }
}
