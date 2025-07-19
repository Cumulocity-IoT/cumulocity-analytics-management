import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CoreModule, hookRoute } from '@c8y/ngx-components';
import { DefaultSubscriptionsModule } from '@c8y/ngx-components/default-subscriptions';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { EngineMonitoringComponent } from './engine-monitoring.component';
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
  declarations: [EngineMonitoringComponent],
  providers: [
    hookRoute({
      path: 'c8y-pkg-analytics-extension/monitoring',
      component: EngineMonitoringComponent
    })
  ]
})
export class MonitoringModule {
  constructor() {}
}
