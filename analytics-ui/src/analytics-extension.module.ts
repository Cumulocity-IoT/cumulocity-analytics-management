import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  CoreModule,
  hookNavigator,
  hookTab,
  hookWizard,
} from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { ExtensionAddWizardComponent } from "./shared/wizard/extension-add-wizard.component";
import { AnalyticsNavigationFactory } from "./shared/analytics-navigation.factory";
import { AnalyticsTabFactory } from "./shared/analytics-tab.factory";
import { HttpClientModule } from "@angular/common/http";
import { PopoverModule } from 'ngx-bootstrap/popover';
import { SampleModule } from "./sample/sample.module";
import { MonitoringModule } from "./monitoring/monitoring.module";
import { ManageModule } from "./manage/manage.module";
import { BlockModule } from "./block/block.module";
import { ExtensionAddComponent } from "./shared";
import { StatusModule } from "./status/status.module";

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    BinaryFileDownloadModule,
    DefaultSubscriptionsModule,
    HttpClientModule,
    PopoverModule,
    SampleModule,
    MonitoringModule,
    StatusModule,
    ManageModule,
    BlockModule
  ],
  declarations: [ExtensionAddWizardComponent, ExtensionAddComponent
  ],
  providers: [
    hookNavigator(AnalyticsNavigationFactory),
    hookWizard({
      wizardId: "uploadAnalyticsExtension",
      component: ExtensionAddWizardComponent,
      name: "Upload analytics extension",
      c8yIcon: "upload",
    }),
    hookTab(AnalyticsTabFactory),
  ],
})
export class AnalyticsExtensionModule {
  constructor() {}
}
