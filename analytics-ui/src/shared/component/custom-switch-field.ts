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

import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FieldType } from '@ngx-formly/core';

@Component({
  selector: 'a17t-custom-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label
      [class.c8y-checkbox]="!to.switchMode"
      [class.c8y-switch]="to.switchMode"
      [class.has-error]="showError"
    >
      <input
        type="checkbox"
        [formControl]="formControl"
        [formlyAttributes]="field"
        [attr.data-cy]="
          'c8y-field-checkbox--' +
          (field.templateOptions?.optionDataCy || to.label)
        "
      />
      <span></span>
      <span class="text-truncate" title="{{ to.label | humanize }}">{{
        to.label | humanize
      }}</span>
      <span *ngIf="to.required && to.hideRequiredMarker !== true">
        <em class="m-l-4" translate>(required)</em>
      </span>
      <!-- <button
    class="btn-help btn-help--sm m-t-auto m-b-auto"
    type="button"
    [attr.aria-label]="'Help' | translate"
    [popover]="to.description"
    triggers="focus"
    placement="right"
    *ngIf="!!to.description"
  ></button> -->
    </label>
  `,
  standalone: false
})
export class CustomSwitchField extends FieldType {}
