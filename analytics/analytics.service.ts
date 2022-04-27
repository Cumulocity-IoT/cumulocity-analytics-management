import { ResourceLoader } from '@angular/compiler';
import { EventEmitter, Injectable } from '@angular/core';
import {
    ApplicationService,
    ApplicationType,
    IApplication,
    ICurrentTenant,
    InventoryService,
    IResultList,
    IManagedObject,
    InventoryBinaryService
} from '@c8y/client';

import {
    AlertService,
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
    appDeleted = new EventEmitter<IManagedObject>();
    constructor(
        private modal: ModalService,
        private alertService: AlertService,
        private translateService: TranslateService,
        private inventoryService: InventoryService,
        private inventoryBinaryService: InventoryBinaryService
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
    
    async deleteExtension(app: IManagedObject): Promise<void> {
        let name = app.name;
        await this.modal.confirm(
            gettext('Delete extension'),
            this.translateService.instant(
                gettext(
                    `You are about to delete extension "{{name}}". Do you want to proceed?`
                ),
                { name }
            ),
            Status.DANGER,
            { ok: gettext('Delete'), cancel: gettext('Cancel') }
        );
        await this.inventoryBinaryService.delete(app.id);
        this.alertService.success(gettext('Extension deleted.'));
        this.appDeleted.emit(app);
    }
}
