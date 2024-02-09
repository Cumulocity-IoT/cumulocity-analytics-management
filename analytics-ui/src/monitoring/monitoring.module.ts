import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  CoreModule,
  hookRoute,
} from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { HttpClientModule } from "@angular/common/http";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";
import { ExtensionMonitoringComponent } from "./extension-monitoring.component";
import { CollapseModule } from "ngx-bootstrap/collapse";
import { PopoverModule } from 'ngx-bootstrap/popover';
import { AnalyticsService } from "../shared/analytics.service";


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
  ],
  declarations: [
    ExtensionMonitoringComponent
  ],
  providers: [
    AnalyticsService,
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/monitoring",
      component: ExtensionMonitoringComponent,
    }),
  ],
})
export class MonitoringModule {
  constructor() {}
}
