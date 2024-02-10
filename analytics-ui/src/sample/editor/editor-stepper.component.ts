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
    AfterViewInit,
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnInit,
    Output,
    ViewChild,
    ViewEncapsulation,
} from "@angular/core";
import { C8yStepper } from "@c8y/ngx-components";
import { BsModalService } from "ngx-bootstrap/modal";
import { AnalyticsService } from "../../shared";

@Component({
  selector: "c8y-editor-stepper",
  templateUrl: "editor-stepper.component.html",
  styleUrls: ["./editor-stepper.component.css"],
  encapsulation: ViewEncapsulation.None,
})
export class EditorStepperComponent implements OnInit, AfterViewInit{
  @Input() source: string;
  @Output() onCommit = new EventEmitter<boolean>();
  @Output() onCancel = new EventEmitter<boolean>();
  @ViewChild("sourceEditor", { static: false })
  sourceEditor: ElementRef;

  step: any;

  constructor(
    public bsModalService: BsModalService,
    public analyticsService: AnalyticsService,
  ) {}

  ngAfterViewInit(): void {
    this.addLineClass();
  }

  ngOnInit() {
    console.log("Monitor to view.:", this.source);
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

  public addLineClass() {
    const ne = this.sourceEditor.nativeElement;
    const lines = ne.innerText.split("\n"); // can use innerHTML also
    while (ne.childNodes.length > 0) {
      this.sourceEditor.nativeElement.removeChild(ne.childNodes[0]);
    }
    for (var i = 0; i < lines.length; i++) {
      var span = document.createElement("span");
      span.className = "line";
      span.innerText = lines[i]; // can use innerHTML also
      ne.appendChild(span);
      ne.appendChild(document.createTextNode("\n"));
    }
  }
}
