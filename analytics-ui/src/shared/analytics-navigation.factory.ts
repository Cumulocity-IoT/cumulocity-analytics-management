import { Injectable } from '@angular/core';

import {
  AppStateService,
  NavigatorNode,
  NavigatorNodeFactory,
  Permissions
} from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';

@Injectable()
export class AnalyticsNavigationFactory implements NavigatorNodeFactory {
  protected extensionsNode = new NavigatorNode({
    label: gettext('Analytics extensions'),
    icon: 'extension',
    path: 'c8y-pkg-analytics-extension/manage',
    parent: gettext('Ecosystem'),
    priority: 200,
    preventDuplicates: true
  });

  constructor(private permissions: Permissions,
    private as: AppStateService,
  ) {}

  get(): NavigatorNode | NavigatorNode[] {
    // console.log('AppState', this.as);
    if (this.canActivate()) {
      // id running in 
      if (this.as['options'].contextPath == 'streaminganalytics'){
        // console.log('AppState contextPath', this.as['options'].contextPath);
        this.extensionsNode['label'] = gettext('Extensions');
      }
      return this.extensionsNode;
    } else {
      return [];
    }
    return this.extensionsNode;
  }

  canActivate(): boolean {
    const result =
      this.permissions.hasRole('ROLE_CEP_MANAGEMENT_READ') &&
      this.permissions.hasRole('ROLE_CEP_MANAGEMENT_ADMIN');
    // console.log(
    //   'User permissions:',
    //   result,
    //   this.permissions.hasRole('ROLE_CEP_MANAGEMENT_READ'),
    //   this.permissions.hasRole('ROLE_CEP_MANAGEMENT_ADMIN')
    // );
    return result;
  }
}
