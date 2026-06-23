import { Component, OnInit, Output, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { CoreModule, HumanizePipe, PropertiesListItem } from '@c8y/ngx-components';

@Component({
  selector: 'a17t-engine-monitoring',
  templateUrl: './engine-monitoring.component.html',
  encapsulation: ViewEncapsulation.None,
  standalone: true,
  imports: [CommonModule, FormsModule, CoreModule]
})
export class EngineMonitoringComponent implements OnInit {
  cepOperationObjectId!: string;
  cepCtrlStatusLabels$: BehaviorSubject<PropertiesListItem[]> =
    new BehaviorSubject<PropertiesListItem[]>([]);
  @Output() closeSubject: Subject<void> = new Subject();
  alarms$!: Observable<IResultList<IAlarm>>;
  events$!: Observable<IResultList<IEvent>>;
  nextPageAlarm$: BehaviorSubject<any> = new BehaviorSubject({ direction: 0 });
  nextPageEvent$: BehaviorSubject<any> = new BehaviorSubject({ direction: 0 });
  currentPageAlarm: number = 1;
  currentPageEvent: number = 1;
  searchString!: string;
  status!: typeof AlarmStatus;
  AlarmStatus = AlarmStatus;
  isAlarmExpanded: boolean = true;
  isEventExpanded: boolean = false;
  cepCtrlStatus: Record<string, unknown> = {};

  constructor(
    private alarmService: AlarmService,
    private eventService: EventService,
    private analyticsService: AnalyticsService,
    public bsModalRef: BsModalRef
  ) {}

  async ngOnInit(): Promise<void> {
    const humanize = new HumanizePipe();

    this.init();
    const operationObjectId = await this.analyticsService.getCepOperationObjectId();
    this.cepOperationObjectId = operationObjectId || '';
    const cepCtrlStatus = await this.analyticsService.getCepStatus();
    const cepCtrlStatusLabels: any[] = [];
    Object.keys(cepCtrlStatus).forEach((key) => {
      if (
        ['number_extensions', 'is_safe_mode', 'microservice_name'].includes(key)
      ) {
        if ('is_safe_mode' === key) {
          cepCtrlStatusLabels.push({
            label: humanize.transform(key),
            type: 'link',
            value: cepCtrlStatus[key]?.toString() ?? '',
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            action:  (_e: any) =>
              window.open(
                'https://cumulocity.com/docs/streaming-analytics/troubleshooting/#apama_safe_mode',
                '_blank',
                'noopener,noreferrer'
              )
          });
        } else {
          cepCtrlStatusLabels.push({
            label: humanize.transform(key),
            type: 'string',
            value: cepCtrlStatus[key]
          });
        }
      }
    });
    this.cepCtrlStatusLabels$.next(cepCtrlStatusLabels);

    let filterAlarm: any = {
      pageSize: 5,
      source: this.cepOperationObjectId,
      currentPage: 1,
      withTotalPages: true
    };
    let filterEvent: any = {
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
          filterAlarm = { currentPage: this.currentPageAlarm };
        }
        if (options.status) {
          (filterAlarm as any)['status'] = options.status;
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
          filterEvent = { currentPage: this.currentPageEvent };
        }
      }),
      switchMap(() => this.eventService.list(filterEvent)),
      shareReplay()
    );
    this.nextPageAlarm$.next({ direction: 0 });
    this.nextPageEvent$.next({ direction: 0 });
  }

  private async init() {
    const operationObjectId = await this.analyticsService.getCepOperationObjectId();
    this.cepOperationObjectId = operationObjectId || '';
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
