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

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CoreModule } from '@c8y/ngx-components';
import {
  RELEASE_BLOCKS,
  RELEASE_BUNDLES,
  RELEASE_PUBLISHED_AT,
  RELEASE_TAG_URL,
  ReleaseAsset
} from './release-list.data';

/**
 * Mockup page showing the assets of a GitHub release as a package-style
 * list, matching the look of the Ecosystem "Extensions" list. Data is a
 * static snapshot (see release-list.data.ts) — nothing is fetched here.
 */
@Component({
  selector: 'a17t-release-list',
  templateUrl: './release-list.component.html',
  styleUrls: ['./release-list.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule, CoreModule]
})
export class ReleaseListComponent {
  readonly releaseTagUrl = RELEASE_TAG_URL;
  readonly releasePublishedAt = RELEASE_PUBLISHED_AT;

  bundles: ReleaseAsset[] = RELEASE_BUNDLES;
  blocks: ReleaseAsset[] = RELEASE_BLOCKS;

  filterTerm = '';
  listClass = 'card-group';

  get filteredBundles(): ReleaseAsset[] {
    return this.filter(this.bundles);
  }

  get filteredBlocks(): ReleaseAsset[] {
    return this.filter(this.blocks);
  }

  formatSize(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  trackByAsset(_: number, asset: ReleaseAsset): string {
    return asset.name;
  }

  private filter(assets: ReleaseAsset[]): ReleaseAsset[] {
    const term = this.filterTerm.trim().toLowerCase();
    if (!term) {
      return assets;
    }
    return assets.filter(
      asset =>
        asset.name.toLowerCase().includes(term) ||
        asset.description.toLowerCase().includes(term)
    );
  }
}
