import { Injectable } from '@angular/core';
import { ApplicationService } from '@c8y/client';

import {
  AlertService,
  gettext,
  NavigatorNode,
  NavigatorNodeFactory
} from '@c8y/ngx-components';

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
      path: 'sag-ps-pkg-analytics-extension/block',
      parent: gettext('Ecosystem'),
      priority: 200,
      preventDuplicates: true
    });
    navs.push(extensionsNode);
    return navs;
  }
}
