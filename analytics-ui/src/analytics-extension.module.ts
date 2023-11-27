import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import { Route, RouterModule as ngRouterModule } from '@angular/router';
import {
  CoreModule,
  hookNavigator,
  hookRoute,
  hookTab,
  hookWizard,
  RouterModule
} from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";
import { AddExtensionWizardComponent } from "./wizard/add-extension-wizard.component";
import { AnalyticsExtensionCardComponent } from "./analytics/manage/extension-card.component";
import { AnalyticsExtensionComponent } from "./analytics/manage/extension.component";
import { AnalyticsService } from "./shared/analytics.service";
import { AnalyticsNavigationFactory } from "./shared/analytics-navigation.factory";
import { AnalyticsTabFactory } from "./shared/analytics-tab.factory";
import { BlockGridComponent } from "./analytics/list/block.component";
import { AnalyticsAddExtensionComponent } from "./analytics/manage/extension-add.component";
import { SampleGridComponent } from "./sample/list/sample.component";
import { HttpClientModule } from "@angular/common/http";
import { NameExtensionComponent } from "./wizard/name-extension-modal.component";
import { EditorStepperComponent } from "./sample/editor/editor-stepper.component";
import { EditorModalComponent } from "./sample/editor/editor-modal.component";

const routes: Route[] = [
  {
    path: "sag-ps-pkg-analytics-extension/manage",
    component: AnalyticsExtensionComponent,
  },
  {
    path: "sag-ps-pkg-analytics-extension/list",
    component: BlockGridComponent,
  },
  {
    path: "sag-ps-pkg-analytics-extension/sample",
    component: SampleGridComponent,
  },
];
@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    BinaryFileDownloadModule,
    BsDropdownModule.forRoot(),
    //ngRouterModule.forRoot([], { enableTracing: false, useHash: true }),
    RouterModule.forRoot(),
    //RouterModule.forChild(routes),
    DefaultSubscriptionsModule,
    HttpClientModule,
  ],
  declarations: [
    AnalyticsExtensionComponent,
    AnalyticsExtensionCardComponent,
    AnalyticsAddExtensionComponent,
    AddExtensionWizardComponent,
    NameExtensionComponent,
    BlockGridComponent,
    SampleGridComponent,
    EditorStepperComponent,
    EditorModalComponent
  ],
  entryComponents: [
    AnalyticsExtensionComponent,
    AnalyticsExtensionCardComponent,
    AnalyticsAddExtensionComponent,
    AnalyticsExtensionCardComponent,
    BlockGridComponent,
    SampleGridComponent,
    EditorStepperComponent,
    EditorModalComponent
  ],
  providers: [
    AnalyticsService,
    hookNavigator(AnalyticsNavigationFactory),
    hookWizard({
      wizardId: "uploadAnalyticsExtention",
      component: AddExtensionWizardComponent,
      name: "Upload analytics extension",
      c8yIcon: "upload",
    }),
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/manage",
      component: AnalyticsExtensionComponent,
    }),
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/list",
      component: BlockGridComponent,
    }),
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/sample",
      component: SampleGridComponent,
    }),
    hookTab(AnalyticsTabFactory),
  ],
})
export class AnalyticsExtensionModule {
  constructor() {}
}
