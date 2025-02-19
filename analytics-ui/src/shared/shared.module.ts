import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CoreModule } from '@c8y/ngx-components';
import { BinaryFileDownloadModule } from '@c8y/ngx-components/binary-file-download';
import { DefaultSubscriptionsModule } from '@c8y/ngx-components/default-subscriptions';
import { FORMLY_CONFIG } from '@ngx-formly/core';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { CustomSwitchField } from './component/custom-switch-field';
import { ConfirmationModalComponent } from './component/confirmation-modal.component';
import { BooleanRendererComponent } from './component/boolean-renderer.component';
import { LinkRendererComponent } from './component/link-renderer.component';
import { LabelRendererComponent } from './renderer/label.renderer';
import { RepositoryService } from './repository.service';

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    BinaryFileDownloadModule,
    DefaultSubscriptionsModule,
    PopoverModule
  ],
  declarations: [
    ConfirmationModalComponent,
    BooleanRendererComponent,
    LinkRendererComponent,
    CustomSwitchField,
    LabelRendererComponent
  ],
  providers: [
    RepositoryService,
    {
      provide: FORMLY_CONFIG,
      multi: true,
      useValue: {
        types: [{ name: 'a17t-custom-switch', component: CustomSwitchField }]
      }
    }
  ]
})
export class SharedModule {
  constructor() { }
}
