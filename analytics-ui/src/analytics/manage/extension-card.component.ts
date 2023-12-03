import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IManagedObject } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { AnalyticsService } from '../../shared/analytics.service';

@Component({
  selector: 'extension-card',
  templateUrl: './extension-card.component.html'
})
export class AnalyticsExtensionCardComponent implements OnInit {
  @Input() app: IManagedObject;
  @Output() onAppDeleted: EventEmitter<void> = new EventEmitter();

  constructor(
    private analyticsService: AnalyticsService,
    private alertService: AlertService,
    private router: Router,
    private activatedRoute: ActivatedRoute
  ) {}

  async ngOnInit() {
  }

  async detail() {
    //this.router.navigateByUrl(`/sag-ps-pkg-dynamic-mapping/extensions/${this.app.id}`);
    this.router.navigate(["properties/", this.app.name], {
      relativeTo: this.activatedRoute,
    });
    console.log("Details for extension:", this.app.name, this.activatedRoute);
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
