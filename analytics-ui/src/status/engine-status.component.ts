import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { BsModalRef } from 'ngx-bootstrap/modal';
import { AnalyticsService } from '../shared';
import { HumanizePipe, PropertiesListItem } from '@c8y/ngx-components';
import { BehaviorSubject, Subject } from 'rxjs';

@Component({
  selector: 'a17t-engine-status',
  templateUrl: './engine-status.component.html',
  encapsulation: ViewEncapsulation.None
})
export class EngineStatusComponent implements OnInit {
  cepOperationObjectId: string;
  cepCtrlStatus$: Subject<any> = new Subject<any>();
  cepCtrlStatusLabels$: BehaviorSubject<PropertiesListItem[]> =
    new BehaviorSubject<PropertiesListItem[]>([]);

  constructor(
    private analyticsService: AnalyticsService,
    public bsModalRef: BsModalRef
  ) {}

  async ngOnInit(): Promise<void> {
    const humanize = new HumanizePipe();

    this.init();
    this.cepOperationObjectId = await this.analyticsService.getCepOperationObjectId();
    const cepCtrlStatus = await this.analyticsService.getCepCtrlStatus();
    const cepCtrlStatusLabels = [];
    Object.keys(cepCtrlStatus).forEach((key) => {
      if (
        ['number_extensions', 'is_safe_mode', 'microservice_name'].includes(key)
      ) {
        cepCtrlStatusLabels.push({
          label: humanize.transform(key),
          type: 'string',
          value: cepCtrlStatus[key]
        });
      }
    });
    this.cepCtrlStatusLabels$.next(cepCtrlStatusLabels);

    // console.log("Labels:", cepCtrlStatusLabels);
    // console.log("Objects:", cepCtrlStatus);
  }

  private async init() {
    this.cepOperationObjectId = await this.analyticsService.getCepOperationObjectId();
  }
}
