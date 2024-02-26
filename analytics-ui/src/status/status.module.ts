import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CoreModule, hookRoute } from '@c8y/ngx-components';
import { DefaultSubscriptionsModule } from '@c8y/ngx-components/default-subscriptions';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { EngineStatusComponent } from './engine-status.component';
import { SharedModule } from '../shared/shared.module';
import { BsDropdownModule } from 'ngx-bootstrap/dropdown';
import { CollapseModule } from 'ngx-bootstrap/collapse';

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    DefaultSubscriptionsModule,
    PopoverModule,
    SharedModule,
    BsDropdownModule.forRoot(),
    CollapseModule.forRoot()
  ],
  declarations: [EngineStatusComponent],
  providers: [
    hookRoute({
      path: 'sag-ps-pkg-analytics-extension/status',
      component: EngineStatusComponent
    })
  ]
})
export class StatusModule {
  constructor() {}
}
