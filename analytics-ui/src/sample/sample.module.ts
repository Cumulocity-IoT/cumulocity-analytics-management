import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  CoreModule,
  hookRoute,
} from "@c8y/ngx-components";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { PopoverModule } from 'ngx-bootstrap/popover';
import { RepositoriesModalComponent } from "./list/repositories-modal.component";
import { SampleGridComponent } from "./list/sample-grid.component";
import { EditorStepperComponent } from "./editor/editor-stepper.component";
import { EditorModalComponent } from "./editor/editor-modal.component";
import { SharedModule } from '../shared/shared.module';

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    DefaultSubscriptionsModule,
    PopoverModule,
    SharedModule
  ],
  declarations: [
    SampleGridComponent,
    RepositoriesModalComponent,
    EditorStepperComponent,
    EditorModalComponent
  ],
  providers: [
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/sample",
      component: SampleGridComponent,
    }),
  ],
})
export class SampleModule {
  constructor() {}
}
