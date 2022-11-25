import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Router } from '@angular/router';
import { IManagedObject } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { AnalyticsService } from './analytics.service';

@Component({
  selector: 'analytics-extension-card',
  templateUrl: './analytics-extension-card.component.html'
})
export class AnalyticsExtensionCardComponent implements OnInit {
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
