import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  CoreModule,
  hookNavigator,
  hookRoute,
  hookTab,
  hookWizard
} from '@c8y/ngx-components';
import { BinaryFileDownloadModule } from '@c8y/ngx-components/binary-file-download';
import { DefaultSubscriptionsModule } from '@c8y/ngx-components/default-subscriptions';
import { ExtensionAddWizardComponent } from './shared/wizard/extension-add-wizard.component';
import { AnalyticsNavigationFactory } from './shared/analytics-navigation.factory';
import { AnalyticsTabFactory } from './shared/analytics-tab.factory';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { FORMLY_CONFIG } from '@ngx-formly/core';

// Import standalone components
import { BlockGridComponent as BlockGridComponentBlock } from './block/block-grid.component';
import { EngineMonitoringComponent } from './monitoring/engine-monitoring.component';
import { ExtensionGridComponent } from './manage/extension-grid.component';
import { ExtensionCardComponent } from './manage/extension-card.component';
import { ExtensionDetailsComponent } from './manage/extension-details.component';
import { BlockGridComponent as BlockGridComponentRepository } from './repository/list/block-grid.component';
import { ExtensionListComponent } from './repository/list/extension-list.component';
import { CustomSwitchField } from './shared/component/custom-switch-field';
import { ConfirmationModalComponent } from './shared/component/confirmation-modal.component';
import { EditorModalComponent } from './repository/editor/editor-modal.component';
import { ExtensionCreateComponent } from './repository/create-extension/extension-create-modal.component';
import { RepositoriesDrawerComponent } from './repository/repository/repositories-drawer.component';

// Import resolvers
import { extensionResolver, backendResolver } from './manage/utils';

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    BinaryFileDownloadModule,
    DefaultSubscriptionsModule,
    PopoverModule,
    // Import standalone components
    BlockGridComponentBlock,
    EngineMonitoringComponent,
    ExtensionGridComponent,
    ExtensionCardComponent,
    ExtensionDetailsComponent,
    BlockGridComponentRepository,
    ExtensionAddWizardComponent,
    ExtensionListComponent,
    CustomSwitchField,
    // Modal components
    ConfirmationModalComponent,
    EditorModalComponent,
    ExtensionCreateComponent,
    RepositoriesDrawerComponent
  ],
  providers: [
    // Navigation and tab hooks
    hookNavigator(AnalyticsNavigationFactory),
    hookTab(AnalyticsTabFactory),

    // Wizard hook
    hookWizard({
      wizardId: 'uploadAnalyticsExtension',
      component: ExtensionAddWizardComponent,
      name: 'Upload analytics extension',
      c8yIcon: 'upload'
    }),

    // Route hooks from all modules
    hookRoute({
      path: 'c8y-pkg-analytics-extension/block',
      component: BlockGridComponentBlock
    }),
    hookRoute({
      path: 'c8y-pkg-analytics-extension/monitoring',
      component: EngineMonitoringComponent
    }),
    hookRoute({
      path: 'c8y-pkg-analytics-extension/repository',
      component: BlockGridComponentRepository
    }),
    hookRoute({
      path: 'c8y-pkg-analytics-extension/manage',
      children: [
        {
          path: '',
          pathMatch: 'full',
          component: ExtensionGridComponent,
          resolve: {
            isBackendServiceAvailable: backendResolver
          }
        },
        {
          path: 'details/:name',
          component: ExtensionDetailsComponent,
          resolve: {
            extensionFromCep: extensionResolver
          }
        }
      ]
    }),

    // Formly configuration for custom field types
    {
      provide: FORMLY_CONFIG,
      multi: true,
      useValue: {
        types: [
          { name: 'a17t-custom-switch', component: CustomSwitchField },
          {
            name: 'extension-list',
            component: ExtensionListComponent,
            wrappers: ['c8y-form-field']
          }
        ]
      }
    }
  ]
})
export class AnalyticsExtensionModule {
  constructor() {}
}
