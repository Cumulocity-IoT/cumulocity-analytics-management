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

import { Component } from "@angular/core";
import { FieldType } from "@ngx-formly/core";

@Component({
  selector: "custom-formly-switch",
  template: `
    <c8y-form-group>
    <label>{{ to.label }}</label>
    <span></span>
      <label class="c8y-switch" *ngIf="to.label">
        <input
          type="checkbox"
          [formControl]="formControl"
          [formlyAttributes]="field"
        />
        <span></span>
        {{ to.label }}
      </label>
      <div *ngIf="showError" class="col-sm-3 invalid-feedback d-block">
        <formly-validation-message [field]="field"></formly-validation-message>
      </div>
    </c8y-form-group>
  `,
})
export class C8YSwitchField extends FieldType {}
