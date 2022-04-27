import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { ApplicationService, IApplication, IManagedObject } from '@c8y/client';
import { AlertService, gettext } from '@c8y/ngx-components';
import { AnalyticsService } from './analytics.service';

@Component({
  selector: 'c8y-analytics-card',
  templateUrl: './analytics-card.component.html'
})
export class AnalyticsCardComponent implements OnInit {
  @Input() app: IManagedObject;
  @Output() onAppDeleted: EventEmitter<void> = new EventEmitter();

  constructor(
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private router: Router
  ) {}

  async ngOnInit() {
  }

  detail() {
  }

  async delete() {
    try {
      await this.analyticsService.deleteExtension(this.app);
      this.onAppDeleted.emit();
    } catch (ex) {
      if (ex) {
        this.alertService.addServerFailure(ex);
      }
    }
  }
}
