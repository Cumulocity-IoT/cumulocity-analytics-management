import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CoreModule, hookRoute } from '@c8y/ngx-components';
import { DefaultSubscriptionsModule } from '@c8y/ngx-components/default-subscriptions';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { RepositoriesModalComponent } from './repository/repositories-modal.component';
import { SampleGridComponent } from './list/sample-grid.component';
import { EditorModalComponent } from './editor/editor-modal.component';
import { SharedModule } from '../shared/shared.module';
import { EditorComponent, MonacoEditorMarkerValidatorDirective } from '@c8y/ngx-components/editor';
import { EplConfigService } from './editor/epl-config.service';
import { ExtensionCreateComponent } from './create-extension/extension-create-modal.component';
@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    DefaultSubscriptionsModule,
    PopoverModule,
    SharedModule,
    EditorComponent,
    MonacoEditorMarkerValidatorDirective
  ],
  declarations: [
    SampleGridComponent,
    RepositoriesModalComponent,
    EditorModalComponent,
    ExtensionCreateComponent,
  ],
  providers: [
    EplConfigService,
    hookRoute({
      path: 'sag-ps-pkg-analytics-extension/repository',
      component: SampleGridComponent
    })
  ]
})
export class RepositoryModule {
  constructor() { }
}
