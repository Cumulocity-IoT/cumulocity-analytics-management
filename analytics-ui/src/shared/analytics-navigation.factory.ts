import { Injectable } from '@angular/core';
import { ApplicationService } from '@c8y/client';

import {
    AlertService,
  gettext,
  NavigatorNode,
  NavigatorNodeFactory
} from '@c8y/ngx-components';
import { APPLICATION_ANALYTICS_BUILDER_SERVICE } from './analytics.model';

@Injectable()
export class AnalyticsNavigationFactory implements NavigatorNodeFactory {
  constructor(
    private applicationService: ApplicationService,
    private alertService: AlertService
  ) {}

  get() {
    const navs: NavigatorNode[] = [];
    const extensionsNode = new NavigatorNode({
      label: gettext('Analytics extensions'),
      icon: 'extension',
      path: 'sag-ps-pkg-analytics-extension/list',
      parent: gettext('Ecosystem'),
      priority: 200,
      preventDuplicates: true
    });
    navs.push(extensionsNode);

    return this.applicationService
      .isAvailable(APPLICATION_ANALYTICS_BUILDER_SERVICE)
      .then((data) => {
        if (!data.data ) {
          this.alertService.add({
            text: 'Microservice: <code>analytics-ext-service</code> not subscribed. Please subscribe this service before using the analytics plugin!',
            allowHtml: true,
            type: 'warning'
          });
          console.error('analytics-ext-service not subscribed!');
          return [];
        }
        return navs;
      });
  }
}
