import { EventEmitter, Injectable } from "@angular/core";
import {
  FetchClient,
  IFetchOptions,
  IFetchResponse,
  IManagedObject,
  IManagedObjectBinary,
  InventoryBinaryService,
  InventoryService,
  IResultList,
} from "@c8y/client";

import {
  AlertService,
  gettext,
  ModalService,
  Status,
} from "@c8y/ngx-components";

import { TranslateService } from "@ngx-translate/core";

import { BehaviorSubject } from "rxjs";
import {
  CEP_Block,
  CEP_Extension,
  CEP_Metadata,
  PATH_CEP_BASE_EN,
  PATH_CEP_METADATA_EN,
} from "./analytics.model";

@Injectable({ providedIn: "root" })
export class AnalyticsService {
  appDeleted = new EventEmitter<IManagedObject>();
  progress: BehaviorSubject<number> = new BehaviorSubject<number>(null);
  protected baseUrl: string;

  constructor(
    private modal: ModalService,
    private alertService: AlertService,
    private translateService: TranslateService,
    private inventoryService: InventoryService,
    private inventoryBinaryService: InventoryBinaryService,
    private fetchClient: FetchClient
  ) {}

  getExtensions(customFilter: any = {}): Promise<IResultList<IManagedObject>> {
    const filter: object = {
      pageSize: 100,
      withTotalPages: true,
      fragmentType: "pas_extension",
    };
    Object.assign(filter, customFilter);
    const query: object = {
      //   fragmentType: 'pas_extension',
    };
    let result;
    if (Object.keys(customFilter).length == 0) {
      result = this.inventoryService.list(filter);
    } else {
      result = this.inventoryService.listQuery(query, filter);
    }
    return result;
  }
  async getWebExtensions(customFilter: any = {}): Promise<IManagedObject[]> {
    return (await this.getExtensions(customFilter)).data;
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

  async getBlocks(): Promise<CEP_Block[]> {
    const result: CEP_Block[] = [];
    const meta: CEP_Metadata = await this.getCEP_Metadata();

    for (let index = 0; index < meta.metadatas.length; index++) {
      const extensionName = meta.metadatas[index];
      const extension: CEP_Extension = await this.getCEP_Extension(
        extensionName
      );
      extension.analytics.forEach((block) => {
        //result.push({ name: block.name, category: block.category });
        const cepBlock = block as CEP_Block;
        //console.log(block.id);
        cepBlock.custom = !block.id.startsWith('apama.analyticsbuilder.blocks') && !block.id.startsWith('apama.analyticskit.blocks.core') ;
        result.push(cepBlock);
      });
    }
    return result;
  }

  async getCEP_Metadata(): Promise<CEP_Metadata> {
    const res: IFetchResponse = await this.fetchClient.fetch(
      `${PATH_CEP_METADATA_EN}`,
      {
        headers: {
          "content-type": "application/json",
        },
        method: "GET",
      }
    );
    const data = await res.json();
    return data;
  }

  async getCEP_Extension(name: string): Promise<CEP_Extension> {
    const res: IFetchResponse = await this.fetchClient.fetch(
      `${PATH_CEP_BASE_EN}/${name}`,
      {
        headers: {
          "content-type": "application/json",
        },
        method: "GET",
      }
    );
    const data = await res.json();
    return data;
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
    this.alertService.success(
      gettext("Restart Streaming Analytics submitted ...")
    );
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
}
