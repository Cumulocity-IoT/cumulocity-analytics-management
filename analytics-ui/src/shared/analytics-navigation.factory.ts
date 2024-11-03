import { Injectable } from '@angular/core';

import {
  gettext,
  NavigatorNode,
  NavigatorNodeFactory,
  Permissions
} from '@c8y/ngx-components';

@Injectable()
export class AnalyticsNavigationFactory implements NavigatorNodeFactory {
  protected extensionsNode = new NavigatorNode({
    label: gettext('Analytics extensions'),
    icon: 'extension',
    path: 'sag-ps-pkg-analytics-extension/block',
    parent: gettext('Ecosystem'),
    priority: 200,
    preventDuplicates: true
  });

  constructor(private permissions: Permissions) {}

  get(): NavigatorNode {
    if (this.canActivate()) {
      return this.extensionsNode;
    }
    return;
  }

  canActivate(): boolean {
    const result =
      this.permissions.hasRole('ROLE_CEP_MANAGEMENT_READ') &&
      this.permissions.hasRole('ROLE_CEP_MANAGEMENT_ADMIN');
    console.log(
      'User permissions:',
      result,
      this.permissions.hasRole('ROLE_CEP_MANAGEMENT_READ'),
      this.permissions.hasRole('ROLE_CEP_MANAGEMENT_ADMIN')
    );
    return result;
  }
}
