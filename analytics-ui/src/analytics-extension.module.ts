import { NgModule } from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import {
  CoreModule,
  DynamicFormsModule,
  hookNavigator,
  hookRoute,
  hookTab,
  hookWizard
} from '@c8y/ngx-components';
import { BinaryFileDownloadModule } from '@c8y/ngx-components/binary-file-download';
import { ExtensionAddWizardComponent } from './shared/wizard/extension-add-wizard.component';
import { AnalyticsNavigationFactory } from './shared/analytics-navigation.factory';
import { AnalyticsTabFactory } from './shared/analytics-tab.factory';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { FORMLY_CONFIG, FormlyModule } from '@ngx-formly/core';

// Import standalone components
import { BlockGridComponent } from './block/block-grid.component';
import { EngineMonitoringComponent } from './monitoring/engine-monitoring.component';
import { ExtensionGridComponent } from './manage/extension-grid.component';
import { ExtensionCardComponent } from './manage/extension-card.component';
import { ExtensionDetailsComponent } from './manage/extension-details.component';
import { RepositoryBlockGridComponent } from './repository/list/repository-block-grid.component';
import { ExtensionListComponent } from './repository/list/extension-list.component';
import { CustomSwitchFieldComponent } from './shared/component/custom-switch-field.component';
import { ConfirmationModalComponent } from './shared/component/confirmation-modal.component';
import { EditorModalComponent } from './repository/editor/editor-modal.component';
import { ExtensionCreateModalComponent } from './repository/create-extension/extension-create-modal.component';
import { RepositoriesDrawerComponent } from './repository/drawer/repositories-drawer.component';
import { ReleaseDeployWizardComponent } from './repository/release-deploy/release-deploy-wizard.component';
import { ReleaseListComponent } from './repository/release-list/release-list.component';

import { ROUTES } from './shared/analytics.constants';

// Import resolvers
import { extensionResolver, backendResolver } from './manage/resolvers';

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    BinaryFileDownloadModule,
    PopoverModule,
    FormlyModule.forRoot({}),
    DynamicFormsModule,
    // Import standalone components
    BlockGridComponent,
    EngineMonitoringComponent,
    ExtensionGridComponent,
    ExtensionCardComponent,
    ExtensionDetailsComponent,
    RepositoryBlockGridComponent,
    ExtensionAddWizardComponent,
    ExtensionListComponent,
    CustomSwitchFieldComponent,
    // Modal components
    ConfirmationModalComponent,
    EditorModalComponent,
    ExtensionCreateModalComponent,
    RepositoriesDrawerComponent,
    ReleaseDeployWizardComponent,
    ReleaseListComponent
  ],
  providers: [
    {
      provide: FORMLY_CONFIG,
      multi: true,
      useValue: {
        types: [
          { name: 'a17t-custom-switch', component: CustomSwitchFieldComponent },
          { name: 'extension-list', component: ExtensionListComponent }
        ]
      }
    },
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
      path: ROUTES.installedBlocks,
      component: BlockGridComponent
    }),
    hookRoute({
      path: ROUTES.monitoring,
      component: EngineMonitoringComponent
    }),
    hookRoute({
      path: ROUTES.repository,
      component: RepositoryBlockGridComponent
    }),
    hookRoute({
      path: ROUTES.release,
      component: ReleaseListComponent
    }),
    hookRoute({
      path: ROUTES.manage,
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

  ]
})
export class AnalyticsExtensionModule {
  constructor() {}
}
