import { Component, OnInit, Output, ViewEncapsulation } from "@angular/core";
import { BehaviorSubject, Observable, Subject, of } from "rxjs";
import { AlarmService, AlarmStatus, IAlarm, IResultList } from "@c8y/client";
import { shareReplay, switchMap, tap } from "rxjs/operators";
import { BsModalRef } from "ngx-bootstrap/modal";
import { AnalyticsService } from "../shared/analytics.service";

@Component({
  selector: "extensionmonitoring",
  templateUrl: "./extension-monitoring.component.html",
  encapsulation: ViewEncapsulation.None,
})
export class ExtensionMonitoringComponent implements OnInit {
  cepId: string;
  @Output() closeSubject: Subject<void> = new Subject();
  alarms$: Observable<IResultList<IAlarm>>;
  nextPage$: BehaviorSubject<any> = new BehaviorSubject({ direction: 0 });
  currentPage: number = 1;
  searchString: string;
  status: AlarmStatus;
  AlarmStatus = AlarmStatus;

  constructor(
    private alarmService: AlarmService,
    private analyticsService: AnalyticsService,
    public bsModalRef: BsModalRef
  ) {}

  async ngOnInit(): Promise<void> {
    this.init();
    this.cepId = await this.analyticsService.getCEP_Id();
    let filter: object = {
      pageSize: 5,
      source: this.cepId,
      currentPage: 1,
      withTotalPages: true,
    };
    this.alarms$ = this.nextPage$.pipe(
      tap((options) => {
        if (options.direction) {
          this.currentPage = this.currentPage + options.direction;
          if (this.currentPage < 1) this.currentPage = 1;
          filter["currentPage"] = this.currentPage;
        }
        if (options.status) {
          filter["status"] = options.status;
        }
      }),
      switchMap(() => this.alarmService.list(filter)),
      shareReplay()
    );
    this.nextPage$.next({ direction: 0 });
  }

  private async init() {
    this.cepId = await this.analyticsService.getCEP_Id();
  }

  nextPage(direction: number) {
    this.nextPage$.next({ direction });
  }

  search() {
    this.nextPage$.next({ status:this.status });
  }
}
