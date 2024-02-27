import { Component, OnInit, Output, ViewEncapsulation } from '@angular/core';
import {
  AlarmService,
  AlarmStatus,
  EventService,
  IAlarm,
  IEvent,
  IResultList
} from '@c8y/client';
import { BsModalRef } from 'ngx-bootstrap/modal';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { shareReplay, switchMap, tap } from 'rxjs/operators';
import { AnalyticsService } from '../shared';
import { HumanizePipe, PropertiesListItem } from '@c8y/ngx-components';

@Component({
  selector: 'a17t-engine-monitoring',
  templateUrl: './engine-monitoring.component.html',
  encapsulation: ViewEncapsulation.None
})
export class EngineMonitoringComponent implements OnInit {
  cepOperationObjectId: string;
  cepCtrlStatusLabels$: BehaviorSubject<PropertiesListItem[]> =
  new BehaviorSubject<PropertiesListItem[]>([]);
  @Output() closeSubject: Subject<void> = new Subject();
  alarms$: Observable<IResultList<IAlarm>>;
  events$: Observable<IResultList<IEvent>>;
  nextPageAlarm$: BehaviorSubject<any> = new BehaviorSubject({ direction: 0 });
  nextPageEvent$: BehaviorSubject<any> = new BehaviorSubject({ direction: 0 });
  currentPageAlarm: number = 1;
  currentPageEvent: number = 1;
  searchString: string;
  status: AlarmStatus;
  AlarmStatus = AlarmStatus;
  isAlarmExpanded: boolean = true;
  isEventExpanded: boolean = false;
  cepCtrlStatus: any = {};

  constructor(
    private alarmService: AlarmService,
    private eventService: EventService,
    private analyticsService: AnalyticsService,
    public bsModalRef: BsModalRef
  ) {}

  async ngOnInit(): Promise<void> {
    const humanize = new HumanizePipe();

    this.init();
    this.cepOperationObjectId = await this.analyticsService.getCEP_OperationObject();
    const cepCtrlStatus = await this.analyticsService.getCEP_Status();
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


    const filterAlarm: object = {
      pageSize: 5,
      source: this.cepOperationObjectId,
      currentPage: 1,
      withTotalPages: true
    };
    const filterEvent: object = {
      pageSize: 5,
      source: this.cepOperationObjectId,
      currentPage: 1,
      withTotalPages: true
    };
    this.alarms$ = this.nextPageAlarm$.pipe(
      tap((options) => {
        if (options.direction) {
          this.currentPageAlarm = this.currentPageAlarm + options.direction;
          if (this.currentPageAlarm < 1) this.currentPageAlarm = 1;
          filterAlarm['currentPage'] = this.currentPageAlarm;
        }
        if (options.status) {
          filterAlarm['status'] = options.status;
        }
      }),
      switchMap(() => this.alarmService.list(filterAlarm)),
      shareReplay()
    );
    this.events$ = this.nextPageEvent$.pipe(
      tap((options) => {
        if (options.direction) {
          this.currentPageEvent = this.currentPageEvent + options.direction;
          if (this.currentPageEvent < 1) this.currentPageEvent = 1;
          filterEvent['currentPage'] = this.currentPageEvent;
        }
      }),
      switchMap(() => this.eventService.list(filterEvent)),
      shareReplay()
    );
    this.nextPageAlarm$.next({ direction: 0 });
    this.nextPageEvent$.next({ direction: 0 });
  }

  private async init() {
    this.cepOperationObjectId = await this.analyticsService.getCEP_OperationObject();
  }

  nextPageAlarm(direction: number) {
    this.nextPageAlarm$.next({ direction });
  }

  nextPageEvent(direction: number) {
    this.nextPageEvent$.next({ direction });
  }

  search() {
    this.nextPageAlarm$.next({ status: this.status });
  }
}
