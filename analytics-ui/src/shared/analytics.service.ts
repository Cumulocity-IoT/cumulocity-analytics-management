import { EventEmitter, Injectable } from '@angular/core';
import {
  ApplicationService,
  FetchClient,
  IFetchOptions,
  IFetchResponse,
  IManagedObject,
  IManagedObjectBinary,
  InventoryBinaryService,
  InventoryService,
  IResultList,
  Realtime
} from '@c8y/client';

import {
  AlertService,
  gettext,
  ModalService,
  Status
} from '@c8y/ngx-components';

import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Subject } from 'rxjs';
import {
  CEP_Block,
  CEP_Extension,
  CEP_ExtensionsMetadata,
  CEP_PATH_EN,
  CEP_PATH_METADATA_EN,
  CEP_PATH_STATUS,
  BACKEND_PATH_BASE,
  EXTENSION_ENDPOINT,
  APPLICATION_ANALYTICS_BUILDER_SERVICE,
  CEP_METADATA_FILE_EXTENSION,
  CEP_ENDPOINT
} from './analytics.model';
import { isCustomCEP_Block, removeFileExtension } from './utils';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  appDeleted = new EventEmitter<IManagedObject>();
  progress: BehaviorSubject<number> = new BehaviorSubject<number>(null);
  private _cepId: Promise<string>;
  private _cepStatus: Promise<any>;
  private _blocksDeployed: Promise<CEP_Block[]>;
  private _extensionsDeployed: Promise<IManagedObject[]>;
  private _isBackendDeployed: Promise<boolean>;
  private restarting$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(
    false
  );
  private realtime: Realtime;

  constructor(
    private modal: ModalService,
    private alertService: AlertService,
    private translateService: TranslateService,
    private inventoryService: InventoryService,
    private inventoryBinaryService: InventoryBinaryService,
    private fetchClient: FetchClient,
    private applicationService: ApplicationService
  ) {
    this.realtime = new Realtime(this.fetchClient);
  }

  getExtensions(): Promise<IResultList<IManagedObject>> {
    const filter: object = {
      pageSize: 100,
      withTotalPages: true,
      fragmentType: 'pas_extension'
    };
    const result = this.inventoryService.list(filter);
    return result;
  }

  async createExtensionZIP(
    name: string,
    upload: boolean,
    deploy: boolean,
    monitors: string[]
  ): Promise<IFetchResponse> {
    console.log(`Create extensions for : ${name},  ${monitors},`);
    return this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${EXTENSION_ENDPOINT}`,
      {
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          extension_name: name,
          upload: upload,
          deploy: deploy,
          monitors: monitors
        }),
        method: 'POST',
        responseType: 'blob'
      }
    );
  }

  async getExtensionsEnriched(): Promise<IManagedObject[]> {
    if (!this._extensionsDeployed) {
      const { data } = await this.getExtensions();
      const extensions = data;
      const loadedExtensions: CEP_ExtensionsMetadata =
        await this.getCEP_ExtensionsMetadata();
      for (let index = 0; index < extensions.length; index++) {
        extensions[index].name = removeFileExtension(extensions[index].name);
        const key = extensions[index].name + CEP_METADATA_FILE_EXTENSION;
        extensions[index].loaded = loadedExtensions?.metadatas?.some((le) =>
          key.includes(le)
        );
        if (extensions[index].loaded) {
          const extensionDetails = await this.getCEP_Extension(
            extensions[index].name
          );
          extensions[index].blocksCount = extensionDetails?.analytics.length;
        }
      }

      this._extensionsDeployed = Promise.resolve(extensions);
    }
    return this._extensionsDeployed;
  }

  async deleteExtension(app: IManagedObject): Promise<void> {
    const { name } = app;
    await this.modal.confirm(
      gettext('Delete extension'),
      this.translateService.instant(
        gettext(
          'You are about to delete extension "{{name}}". Do you want to proceed?'
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

  async clearCaches() {
    this._blocksDeployed = undefined;
    this._extensionsDeployed = undefined;
    this._cepId = undefined;
  }

  async getLoadedCEP_Blocks(): Promise<CEP_Block[]> {
    if (!this._blocksDeployed) {
      const blocks: CEP_Block[] = [];
      const meta: CEP_ExtensionsMetadata =
        await this.getCEP_ExtensionsMetadata();
      if (meta && meta.metadatas) {
        for (let index = 0; index < meta.metadatas.length; index++) {
          const extensionNameAbbreviated = removeFileExtension(
            meta.metadatas[index]
          );
          const extension: CEP_Extension = await this.getCEP_Extension(
            extensionNameAbbreviated
          );
          extension.analytics.forEach((block) => {
            const cepBlock = block as CEP_Block;
            cepBlock.custom = isCustomCEP_Block(cepBlock);
            cepBlock.extension = extensionNameAbbreviated;
            // console.log("Inspect CEP_Block:", cepBlock.name, cepBlock.id, cepBlock.extension, cepBlock.custom)
            blocks.push(cepBlock);
          });
        }
      }
      this._blocksDeployed = Promise.resolve(blocks);
    }
    return this._blocksDeployed;
  }

  async getCEP_ExtensionsMetadata(): Promise<CEP_ExtensionsMetadata> {
    const response: IFetchResponse = await this.fetchClient.fetch(
      `/${CEP_PATH_METADATA_EN}`,
      {
        headers: {
          'content-type': 'application/json'
        },
        method: 'GET'
      }
    );
    const data = await response.json();
    return data;
  }

  async getCEP_Extension(name: string): Promise<CEP_Extension> {
    const response: IFetchResponse = await this.fetchClient.fetch(
      `${CEP_PATH_EN}/${name}.json`,
      {
        headers: {
          'content-type': 'application/json'
        },
        method: 'GET'
      }
    );
    let data;
    if (response.status < 400) {
      data = await response.json();
      data.name = name;
    }
    return data;
  }

  async getCEP_Id(): Promise<string> {
    let cepId: string;
    if (!this._cepId) {
      const useBackend = true;
      if (useBackend) {
        // get name of microservice from cep endpoint
        const response: IFetchResponse = await this.fetchClient.fetch(
          `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/id`,
          {
            headers: {
              'content-type': 'application/json'
            },
            method: 'GET'
          }
        );
        const data = await response.json();
        cepId = data.id;
      } else {
        // get name of microservice from cep endpoint
        const response: IFetchResponse = await this.fetchClient.fetch(
          `${CEP_PATH_STATUS}`,
          {
            headers: {
              'content-type': 'application/json'
            },
            method: 'GET'
          }
        );
        if (response.status < 400) {
          const data1 = await response.json();
          const cepMicroservice = data1.microservice_name;
          const { microservice_application_id } = data1;

          // get source id of microservice representation in inventory
          const filter: object = {
            pageSize: 100,
            withTotalPages: true
          };
          const query: object = {
            name: cepMicroservice,
            applicationId: microservice_application_id
          };
          const { data }: IResultList<IManagedObject> =
            await this.inventoryService.listQuery(query, filter);
          console.log('Found ctrl-microservice:', data1, data);
          if (!data || data.length > 1) {
            this.alertService.warning(
              "Can't find ctrl-microservice for Streaming Analytics! Please report this issue."
            );
            return;
          }
          cepId = data[0].id;
        }
      }
      this._cepId = Promise.resolve(cepId);
    }
    return this._cepId;
  }

  getCEP_Restarting(): Subject<boolean> {
    return this.restarting$;
  }

  async getCEP_Status(): Promise<any> {
    let response: IFetchResponse;
    if (!this._cepStatus) {
      const useBackend = false;
      if (useBackend) {
        // get name of microservice from cep endpoint
        response = await this.fetchClient.fetch(
          `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/status`,
          {
            headers: {
              'content-type': 'application/json'
            },
            method: 'GET'
          }
        );
      } else {
        // get name of microservice from cep endpoint
        response = await this.fetchClient.fetch(`${CEP_PATH_STATUS}`, {
          headers: {
            'content-type': 'application/json'
          },
          method: 'GET'
        });
      }
      this._cepStatus = response.json();
    }
    return this._cepStatus;
  }

  async subscribeMonitoringChannel(): Promise<object> {
    const cepId = await this.getCEP_Id();
    console.log('Started subscription on :', cepId);
    const subMO = this.realtime.subscribe(
      `/managedobjects/${cepId}`,
      this.updateStatusFromMO.bind(this)
    );
    return subMO;

    // const sub = this.realtime.subscribe(
    //     `/events/${cepId}`,
    //     this.updateStatus.bind(this)
    //   );
    //   this.subscription = this.restart$
    //     .pipe(
    //       pairwise(),
    //       tap((pair) => {
    //         const [prev, current] = pair;
    //         console.log(`Message: prev: ${prev}, current: ${current}`);
    //       }),
    //       // filter(([prev, current]) => prev === STATUS_MESSAGE_01),
    //       // Cleansed message: prev: Recording apama-ctrl safe mode state, current: Deployment was changed
    //       filter(([prev, current]) => !!current),
    //       tap((pair) => {
    //         const [prev, current] = pair;
    //         console.log(`Cleansed message: prev: ${prev}, current: ${current}`);
    //       }),
    //       filter(
    //         ([prev, current]) =>
    //           prev === STATUS_MESSAGE_01 && current === STATUS_MESSAGE_02
    //       ),
    //       map(([prev, current]) => [prev, current])
    //     )
    //     .subscribe((pair) => {
    //       const [prev, current] = pair;
    //       // this.alertService.warning(
    //       //   `Message: prev: ${prev}, current: ${current}`
    //       // );
    //       if (current == STATUS_MESSAGE_02)
    //         this.alertService.success(`Deployment successful`);
    //       this.restarting$.next(false);
    //     });
    //   return sub;
  }

  unsubscribeFromMonitoringChannel(subscription: any) {
    this.realtime.unsubscribe(subscription);
  }

  private updateStatusFromMO(p: object): void {
    const payload = p['data']['data'];
    this.restarting$.next(payload?.c8y_Status.status == 'Down');
    if (payload?.c8y_Status.status == 'Up') {
      this._cepStatus = undefined;
      // cache new cep status
      this.getCEP_Status();
    }
    // console.log("New updateStatusFromMO for cep:", payload);
  }

  updateUploadProgress(event): void {
    if (event.lengthComputable) {
      const currentProgress = this.progress.value;
      this.progress.next(
        currentProgress + (event.loaded / event.total) * (95 - currentProgress)
      );
    }
  }

  async restartCEP(): Promise<any> {
    const formData = new FormData();
    const fetchOptions: IFetchOptions = {
      method: 'PUT',
      body: formData,
      // headers: { 'content-type': 'multipart/form-data', accept: 'application/json' },
      headers: { accept: 'application/json' }
    };
    const url = '/service/cep/restart';
    await this.fetchClient.fetch(url, fetchOptions);
    // this.alertService.success(gettext("Deployment (restart) submitted ..."));
    this.clearCaches();
  }

  async uploadExtension(
    archive: File,
    app: Partial<IManagedObject>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    restart: boolean = false
  ): Promise<IManagedObjectBinary> {
    const result = (await this.inventoryBinaryService.create(archive, app))
      .data;
    return result;
  }

  cancelExtensionCreation(app: Partial<IManagedObject>): void {
    if (app) {
      this.inventoryBinaryService.delete(app);
    }
  }

  async downloadExtension(app: IManagedObject): Promise<ArrayBuffer> {
    const response: IFetchResponse =
      await this.inventoryBinaryService.download(app);
    console.log('Downloading Extension', app);
    return response.arrayBuffer();
  }

  async isBackendDeployed(): Promise<boolean> {
    if (!this._isBackendDeployed) {
      this._isBackendDeployed = this.applicationService
        .isAvailable(APPLICATION_ANALYTICS_BUILDER_SERVICE)
        .then((av) => {
          let result = false;
          if (av) {
            result = av.data;
          }
          return result;
        });
    }
    return this._isBackendDeployed;
  }
}
