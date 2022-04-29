import { Injectable } from '@angular/core';
import { gettext, NavigatorNode, NavigatorNodeFactory, _ } from '@c8y/ngx-components';

@Injectable()


export class AnalyticsNavigationFactory implements NavigatorNodeFactory {
      private navs: NavigatorNode[] = [];
    
      constructor() {
      }
    
      async get() {
/*           const extensionsNode = new NavigatorNode({
            label: gettext('Extensions'),
            icon: 'c8y-tools',
            path: '/extensions',
            priority: 200,
            routerLinkExact: false
          });
          this.navs.push(
            new NavigatorNode({
              label: gettext('Analytics'),
              icon: 'c8y-streaming-analytics',
              priority: 3200,
              children: [extensionsNode]
            })
          ); */
          const extensionsNode = new NavigatorNode({
            label: gettext('Analytics Extensions'),
            icon: 'c8y-tools',
            path: '/extensions',
            parent: gettext('Ecosystem'),
            priority: 200,
            routerLinkExact: false
          });
          this.navs.push(extensionsNode);
        return this.navs;
      }
    }
