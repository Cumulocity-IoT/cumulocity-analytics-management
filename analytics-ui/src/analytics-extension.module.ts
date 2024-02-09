import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  CoreModule,
  hookNavigator,
  hookRoute,
  hookTab,
  hookWizard,
} from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { AddExtensionWizardComponent } from "./shared/component/add-extension-wizard.component";
import { AnalyticsService } from "./shared/analytics.service";
import { AnalyticsNavigationFactory } from "./shared/analytics-navigation.factory";
import { AnalyticsTabFactory } from "./shared/analytics-tab.factory";
import { BlockGridComponent } from "./block/block.component";
import { SampleGridComponent } from "./sample/list/sample-grid.component";
import { HttpClientModule } from "@angular/common/http";
import { RepositoryService } from "./shared/repository.service";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";
import { ExtensionMonitoringComponent } from "./monitoring/extension-monitoring.component";
import { CollapseModule } from "ngx-bootstrap/collapse";
import { PopoverModule } from 'ngx-bootstrap/popover';
import { SampleModule } from "./sample/sample.module";
import { MonitoringModule } from "./monitoring/monitoring.module";
import { ExtensionModule } from "./extension/extension.module";
import { BlockModule } from "./block/block.module";

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    BinaryFileDownloadModule,
    DefaultSubscriptionsModule,
    HttpClientModule,
    BsDropdownModule.forRoot(),
    PopoverModule,
    CollapseModule.forRoot(),
    SampleModule,
    MonitoringModule,
    ExtensionModule,
    BlockModule
  ],
  declarations: [
  ],
  providers: [
    AnalyticsService,
    RepositoryService,
    hookNavigator(AnalyticsNavigationFactory),
    hookWizard({
      wizardId: "uploadAnalyticsExtention",
      component: AddExtensionWizardComponent,
      name: "Upload analytics extension",
      c8yIcon: "upload",
    }),
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/list",
      component: BlockGridComponent,
    }),
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/sample",
      component: SampleGridComponent,
    }),
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/monitoring",
      component: ExtensionMonitoringComponent,
    }),
    hookTab(AnalyticsTabFactory),
  ],
})
export class AnalyticsExtensionModule {
  constructor() {}
}
