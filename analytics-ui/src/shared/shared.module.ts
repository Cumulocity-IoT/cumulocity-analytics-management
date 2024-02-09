import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import { CoreModule } from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { FORMLY_CONFIG } from "@ngx-formly/core";
import { BsDropdownModule } from "ngx-bootstrap/dropdown";
import { CollapseModule } from "ngx-bootstrap/collapse";
import { PopoverModule } from "ngx-bootstrap/popover";
import { C8YSwitchField } from "./component/c8y-switch-field";
import { ConfirmationModalComponent } from "./component/confirmation-modal.component";
import { BoolenRendererComponent } from "./component/boolean-renderer.component";
import { CreateExtensionComponent } from "./component/create-extension-modal.component";

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    BinaryFileDownloadModule,
    DefaultSubscriptionsModule,
    BsDropdownModule.forRoot(),
    PopoverModule,
    CollapseModule.forRoot(),
  ],
  declarations: [
    C8YSwitchField,
    ConfirmationModalComponent,
    BoolenRendererComponent,
    CreateExtensionComponent
  ],
  providers: [
    {
      provide: FORMLY_CONFIG,
      multi: true,
      useValue: {
        types: [{ name: "custom-switch", component: C8YSwitchField }],
      },
    },
  ],
})
export class SharedModule {
  constructor() {}
}
