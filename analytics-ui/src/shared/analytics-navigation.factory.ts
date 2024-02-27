import { Injectable } from '@angular/core';
import { ApplicationService } from '@c8y/client';

import {
  gettext,
  NavigatorNode,
  NavigatorNodeFactory,
} from '@c8y/ngx-components';

@Injectable()
export class AnalyticsNavigationFactory implements NavigatorNodeFactory {
  constructor(private applicationService: ApplicationService) {}

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
    return navs;
  }
}
