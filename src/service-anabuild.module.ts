import { CommonModule } from "@angular/common";
import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import { RouterModule as ngRouterModule } from '@angular/router';
import {
  CoreModule,
  RouterModule,
  hookNavigator,
  hookRoute,
  hookWizard,
} from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";
import { AnalyticsExtensionWizardComponent } from "./wizard/analytics-extension-wizard.component";
import { AnalyticsAddExtensionComponent } from "./analytics/analytics-add-extension.component";
import { AnalyticsExtensionCardComponent } from "./analytics/analytics-extension-card.component";
import { AnalyticsComponent } from "./analytics/analytics.component";
import { AnalyticsService } from "./shared/analytics.service";
import { AnalyticsNavigationFactory } from "./factories/analytics-navigation.factory";

@NgModule({
  imports: [
    CoreModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule.forRoot(),
    ngRouterModule.forRoot([], { enableTracing: false, useHash: true }),
    BinaryFileDownloadModule,
    BsDropdownModule.forRoot(),
    DefaultSubscriptionsModule,
  ],
  declarations: [
    AnalyticsComponent,
    AnalyticsExtensionCardComponent,
    AnalyticsAddExtensionComponent,
    AnalyticsExtensionWizardComponent,
  ],
  entryComponents: [
    AnalyticsComponent,
    AnalyticsExtensionCardComponent,
    AnalyticsAddExtensionComponent,
    AnalyticsExtensionWizardComponent,
  ],
  providers: [
    AnalyticsService,
    hookNavigator(AnalyticsNavigationFactory),
    hookWizard({
      wizardId: "uploadAnalyticsExtention",
      component: AnalyticsExtensionWizardComponent,
      name: "Upload analytics extension",
      c8yIcon: "upload",
    }),
    hookRoute({
      path: "sag-ps-pkg-analytics-extensions",
      component: AnalyticsComponent,
    }),
  ],
})
export class AnalyticsExtensionModule {
  constructor() {}
}
