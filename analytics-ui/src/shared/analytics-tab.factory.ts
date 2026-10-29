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
import { Observable, of } from 'rxjs';
import { PAGE_LABELS, ROUTE_ROOT, ROUTES } from './analytics.constants';
@Injectable()
export class AnalyticsTabFactory implements TabFactory {
  constructor(private router: Router) {}

  get(): Observable<Tab[]> {
    const tabs: Tab[] = [];
    if (this.router.url.includes(ROUTE_ROOT)) {
      tabs.push({
        path: ROUTES.manage,
        priority: 960,
        label: PAGE_LABELS.extensions,
        icon: 'plugin',
        orientation: 'horizontal'
      } as Tab);
      tabs.push({
        path: ROUTES.installedBlocks,
        priority: 940,
        label: PAGE_LABELS.installedBlocks,
        icon: 'flow-chart',
        orientation: 'horizontal'
      } as Tab);
      // Always shown: repository config (Tenant Options) and the
      // "Deploy from GitHub Release" flow both work without the
      // analytics-service microservice — only browsing/building from a
      // repo's source tree still depends on it, which degrades gracefully
      // on that page rather than requiring the whole tab to be hidden.
      tabs.push({
        path: ROUTES.repository,
        priority: 920,
        label: PAGE_LABELS.repositories,
        icon: 'test',
        orientation: 'horizontal'
      } as Tab);
    }
    return of(tabs);
  }
}
