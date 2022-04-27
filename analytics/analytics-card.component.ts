import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { ApplicationService, IApplication } from '@c8y/client';
import { AlertService, gettext } from '@c8y/ngx-components';
import { AnalyticsService } from './analytics.service';

@Component({
  selector: 'c8y-analytics-card',
  templateUrl: './analytics-card.component.html'
})
export class AnalyticsCardComponent implements OnInit {
  @Input() app: IApplication;
  @Output() onAppDeleted: EventEmitter<void> = new EventEmitter();

  canDelete: boolean;

  readonly CANNOT_DELETE_HINT = gettext(`Subscribed or current applications can't be deleted. Delete the application on the parent tenant or unsubscribe it from the current.`);

  constructor(
    private applicationService: ApplicationService,
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private router: Router
  ) {}

  async ngOnInit() {
    const contextPath = this.app.contextPath;
    this.canDelete = await this.analyticsService.canDeleteExtension(this.app);

  }

  detail() {
  }

  async delete() {
    try {
      await this.analyticsService.deleteApp(this.app);
      this.onAppDeleted.emit();
    } catch (ex) {
      if (ex) {
        this.alertService.addServerFailure(ex);
      }
    }
  }
}
