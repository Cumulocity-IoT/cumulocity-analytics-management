import { Component, OnInit } from '@angular/core';
import { IApplication, IManagedObject } from '@c8y/client';
import { WizardService, WizardConfig } from '@c8y/ngx-components';
import { BehaviorSubject, Observable } from 'rxjs';
import { shareReplay, switchMap, tap } from 'rxjs/operators';
import { AnalyticsService } from './analytics.service';
import { ModalOptions } from 'ngx-bootstrap/modal';


@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.css']
})
export class AnalyticsComponent implements OnInit {
  reloading: boolean = false;
  reload$: BehaviorSubject<void> = new BehaviorSubject(null);

  extensions$: Observable<IManagedObject> = this.reload$.pipe(
    tap(() => (this.reloading = true)),
    switchMap(() => this.analyticsService.getWebExtensions()),
    tap(console.log),
    tap(() => (this.reloading = false)),
    shareReplay()
  );

  listClass: string;

  constructor(
    private analyticsService: AnalyticsService,
     private wizardService: WizardService
  ) {}

  ngOnInit() {
    this.loadExtensions();
  }

  loadExtensions() {
    this.reload$.next();
  }

  addExtension() {
    const wizardConfig: WizardConfig = {
      headerText: 'Add Extension',
      headerIcon: 'c8y-atom'
    };

    const initialState: any = {
      wizardConfig,
      id: 'uploadExtension'
    };

    const modalOptions: ModalOptions = { initialState };

    const modalRef = this.wizardService.show(modalOptions);
    modalRef.content.onClose.subscribe(() => {
      this.loadExtensions();
    });
  }
}
