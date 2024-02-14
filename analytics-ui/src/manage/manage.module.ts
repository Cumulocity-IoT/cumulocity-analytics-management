import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import { CoreModule, hookRoute } from "@c8y/ngx-components";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { PopoverModule } from "ngx-bootstrap/popover";
import { ExtensionCardComponent } from "./extension-card.component";
import { ExtensionDetailsComponent } from "./extension-details.component";
import { ExtensionGridComponent } from "./extension-grid.component";
import { RescueModalComponent } from "./rescue/rescue-modal.component";
import { SharedModule } from "../shared/shared.module";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    DefaultSubscriptionsModule,
    PopoverModule,
    BsDropdownModule.forRoot(),
    SharedModule
  ],
  declarations: [
    ExtensionGridComponent,
    ExtensionCardComponent,
    ExtensionDetailsComponent,
    RescueModalComponent,
  ],
  providers: [
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/manage",
      children: [
        {
          path: "",
          pathMatch: "full",
          component: ExtensionGridComponent,
        },
        {
          path: "properties/:name",
          component: ExtensionDetailsComponent,
        },
      ],
    }),
  ],
})
export class ManageModule {
  constructor() {}
}
