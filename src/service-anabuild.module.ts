import { CommonModule } from '@angular/common';
import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  CoreModule,
  HOOK_NAVIGATOR_NODES,
  HOOK_ROUTE,
  HOOK_WIZARD,
  Route
} from '@c8y/ngx-components';
import { BinaryFileDownloadModule } from '@c8y/ngx-components/binary-file-download';
import { DefaultSubscriptionsModule } from '@c8y/ngx-components/default-subscriptions';
import { AddAnalyticsExtensionComponent } from './analytics/add-analytics-extension.component';
import { AddExtensionComponent } from './analytics/add-extension.component';
import { AnalyticsCardComponent } from './analytics/analytics-card.component';
import { AnalyticsComponent } from './analytics/analytics.component';
import { AnalyticsService } from './analytics/analytics.service';
import { AnalyticsNavigationFactory } from './factories/analytics-navigation.factory';

@NgModule({
  imports: [
    CoreModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule.forChild([{
      path: 'analytics-extensions',
      pathMatch: 'full',
      component: AnalyticsComponent
    }]),
    BinaryFileDownloadModule,
    DefaultSubscriptionsModule,
  ],
  declarations: [AnalyticsComponent, AnalyticsCardComponent, AddExtensionComponent, AddAnalyticsExtensionComponent],
  entryComponents: [AnalyticsComponent, AnalyticsCardComponent, AddExtensionComponent, AddAnalyticsExtensionComponent],
  providers: [
    AnalyticsService,
    { provide: HOOK_NAVIGATOR_NODES, useClass: AnalyticsNavigationFactory, multi: true },
    {
      provide: HOOK_WIZARD,
      useValue: {
        wizardId: 'uploadAnalyticsExtention',
        component: AddAnalyticsExtensionComponent,
        name: 'Upload analytics extension',
        c8yIcon: 'upload'
      },
      multi: true
    },
    {
      provide: HOOK_ROUTE,
      useValue: [
        {
          path: 'analytics-extensions',
          component: AnalyticsComponent,
        },
      ] as Route[],
      multi: true,
    },
  ]
})
export class AnaBuildModule  {
  constructor() {
  }
}
