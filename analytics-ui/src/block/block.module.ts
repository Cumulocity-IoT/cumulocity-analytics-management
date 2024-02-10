import { NgModule } from "@angular/core";
import { FormsModule, ReactiveFormsModule } from "@angular/forms";
import {
  CoreModule,
  hookRoute,
} from "@c8y/ngx-components";
import { DefaultSubscriptionsModule } from "@c8y/ngx-components/default-subscriptions";
import { PopoverModule } from 'ngx-bootstrap/popover';
import { BlockGridComponent } from "./block-grid.component";
import { SharedModule } from '../shared/shared.module';

@NgModule({
  imports: [
    CoreModule,
    FormsModule,
    ReactiveFormsModule,
    DefaultSubscriptionsModule,
    PopoverModule,
    SharedModule
  ],
  declarations: [
    BlockGridComponent,
  ],
  providers: [
    hookRoute({
      path: "sag-ps-pkg-analytics-extension/list",
      component: BlockGridComponent,
    }),
  ],
})
export class BlockModule {
  constructor() {}
}
