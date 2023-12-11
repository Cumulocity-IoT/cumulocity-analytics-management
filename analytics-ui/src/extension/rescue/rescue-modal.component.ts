import {
  Component,
  Input,
  OnInit,
  Output,
  ViewEncapsulation,
} from "@angular/core";
import { ModalLabels } from "@c8y/ngx-components";
import { BehaviorSubject, Observable, Subject, of } from "rxjs";
import { AlarmService, IAlarm, IResultList } from "@c8y/client";
import { shareReplay, switchMap, tap } from "rxjs/operators";
import { BsModalRef } from "ngx-bootstrap/modal";

@Component({
  selector: "rescue-modal",
  templateUrl: "./rescue-modal.component.html",
  encapsulation: ViewEncapsulation.None,
})
export class RescueModalComponent implements OnInit {
  @Input() cepId: string;
  @Output() closeSubject: Subject<void> = new Subject();
  labels: ModalLabels = { ok: "Close" };
  alarms$: Observable<IResultList<IAlarm>>;
  nextPage$: BehaviorSubject<number> = new BehaviorSubject(0);
  currentPage: number = 1;

  constructor(private alarmService: AlarmService,
    public bsModalRef: BsModalRef) {}

  ngOnInit(): void {
    let filter: object = {
      pageSize: 5,
      source: this.cepId,
      currentPage: 1,
      withTotalPages: true,
    };
    this.alarms$ = this.nextPage$.pipe(
      tap((nextPage) => {
        this.currentPage = this.currentPage + nextPage;
        if  (this.currentPage < 1) this.currentPage = 1;
        filter['currentPage'] =  this.currentPage
        ;
      }),
      switchMap(() => this.alarmService.list(filter)),
      shareReplay()
    );
    this.nextPage$.next(0);
  }

  nextPage(direction: number) {
    this.nextPage$.next(direction);
  }
}
