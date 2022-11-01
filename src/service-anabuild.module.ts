import { NgModule } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule as NgRouterModule } from '@angular/router';
import { UpgradeModule as NgUpgradeModule } from '@angular/upgrade/static';
import { CoreModule, HOOK_NAVIGATOR_NODES, HOOK_WIZARD, RouterModule } from '@c8y/ngx-components';
import { AppLogsAutoRefreshModule } from '@c8y/ngx-components/app-logs';
import { ConnectivityModule, SimModule } from '@c8y/ngx-components/connectivity';
import { SmsGatewayModule } from '@c8y/ngx-components/sms-gateway';
import { HybridAppModule, UpgradeModule, UPGRADE_ROUTES } from '@c8y/ngx-components/upgrade';
import { BinaryFileDownloadModule } from '@c8y/ngx-components/binary-file-download';
import { DefaultSubscriptionsModule } from '@c8y/ngx-components/default-subscriptions';
import { EcosystemModule } from '@c8y/ngx-components/ecosystem';
import { TenantsModule } from '@c8y/ngx-components/tenants';
import { AuthConfigurationModule } from '@c8y/ngx-components/auth-configuration';
import { AnalyticsNavigationFactory } from './factories/analytics-navigation.factory';
import { AnalyticsComponent } from './analytics/analytics.component';
import { AnalyticsService } from './analytics/analytics.service';
import { AnalyticsCardComponent } from './analytics/analytics-card.component';
import { AddAnalyticsExtensionComponent } from './analytics/add-analytics-extension.component';
import { AddExtensionComponent } from './analytics/add-extension.component';

@NgModule({
  imports: [
    // Upgrade module must be the first
    UpgradeModule,
    BrowserAnimationsModule,
    RouterModule.forRoot(),
    NgRouterModule.forRoot([{
      path: 'extensions',
      component: AnalyticsComponent
    },
    ...UPGRADE_ROUTES], { enableTracing: false, useHash: true }),
    CoreModule.forRoot(),
    NgUpgradeModule,
    AppLogsAutoRefreshModule,
    SmsGatewayModule,
    ConnectivityModule,
    SimModule,
    BinaryFileDownloadModule,
    DefaultSubscriptionsModule,
    EcosystemModule,
    AuthConfigurationModule,
    TenantsModule
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
  ]
})
export class AnaBuildModule extends HybridAppModule {
  constructor(protected upgrade: NgUpgradeModule) {
    super();
  }
}
