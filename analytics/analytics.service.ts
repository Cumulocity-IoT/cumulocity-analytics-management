import { ResourceLoader } from '@angular/compiler';
import { EventEmitter, Injectable } from '@angular/core';
import {
    ApplicationService,
    ApplicationType,
    IApplication,
    ICurrentTenant,
    InventoryService,
    IResultList,
    IManagedObject
} from '@c8y/client';

import {
    AlertService,
    AppStateService,
    ModalService,
    ZipService,
    gettext,
    Status,
} from '@c8y/ngx-components';

import { TranslateService } from '@ngx-translate/core';

import { cloneDeep, get, groupBy, kebabCase, pick } from 'lodash-es';


@Injectable()
export class AnalyticsService {

    private appsGroupedByContextPath: any[];
    appDeleted = new EventEmitter<IApplication>();
    constructor(
        private modal: ModalService,
        private applicationService: ApplicationService,
        private appStateService: AppStateService,
        private alertService: AlertService,
        private translateService: TranslateService,
        private inventoryService: InventoryService
    ) { }

    getExtensions(customFilter: any = {}): Promise<IResultList<IManagedObject>> {
        const filter: object = {
             pageSize: 100,
             withTotalPages: true,
             fragmentType: 'pas_extension',
        };
        Object.assign(filter, customFilter);
        const query: object = {
         //   fragmentType: 'pas_extension',
        };
        let result;
        if (Object.keys(customFilter).length == 0  ) {
            result = this.inventoryService.list(filter);
        } else {
            result = this.inventoryService.listQuery(query, filter);
        }
        return result;
    }
    async getWebExtensions(customFilter: any = {}): Promise<IManagedObject[]> {
        return  (await this.getExtensions(customFilter)).data;
    }
    
    async canDeleteExtension(app: IApplication): Promise<boolean> {
        return true;
    }

    async deleteApp(app: IApplication): Promise<void> {
        let name = app.name;
        await this.modal.confirm(
            gettext('Delete application'),
            this.translateService.instant(
                gettext(
                    `You are about to delete application "{{ app.name }}". Do you want to proceed?`
                ),
                { name }
            ),
            Status.DANGER,
            { ok: gettext('Delete'), cancel: gettext('Cancel') }
        );
        await this.applicationService.delete(app.id);
        this.alertService.success(gettext('Application deleted.'));
        this.appDeleted.emit(app);
    }
}
