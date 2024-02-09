import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  CoreModule,
  hookNavigator,
  hookRoute,
  hookWizard,
} from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { AddExtensionWizardComponent } from "../shared/component/add-extension-wizard.component";
import { AnalyticsExtensionCardComponent } from "./extension-card.component";
import { AnalyticsExtensionComponent } from "./extension.component";
import { AnalyticsService } from "../shared/analytics.service";
import { AnalyticsAddExtensionComponent } from "./extension-add.component";
import { HttpClientModule } from "@angular/common/http";
import { RepositoryService } from "../shared/repository.service";
import { AnalyticsExtensionDetailsComponent } from "./extension-details.component";
import { BoolenRendererComponent } from "../shared/component/boolean-renderer.component";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";
import { CollapseModule } from "ngx-bootstrap/collapse";
import { PopoverModule } from 'ngx-bootstrap/popover';
import { RescueModalComponent } from "./rescue/rescue-modal.component";



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
    AnalyticsExtensionComponent,
    AnalyticsExtensionCardComponent,
    AnalyticsAddExtensionComponent,
    AddExtensionWizardComponent,
    AnalyticsExtensionDetailsComponent,
    RescueModalComponent
  ],
  providers: [
    AnalyticsService,
    RepositoryService,
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
  ],
})
export class ExtensionModule {
  constructor() {}
}
