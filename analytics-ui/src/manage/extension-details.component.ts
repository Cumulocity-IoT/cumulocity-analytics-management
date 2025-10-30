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
import { gettext } from '@c8y/ngx-components';
import { AnalyticsService, CEP_Extension } from '../shared';

@Component({
  selector: 'a17t-extension-details',
  templateUrl: './extension-details.component.html',
  styleUrls: ['./extension-details.component.css'],
  standalone: false
})
export class ExtensionDetailsComponent implements OnInit {
  extensionFromCEP: CEP_Extension;
  extension: CEP_Extension;
  extensionContent: any;
  buildInformation: any[] = [];
  breadcrumbConfig: { icon: string; label: string; path: string };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private analyticsService: AnalyticsService
  ) {
    // Get the extension from navigation state in constructor
    const navigation = this.router.getCurrentNavigation();
    this.extension = navigation?.extras?.state?.['extension'];
  }

  async ngOnInit(): Promise<void> {
    this.extensionFromCEP = await this.route.snapshot.data['extensionFromCEP'];

    // Alternative: Get extension from history state if not set in constructor
    if (!this.extension) {
      this.extension = history.state.extension;
    }
    this.buildInformation.push({
      label: 'Build Type',
      type: 'string',
      value: this.extension['build_information']['build_type']
    });
    this.buildInformation.push({
      label: 'Repository Name',
      type: 'string',
      value: this.extension['build_information']['repository']['name']
    });
    this.buildInformation.push({
      label: 'Repository Url',
      type: 'string',
      value: this.extension['build_information']['repository']['url']
    });
    await this.init();
  }

  async init() {
    this.setBreadcrumbConfig();
    const { name } = this.route.snapshot.params;
    const extensionNames = await this.analyticsService.getExtensionNamesFromCEP();
    const key = `${name}.zip`;
    this.extensionContent = extensionNames[key]?.contents?.map(fileName => {
      return fileName.startsWith('files/') ? fileName.substring(6) : fileName;
    }) || [];
    // console.log( "Content", this.extensionContent, this.extension?.analytics?.length);
  }

  private setBreadcrumbConfig() {
    this.breadcrumbConfig = {
      icon: 'c8y-modules',
      label: gettext('Extensions'),
      path: 'c8y-pkg-analytics-extension/manage'
    };
  }
}
