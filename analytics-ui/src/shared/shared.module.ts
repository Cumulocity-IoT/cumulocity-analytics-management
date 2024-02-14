import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import { CoreModule } from "@c8y/ngx-components";
import { BinaryFileDownloadModule } from "@c8y/ngx-components/binary-file-download";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { FORMLY_CONFIG } from "@ngx-formly/core";
import { PopoverModule } from "ngx-bootstrap/popover";
import { C8YSwitchField } from "./component/c8y-switch-field";
import { ConfirmationModalComponent } from "./component/confirmation-modal.component";
import { BooleanRendererComponent } from "./component/boolean-renderer.component";
import { ExtensionCreateComponent } from "./component/extension-create-modal.component";

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    BinaryFileDownloadModule,
    DefaultSubscriptionsModule,
    PopoverModule,
  ],
  declarations: [
    ConfirmationModalComponent,
    BooleanRendererComponent,
    ExtensionCreateComponent,
    C8YSwitchField
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
