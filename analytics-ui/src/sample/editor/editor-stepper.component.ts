
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
 * distributed under the License is distributed on an "AS IS" BASIS,
 * Unless required by applicable law or agreed to in writing, software
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @authors Christof Strack
 */
import { CdkStep } from "@angular/cdk/stepper";
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewEncapsulation,
} from "@angular/core";
import { C8yStepper } from "@c8y/ngx-components";
import * as _ from "lodash";
import { BsModalRef, BsModalService } from "ngx-bootstrap/modal";
import { BehaviorSubject, Subject } from "rxjs";
import { AnalyticsService } from "../../shared/analytics.service";

@Component({
  selector: "c8y-editor-stepper",
  templateUrl: "editor-stepper.component.html",
  styleUrls: ['./editor-stepper.component.css'],
  encapsulation: ViewEncapsulation.None,
})
export class EditorStepperComponent implements OnInit {
  
  @Input() source: string;
  @Output() onCommit = new EventEmitter<boolean>();
  @Output() onCancel = new EventEmitter<boolean>();

  selectedResult$: BehaviorSubject<number> = new BehaviorSubject<number>(0);
  step: any;
  onDestroy$ = new Subject<void>();

  constructor(
    public bsModalService: BsModalService,
    public analyticsService: AnalyticsService,
  ) {}

  ngOnInit() {
    console.log(
      "Monitor to view.:",
      this.source
    );
  }

  async onCommitButton() {
    this.onCommit.emit(true);
  }

  async onCancelButton() {
    this.onCancel.emit(false);
  }

  public async onStepChange(event): Promise<void> {
    console.log("OnStepChange", event);
  }

  public async onNextStep(event: {
    stepper: C8yStepper;
    step: CdkStep;
  }): Promise<void> {
    event.stepper.next();
  }

}