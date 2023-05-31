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
import { BsDropdownModule } from 'ngx-bootstrap/dropdown';
import { AnalyticsExtensionWizardComponent } from './wizard/analytics-extension-wizard.component';
import { AnalyticsAddExtensionComponent } from './analytics/analytics-add-extension.component';
import { AnalyticsExtensionCardComponent } from './analytics/analytics-extension-card.component';
import { AnalyticsComponent } from './analytics/analytics.component';
import { AnalyticsService } from './shared/analytics.service';
import { AnalyticsNavigationFactory } from './factories/analytics-navigation.factory';

@NgModule({
  imports: [
    CoreModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterModule.forChild([{
      path: 'sag-ps-pkg-analytics-extensions',
      pathMatch: 'full',
      component: AnalyticsComponent
    }]),
    BinaryFileDownloadModule,
    BsDropdownModule.forRoot(),
    DefaultSubscriptionsModule,
  ],
  declarations: [AnalyticsComponent, AnalyticsExtensionCardComponent, AnalyticsAddExtensionComponent, AnalyticsExtensionWizardComponent],
  entryComponents: [AnalyticsComponent, AnalyticsExtensionCardComponent, AnalyticsAddExtensionComponent, AnalyticsExtensionWizardComponent],
  providers: [
    AnalyticsService,
    { provide: HOOK_NAVIGATOR_NODES, useClass: AnalyticsNavigationFactory, multi: true },
    {
      provide: HOOK_WIZARD,
      useValue: {
        wizardId: 'uploadAnalyticsExtention',
        component: AnalyticsExtensionWizardComponent,
        name: 'Upload analytics extension',
        c8yIcon: 'upload'
      },
      multi: true
    },
    {
      provide: HOOK_ROUTE,
      useValue: [
        {
          path: 'sag-ps-pkg-analytics-extensions',
          component: AnalyticsComponent,
        },
      ] as Route[],
      multi: true,
    },
  ]
})
export class AnalyticsExtensionModule  {
  constructor() {
  }
}
