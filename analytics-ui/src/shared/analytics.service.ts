/* eslint-disable @typescript-eslint/no-unused-vars */
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
  Realtime,
} from '@c8y/client';

import { AlertService, gettext } from '@c8y/ngx-components';

import { BehaviorSubject, Observable, ReplaySubject, shareReplay, Subject } from 'rxjs';
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
  CEP_METADATA_FILE_EXTENSION_1,
  CEP_ENDPOINT,
  CEPStatusObject,
  UploadMode,
  CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES,
  CEP_METADATA_FILE_EXTENSION_2,
  Repository
} from './analytics.model';
import { isCustomCEP_Block, removeFileExtension } from './utils';

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  extensionChanged = new EventEmitter<IManagedObject>();
  progress: BehaviorSubject<number> = new BehaviorSubject<number>(null);
  private _cepOperationObjectId: Promise<string>;
  private _cepCtrlStatus: Promise<CEPStatusObject>;
  private _blocksDeployed: Promise<CEP_Block[]>;
  private _extensionsDeployed: Promise<IManagedObject[]>;
  private _isBackendDeployed: Promise<boolean>;
  private cepOperationObject$: ReplaySubject<IManagedObject> =
    new ReplaySubject<IManagedObject>(1);
  private realtime: Realtime;
  private reloadThroughService$: Subject<boolean> = new Subject<boolean>();

  constructor(
    private alertService: AlertService,
    private inventoryService: InventoryService,
    private inventoryBinaryService: InventoryBinaryService,
    private fetchClient: FetchClient,
    private applicationService: ApplicationService,
  ) {
    this.realtime = new Realtime(this.fetchClient);
    this.subscribeMonitoringChannel();
  }

  initiateReload(resetCache: boolean) {
    this.reloadThroughService$.next(resetCache);
  }

  getReloadThroughService() {
    return this.reloadThroughService$;
  }

  getExtensionsMetadataFromInventory(): Promise<IResultList<IManagedObject>> {
    const filter: object = {
      pageSize: 100,
      withTotalPages: true,
      fragmentType: 'pas_extension'
    };
    const result = this.inventoryService.list(filter);
    return result;
  }

  async createExtensionFromList(
    name: string,
    monitors: CEP_Block[],
    repository: Repository,
    upload: boolean,
    deploy: boolean,
  ): Promise<IFetchResponse> {
    console.log('Create extensions for:', name, monitors);
    return this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${EXTENSION_ENDPOINT}/list`,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          extension_name: name,
          monitors: monitors,
          repository: repository,
          upload: upload,
          deploy: deploy,
        }),
        method: 'POST',
        responseType: 'blob'
      }
    );
  }

  async createExtensionFromRepository(
    name: string,
    upload: boolean,
    deploy: boolean,
    repository: Repository
  ): Promise<IFetchResponse> {
    console.log('Create extensions for:', name, repository);
    return this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${EXTENSION_ENDPOINT}/repository`,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          extension_name: name,
          upload: upload,
          deploy: deploy,
          repository: repository
        }),
        method: 'POST',
        responseType: 'blob'
      }
    );
  }

  async getExtensionsMetadataEnriched(): Promise<IManagedObject[]> {
    if (!this._extensionsDeployed) {
      const { data } = await this.getExtensionsMetadataFromInventory();
      const extensions = data;
      const loadedExtensions: CEP_ExtensionsMetadata =
        await this.getExtensionsMetadataFromCEP();
      const loadedExtensionsFromDiagnostics: CEP_ExtensionsMetadata =
        await this.getExtensionNamesFromCEP();
      for (let index = 0; index < extensions.length; index++) {
        extensions[index].name = removeFileExtension(extensions[index].name);
        const key1 = extensions[index].name + CEP_METADATA_FILE_EXTENSION_1;
        extensions[index].loaded = loadedExtensions?.metadatas?.some((le) =>
          key1.includes(le)
        );
        if (!extensions[index].loaded) {
          const key2 = extensions[index].name + CEP_METADATA_FILE_EXTENSION_2;
          extensions[index].loaded = loadedExtensionsFromDiagnostics.hasOwnProperty(key2);
          extensions[index].extensionType = 'zip';
        }
        if (extensions[index].loaded) {
          const extensionDetails = await this.getExtensionDetailFromCEP(
            extensions[index].name
          );
          extensions[index].blocksCount = extensionDetails?.analytics.length;
        }
      }

      this._extensionsDeployed = Promise.resolve(extensions);
    }
    return this._extensionsDeployed;
  }

  async deleteExtension(
    app: IManagedObject,
    showSuccessMessage
  ): Promise<void> {
    await this.inventoryBinaryService.delete(app.id);
    if (showSuccessMessage)
      this.alertService.success(gettext('Extension deleted.'));
    this.extensionChanged.emit(app);
  }

  async clearCaches() {
    this._blocksDeployed = undefined;
    this._extensionsDeployed = undefined;
    this._cepOperationObjectId = undefined;
    this.subscribeMonitoringChannel();
  }

  async getLoadedBlocksFromCEP(): Promise<CEP_Block[]> {
    if (!this._blocksDeployed) {
      const blocks: CEP_Block[] = [];
      const meta: CEP_ExtensionsMetadata =
        await this.getExtensionsMetadataFromCEP();
      if (meta && meta.metadatas) {
        for (let index = 0; index < meta.metadatas.length; index++) {
          const extensionNameAbbreviated = removeFileExtension(
            meta.metadatas[index]
          );
          const extension: CEP_Extension = await this.getExtensionDetailFromCEP(
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

  async getExtensionsMetadataFromCEP(): Promise<CEP_ExtensionsMetadata> {
    const response: IFetchResponse = await this.fetchClient.fetch(
      `/${CEP_PATH_METADATA_EN}`,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        method: 'GET'
      }
    );
    const data = await response.json();
    return data;
  }

  async getExtensionNamesFromCEP(): Promise<CEP_ExtensionsMetadata> {
    const response: IFetchResponse = await this.fetchClient.fetch(
      `/${CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES}`,
      {
        headers: {
          accept: 'application/json',
          'content-type': 'application/json'
        },
        method: 'GET'
      }
    );
    const data = await response.json();
    return data;
  }

  async getExtensionDetailFromCEP(name: string): Promise<CEP_Extension> {
    const response: IFetchResponse = await this.fetchClient.fetch(
      `${CEP_PATH_EN}/${name}.json`,
      {
        headers: {
          accept: 'application/json',
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

  async getCEP_OperationObjectId(): Promise<string> {
    let cepOperationObjectId: string;
    if (!this._cepOperationObjectId) {
      if (await this.isBackendDeployed()) {
        // get name of microservice from cep endpoint
        const response: IFetchResponse = await this.fetchClient.fetch(
          `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/id`,
          {
            headers: {
              accept: 'application/json',
              'content-type': 'application/json'
            },
            method: 'GET'
          }
        );
        const data = await response.json();
        cepOperationObjectId = data.id;
      } else {
        // get name of microservice from cep endpoint
        const response: IFetchResponse = await this.fetchClient.fetch(
          `${CEP_PATH_STATUS}`,
          {
            headers: {
              accept: 'application/json',
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
          cepOperationObjectId = data[0].id;
        }
      }
      if (cepOperationObjectId) {
        this._cepOperationObjectId = Promise.resolve(cepOperationObjectId);
      } else {
        this._cepOperationObjectId = undefined;
      }
    }
    return this._cepOperationObjectId;
  }

  getCEP_OperationObject(): Observable<IManagedObject> {
    return this.cepOperationObject$.asObservable();
  }

  async getCEP_CtrlStatus(): Promise<CEPStatusObject> {
    let response: IFetchResponse;
    if (!this._cepCtrlStatus) {
      if (await this.isBackendDeployed()) {
        // get name of microservice from cep endpoint
        response = await this.fetchClient.fetch(
          `${BACKEND_PATH_BASE}/${CEP_ENDPOINT}/status`,
          {
            headers: {
              accept: 'application/json',
              'content-type': 'application/json'
            },
            method: 'GET'
          }
        );
      } else {
        // get name of microservice from cep endpoint
        response = await this.fetchClient.fetch(`${CEP_PATH_STATUS}`, {
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          method: 'GET'
        });
      }
      this._cepCtrlStatus = await response.json();
    }
    return this._cepCtrlStatus;
  }

  async subscribeMonitoringChannel(): Promise<object> {
    const cepOperationObjectId = await this.getCEP_OperationObjectId();
    if (!cepOperationObjectId) {
      if (!this._isBackendDeployed) {
        this.alertService.warning(
          'The supporting microservice for the Analytics Management is currently not deployed. Not all feature are available ...'
        );
      } else {
        this.alertService.warning(
          'Streaming Analytics is restarting. Please retry later ...'
        );
      }
    }
    const { data } = await this.inventoryService.detail(cepOperationObjectId);
    this.cepOperationObject$.next(data);
    // console.log(
    //   'Started subscription on CEP operationObject:',
    //   cepOperationObjectId
    // );
    const subMO = this.realtime.subscribe(
      `/managedobjects/${cepOperationObjectId}`,
      this.updateStatusFromOperationObject.bind(this)
    );
    return subMO;
  }

  unsubscribeFromMonitoringChannel(subscription: any) {
    this.realtime.unsubscribe(subscription);
  }

  private updateStatusFromOperationObject(p: object): void {
    const payload = p['data']['data'];
    this.cepOperationObject$.next(payload);
    if (payload?.c8y_Status.status == 'Up') {
      this._cepCtrlStatus = undefined;
      // cache new cep status
      this.getCEP_CtrlStatus();
    }
    console.log('New updateStatusFromOperationObject for cep:', payload);
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
    const fetchOptions: IFetchOptions = {
      method: 'PUT',
      body: '{}',
      // headers: { 'content-type': 'multipart/form-data', accept: 'application/json' },
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json'
      }
    };
    const url = '/service/cep/restart';

    try {
      await this.fetchClient.fetch(url, fetchOptions);
    } catch (e) {
      console.error(e);
    } finally {
      console.log('We do cleanup here');
    }
    this.clearCaches();
  }

  async uploadExtension(
    file: File,
    extension: IManagedObject,
    mode: UploadMode
  ): Promise<IManagedObjectBinary> {
    let extensionToCreate: Partial<IManagedObject> = extension;
    if (mode === 'update') {
      await this.deleteExtension(extension, false);
      extensionToCreate = {
        name: extension.name,
        pas_extension: extension.name
      };
    }
    const result2 = (
      await this.inventoryBinaryService.create(file, extensionToCreate)
    ).data;
    return result2;
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
