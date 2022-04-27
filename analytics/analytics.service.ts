import { EventEmitter, Injectable } from '@angular/core';
import {
    ApplicationService,
    ApplicationType,
    IApplication,
    ICurrentTenant,
    IResultList,
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
    ) { }

    getExtensions(customFilter: any = {}): Promise<IResultList<IApplication>> {
        const filter: object = {
            pageSize: 2000,
            withTotalPages: true
        };
        Object.assign(filter, customFilter);
        const currentTenant = this.appStateService.currentTenant.value;
        return this.applicationService.listByTenant(currentTenant.name, filter);
    }


    async getWebExtensions(customFilter: any = {}): Promise<IApplication[]> {
        const apps = (await this.getExtensions(customFilter)).data;
        const webApps = apps.filter(app => this.isApplication(app));
        this.appsGroupedByContextPath = groupBy(webApps, 'contextPath');
        return webApps.sort((a, b) => a.name.localeCompare(b.name));
    }

    isApplication(app: IApplication): boolean {
        return (
            app.type !== ApplicationType.MICROSERVICE && !this.isFeature(app) && !this.isPackage(app)
        );
    }
    isFeature(app: IApplication): boolean {
        return !!app.name.match(/feature-/);
    }

    isPackage(app: IApplication): boolean {
        return app.manifest?.isPackage === true;
    }

    isOwner(app: IApplication): boolean {
        const currentTenant: ICurrentTenant = this.appStateService.currentTenant.value;
        const appOwner = get(app, 'owner.tenant.id');
        return currentTenant.name === appOwner;
    }

    private isCurrentApp(app: IApplication): boolean {
        const currentApp = this.appStateService.state.app;
        return currentApp.contextPath === app.contextPath;
    }

    async canDeleteExtension(app: IApplication): Promise<boolean> {
        return (
            this.isOwner(app) && ((await this.hasSubscribedAppParent(app)) || !this.isCurrentApp(app))
        );
    }

    async hasSubscribedAppParent(app: IApplication): Promise<boolean> {
        if (!this.appsGroupedByContextPath) {
            await this.getWebExtensions();
        }
        return app.contextPath && this.appsGroupedByContextPath[app.contextPath]?.length === 2;
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
