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

import { Injectable } from '@angular/core';
import { TabFactory, Tab } from '@c8y/ngx-components';
import { Router } from '@angular/router';
import { Observable, from, map, merge, mergeAll, of, toArray } from 'rxjs';
import { AnalyticsService } from './analytics.service';
@Injectable()
export class AnalyticsTabFactory implements TabFactory {
  constructor(
    private router: Router,
    private analyticsService: AnalyticsService
  ) {}

  get(): Observable<Tab[]> {
    const tabs: Tab[] = [];
    let repositoryTab$: Observable<Tab>;
    if (this.router.url.match(/sag-ps-pkg-analytics-extension/g)) {
      tabs.push({
        path: 'sag-ps-pkg-analytics-extension/manage',
        priority: 960,
        label: 'Manage extensions',
        icon: 'extension',
        orientation: 'horizontal'
      } as Tab);
      tabs.push({
        path: 'sag-ps-pkg-analytics-extension/block',
        priority: 940,
        label: 'Blocks installed',
        icon: 'flow-chart',
        orientation: 'horizontal'
      } as Tab);
      repositoryTab$ = from(
        this.analyticsService.isBackendDeployed()
      ).pipe(
        map((result) => {
          if (result) {
            return {
              path: 'sag-ps-pkg-analytics-extension/repository',
              priority: 920,
              label: 'Repositories',
              icon: 'test',
              orientation: 'horizontal'
            } as Tab;
          }
        })
      );
      tabs.push({
        path: 'sag-ps-pkg-analytics-extension/monitoring',
        priority: 900,
        label: 'Monitoring',
        icon: 'monitoring',
        orientation: 'horizontal'
      } as Tab);
      return merge(of(tabs), [repositoryTab$]).pipe(mergeAll(), toArray());
    }
    return of(tabs);
  }
}
