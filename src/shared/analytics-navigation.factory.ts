import { Injectable } from "@angular/core";
import { ApplicationService } from "@c8y/client";

import {
  gettext,
  NavigatorNode,
  NavigatorNodeFactory,
  _,
} from "@c8y/ngx-components";

@Injectable()
export class AnalyticsNavigationFactory implements NavigatorNodeFactory {
  constructor(private applicationService: ApplicationService) {}

  get() {
    let navs: NavigatorNode[] = [];
    const extensionsNode = new NavigatorNode({
      label: gettext("Analytics Extension"),
      icon: "c8y-tools",
      //path: "manage",
      path: "sag-ps-pkg-analytics-extension/manage",
      parent: gettext("Ecosystem"),
      priority: 200,
      preventDuplicates: true,
    });
    navs.push(extensionsNode);
    return navs;
  }
}
