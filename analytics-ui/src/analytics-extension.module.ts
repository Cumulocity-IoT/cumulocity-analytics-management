import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import { Route, RouterModule as ngRouterModule } from "@angular/router";
import {
  CoreModule,
  hookNavigator,
  hookRoute,
  hookTab,
  hookWizard,
} from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { AddExtensionWizardComponent } from "./component/add-extension-wizard.component";
import { AnalyticsExtensionCardComponent } from "./analytics/manage/extension-card.component";
import { AnalyticsExtensionComponent } from "./analytics/manage/extension.component";
import { AnalyticsService } from "./shared/analytics.service";
import { AnalyticsNavigationFactory } from "./shared/analytics-navigation.factory";
import { AnalyticsTabFactory } from "./shared/analytics-tab.factory";
import { BlockGridComponent } from "./analytics/list/block.component";
import { AnalyticsAddExtensionComponent } from "./analytics/manage/extension-add.component";
import { SampleGridComponent } from "./sample/list/sample.component";
import { HttpClientModule } from "@angular/common/http";
import { CreateExtensionComponent } from "./component/create-extension-modal.component";
import { EditorStepperComponent } from "./sample/editor/editor-stepper.component";
import { EditorModalComponent } from "./sample/editor/editor-modal.component";
import { RepositoriesModalComponent } from "./sample/editor/repositories-modal.component";
import { RepositoryService } from "./shared/repository.service";
import { FORMLY_CONFIG } from "@ngx-formly/core";
import { C8YSwitchField } from "./component/c8y-switch-field";
import { AnalyticsExtensionDetailsComponent } from "./analytics/manage/extension-details.component";
import { ConfirmationModalComponent } from "./component/confirmation-modal.component";
import { BoolenRendererComponent } from "./shared/boolean-renderer.component";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";

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
    DefaultSubscriptionsModule,
    HttpClientModule,
    BsDropdownModule.forRoot(),
  ],
  declarations: [
    AnalyticsExtensionComponent,
    AnalyticsExtensionCardComponent,
    AnalyticsAddExtensionComponent,
    AddExtensionWizardComponent,
    CreateExtensionComponent,
    BlockGridComponent,
    SampleGridComponent,
    EditorStepperComponent,
    EditorModalComponent,
    RepositoriesModalComponent,
    AnalyticsExtensionDetailsComponent,
    C8YSwitchField,
    ConfirmationModalComponent,
    BoolenRendererComponent
  ],
  entryComponents: [
    AnalyticsExtensionComponent,
    AnalyticsExtensionCardComponent,
    AnalyticsAddExtensionComponent,
    AnalyticsExtensionCardComponent,
    BlockGridComponent,
    SampleGridComponent,
    EditorStepperComponent,
    EditorModalComponent,
    RepositoriesModalComponent,
    AnalyticsExtensionDetailsComponent,
    ConfirmationModalComponent,
    BoolenRendererComponent
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
      path: "sag-ps-pkg-analytics-extension/manage",
      children:[
        {
          path: "",
          pathMatch: "full",
          component: AnalyticsExtensionComponent,
        },
        {
          path: "properties/:name",
          component: AnalyticsExtensionDetailsComponent,
        },
      ]
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
    {
      provide: FORMLY_CONFIG,
      multi: true,
      useValue: {
        types: [
          { name: "custom-switch", component: C8YSwitchField },
        ],
      },
    },
  ],
})
export class AnalyticsExtensionModule {
  constructor() {}
}
