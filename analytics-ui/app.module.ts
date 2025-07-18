import { NgModule } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { RouterModule as ngRouterModule } from '@angular/router';
import { CoreModule, RouterModule } from '@c8y/ngx-components';
import { BsModalRef } from 'ngx-bootstrap/modal';
import { AnalyticsExtensionModule } from './src/analytics-extension.module';


@NgModule({
  imports: [
    BrowserAnimationsModule,
    ngRouterModule.forRoot([], { enableTracing: false, useHash: true }),
    RouterModule.forRoot(),
    CoreModule.forRoot(),
    AnalyticsExtensionModule
  ],
  providers: [BsModalRef,
  ],
})
export class AppModule {}
