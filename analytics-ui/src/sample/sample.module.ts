import { HttpClientModule } from "@angular/common/http";
import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  CoreModule,
  hookRoute,
} from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { CollapseModule } from "ngx-bootstrap/collapse";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";
import { PopoverModule } from 'ngx-bootstrap/popover';
import { RepositoriesModalComponent } from "./list/repositories-modal.component";
import { SampleGridComponent } from "./list/sample-grid.component";
import { EditorStepperComponent } from "./editor/editor-stepper.component";
import { EditorModalComponent } from "./editor/editor-modal.component";
import { AnalyticsService } from "../shared/analytics.service";
import { RepositoryService } from "../shared/repository.service";

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
    CollapseModule.forRoot()
  ],
  declarations: [
    SampleGridComponent,
    RepositoriesModalComponent,
    EditorStepperComponent,
    EditorModalComponent
  ],
  providers: [
    AnalyticsService,
    RepositoryService,
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/sample",
      component: SampleGridComponent,
    }),
  ],
})
export class SampleModule {
  constructor() {}
}
