import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CoreModule, hookRoute } from '@c8y/ngx-components';
import { DefaultSubscriptionsModule } from '@c8y/ngx-components/default-subscriptions';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { ExtensionCardComponent } from './extension-card.component';
import { ExtensionDetailsComponent } from './extension-details.component';
import { ExtensionGridComponent } from './extension-grid.component';
import { SharedModule } from '../shared/shared.module';
import { BsDropdownModule } from 'ngx-bootstrap/dropdown';
import { extensionResolver, backendResolver } from './utils';

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
    ExtensionDetailsComponent
  ],
  providers: [
    hookRoute({
      path: 'c8y-pkg-analytics-extension/manage',
      children: [
        {
          path: '',
          pathMatch: 'full',
          component: ExtensionGridComponent, resolve: {
            isBackendServiceAvailable: backendResolver
          }
        },
        {
          path: 'details/:name',
          component: ExtensionDetailsComponent, resolve: {
            extensionFromCEP: extensionResolver
          }
        }
      ]
    })
  ]
})
export class ManageModule {
  constructor() { }
}
