import { EventEmitter, Injectable } from "@angular/core";
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
} from "@c8y/client";

import {
  AlertService,
  gettext,
  ModalService,
  Status,
} from "@c8y/ngx-components";

import { TranslateService } from "@ngx-translate/core";
import * as _ from "lodash";
import { BehaviorSubject, Subscription } from "rxjs";
import {
  CEP_Block,
  CEP_Extension,
  CEP_Metadata as CEP_ExtensionMetadata,
  CEP_PATH_EN,
  CEP_PATH_METADATA_EN,
  CEP_PATH_STATUS,
  STATUS_MESSAGE_01,
  BASE_PATH_BACKEND,
  EXTENSION_ENDPOINT,
  APPLICATION_ANALYTICS_BUILDER_SERVICE,
  CEP_METADATA_FILE_EXTENSION,
} from "./analytics.model";
import { filter, map, pairwise } from "rxjs/operators";
import { isCustomCEP_Block, removeFileExtension } from "./utils";

@Injectable({ providedIn: "root" })
export class AnalyticsService {
  appDeleted = new EventEmitter<IManagedObject>();
  progress: BehaviorSubject<number> = new BehaviorSubject<number>(null);
  private restart: BehaviorSubject<string> = new BehaviorSubject<string>(null);
  protected baseUrl: string;
  private _cepId: Promise<string>;
  private _blocksDeployed: Promise<CEP_Block[]>;
  private _isBackendDeployed: Promise<boolean>;
  private realtime: Realtime;
  private subscription: Subscription;

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

  getExtensions(customFilter: any = {}): Promise<IResultList<IManagedObject>> {
    const filter: object = {
      pageSize: 100,
      withTotalPages: true,
      fragmentType: "pas_extension",
    };
    Object.assign(filter, customFilter);
    const query: object = {};
    let result;
    if (Object.keys(customFilter).length == 0) {
      result = this.inventoryService.list(filter);
    } else {
      result = this.inventoryService.listQuery(query, filter);
    }
    return result;
  }

  async createExtensionZIP(
    name: string,
    upload: boolean,
    deploy: boolean,
    monitors: string[]
  ): Promise<IFetchResponse> {
    console.log(`Create extensions for : ${name},  ${monitors},`);
    return this.fetchClient.fetch(`${BASE_PATH_BACKEND}/${EXTENSION_ENDPOINT}`, {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        extension_name: name,
        upload: upload,
        deploy: deploy,
        monitors: monitors,
      }),
      method: "POST",
      responseType: "blob",
    });
  }

  async getExtensionsEnriched(
    customFilter: any = {}
  ): Promise<IManagedObject[]> {
    const extensions = (await this.getExtensions(customFilter)).data;
    const loadedExtensions: CEP_ExtensionMetadata = await this.getCEP_ExtensionMetadata();
    extensions.forEach((ext) => {
      ext.name = removeFileExtension(ext.name);
      const key = ext.name + CEP_METADATA_FILE_EXTENSION;
      ext.loaded = loadedExtensions.metadatas.some((le) => key.includes(le));
    });
    // const extensions =undefined;
    // throw new Error ("Thusday morning!");
    return extensions;
  }

  async deleteExtension(app: IManagedObject): Promise<void> {
    let name = app.name;
    await this.modal.confirm(
      gettext("Delete extension"),
      this.translateService.instant(
        gettext(
          `You are about to delete extension "{{name}}". Do you want to proceed?`
        ),
        { name }
      ),
      Status.DANGER,
      { ok: gettext("Delete"), cancel: gettext("Cancel") }
    );
    await this.inventoryBinaryService.delete(app.id);
    this.alertService.success(gettext("Extension deleted."));
    this.appDeleted.emit(app);
  }

  async resetCEP_BlockCache() {
    this._blocksDeployed = undefined;
    //this._
  }

  async getLoadedCEP_Blocks(): Promise<CEP_Block[]> {
    if (!this._blocksDeployed) {
      this._blocksDeployed = this.getLoadedCEP_BlocksUncached();
    }
    return this._blocksDeployed;
  }

  async getLoadedCEP_BlocksUncached(): Promise<CEP_Block[]> {
    const result: CEP_Block[] = [];
    const meta: CEP_ExtensionMetadata = await this.getCEP_ExtensionMetadata();
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
          //console.log("Inspect CEP_Block:", cepBlock.name, cepBlock.id, cepBlock.extension, cepBlock.custom)
          result.push(cepBlock);
        });
      }
    }
    return result;
  }

  async getCEP_ExtensionMetadata(): Promise<CEP_ExtensionMetadata> {
    const response: IFetchResponse = await this.fetchClient.fetch(
      `/${CEP_PATH_METADATA_EN}`,
      {
        headers: {
          "content-type": "application/json",
        },
        method: "GET",
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
          "content-type": "application/json",
        },
        method: "GET",
      }
    );
    const data = await response.json();
    data.name = name;
    return data;
  }

  async getCEP_Id(): Promise<string> {
    if (!this._cepId) {
      this._cepId = this.getCEP_IdUncached();
    }
    return this._cepId;
  }

  async getCEP_IdUncached(): Promise<string> {
    // get name of microservice from cep endpoint
    const response: IFetchResponse = await this.fetchClient.fetch(
      `${CEP_PATH_STATUS}`,
      {
        headers: {
          "content-type": "application/json",
        },
        method: "GET",
      }
    );
    const data1 = await response.json();
    const cepMicroservice = data1.microservice_name;

    // get source id of microservice representation in inventory
    const filter: object = {
      pageSize: 100,
      withTotalPages: true,
    };
    const query: object = {
      name: cepMicroservice,
    };
    let { data, res }: IResultList<IManagedObject> =
      await this.inventoryService.listQuery(query, filter);
    if (!data || data.length > 1) {
      this.alertService.warning("Can't find microservice for CEP!");
      return;
    }
    return data[0].id;
  }

  async subscribeMonitoringChannel(): Promise<object> {
    const cepId = await this.getCEP_Id();
    console.log("Started subscription:", cepId);

    const sub = this.realtime.subscribe(
      `/events/${cepId}`,
      this.updateStatus.bind(this)
    );
    this.subscription = this.restart
      .pipe(
        pairwise(),
        filter(([prev, current]) => prev === STATUS_MESSAGE_01),
        map(([prev, current]) => [prev, current])
      )
      .subscribe((pair) => {
        // this.alertService.warning(`Current message: ${pair}`);
        if (pair[0] == STATUS_MESSAGE_01)
          this.alertService.warning(`Deployment successful`);
      });
    return sub;
  }

  unsubscribeFromMonitoringChannel(subscription: object) {
    this.realtime.unsubscribe(subscription);
    this.subscription.unsubscribe();
  }

  private updateStatus(p: object): void {
    let payload = p["data"]["data"];
    this.restart.next(payload.text);
    if (payload.text == STATUS_MESSAGE_01) {
      this.alertService.warning("Deployment pending ...");
    }
    console.log("New status for cep:", payload);
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
      method: "PUT",
      body: formData,
      //headers: { 'content-type': 'multipart/form-data', accept: 'application/json' },
      headers: { accept: "application/json" },
    };
    const url = "/service/cep/restart";
    const res = await this.fetchClient.fetch(url, fetchOptions);
    this.alertService.warning(gettext("Deployment (Restart) submitted ..."));
    this.resetCEP_BlockCache();
  }

  async uploadExtension(
    archive: File,
    app: Partial<IManagedObject>,
    restart: boolean
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

  async isBackendDeployedUncached(): Promise<boolean> {
    return this.applicationService
      .isAvailable(APPLICATION_ANALYTICS_BUILDER_SERVICE)
      .then((av) => {
        let result = false;
        if (av) {
          result = av.data;
        }
        return result;
      });
  }

  async downloadExtension(app: IManagedObject): Promise<ArrayBuffer> {
    let response: IFetchResponse = await this.inventoryBinaryService.download(
      app
    );
    console.log("Downloading Extension", app);
    return response.arrayBuffer();
  }

  async isBackendDeployed(): Promise<boolean> {
    if (!this._isBackendDeployed) {
      this._isBackendDeployed = this.isBackendDeployedUncached();
    }
    return this._isBackendDeployed;
  }
}
