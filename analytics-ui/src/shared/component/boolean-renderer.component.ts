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
import { CellRendererContext } from '@c8y/ngx-components';

@Component({
  selector: 'a17t-boolean-renderer',
  template: `
    <label class="c8y-checkbox d-inline-block disabled">
      <input type="checkbox" [checked]="!!context.value" disabled />
      <span></span>
      <span class="sr-only">{{ context.value ? 'Yes' : 'No' }}</span>
    </label>
  `,
  imports: []
})
export class BooleanRendererComponent {
  constructor(public context: CellRendererContext) {
    // console.log("Renderer context:", context.value);
  }
}
