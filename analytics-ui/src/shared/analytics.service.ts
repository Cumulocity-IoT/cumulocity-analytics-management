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
  CEP_Metadata,
  GITHUB_BASE,
  PATH_CEP_EN,
  PATH_CEP_METADATA_EN,
  PATH_CEP_STATUS,
  REPO_SAMPLES_OWNER,
  REPO_SAMPLES_NAME,
  REPO_SAMPLES_PATH,
  STATUS_MESSAGE_01,
  BASE_URL,
  ENDPOINT_EXTENSION,
  Repository,
} from "./analytics.model";
import { filter, map, pairwise } from "rxjs/operators";
import { HttpClient } from "@angular/common/http";
import { RepositoryService } from "../sample/editor/repository.service";

@Injectable({ providedIn: "root" })
export class AnalyticsService {
  appDeleted = new EventEmitter<IManagedObject>();
  progress: BehaviorSubject<number> = new BehaviorSubject<number>(null);
  private restart: BehaviorSubject<string> = new BehaviorSubject<string>(null);
  protected baseUrl: string;
  private _cepId: Promise<string>;
  private realtime: Realtime;
  private subscription: Subscription;

  constructor(
    private modal: ModalService,
    private alertService: AlertService,
    private translateService: TranslateService,
    private inventoryService: InventoryService,
    private inventoryBinaryService: InventoryBinaryService,
    private fetchClient: FetchClient,
    private githubFetchClient: HttpClient,
    private repositoryService: RepositoryService
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

  async createExtensionsZIP(name: string, monitors: string[]): Promise<any> {
    console.log(`Create extensions for : ${name},  ${monitors},`);
    return this.fetchClient.fetch(`${BASE_URL}/${ENDPOINT_EXTENSION}`, {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        extension_name: name,
        monitors: monitors,
      }),
      method: "POST",
    });
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

  async getLoadedCEP_Blocks(): Promise<CEP_Block[]> {
    const result: CEP_Block[] = [];
    const meta: CEP_Metadata = await this.getCEP_Metadata();
    if (meta && meta.metadatas) {
      for (let index = 0; index < meta.metadatas.length; index++) {
        const extensionName = meta.metadatas[index];
        const extension: CEP_Extension = await this.getCEP_Extension(
          extensionName
        );
        const extensionNameAbbreviated =
          extensionName.match(/(.+?)(\.[^.]*$|$)/)[1];
        extension.analytics.forEach((block) => {
          const cepBlock = block as CEP_Block;
          cepBlock.custom =
            !block.id.startsWith("apama.analyticsbuilder.blocks") &&
            !block.id.startsWith("apama.analyticskit.blocks.core");
          cepBlock.extension = extensionNameAbbreviated;
          result.push(cepBlock);
        });
      }
    }
    return result;
  }

  async getCEP_BlockSamplesFromRepositories(): Promise<CEP_Block[]> {
    const promises: Promise<CEP_Block[]>[] = [];
    const reps: Repository[] = await this.repositoryService.loadRepositories();

    for (let i = 0; i < reps.length; i++) {
      const promise: Promise<CEP_Block[]> =
        this.getCEP_BlockSamplesFromRepository(reps[i]);
      promises.push(promise);
    }
    const combinedPromise = Promise.all(promises);
    const result = combinedPromise.then((data) => {
      const flattened = data.reduce(
        (accumulator, value) => accumulator.concat(value),
        []
      );
      return flattened;
    });
    return result;
    // const result = promises.reduce(
    //   (acc, promise) =>
    //     acc.then((data) => {
    //       promise.then((blocks) => {
    //         data.push(...blocks);
    //         return data;
    //       });
    //       return data;
    //     }),
    //   Promise.resolve([]) // as Promise<CEP_Block[]>
    // );
    // return result;
  }

  async getCEP_BlockSamplesFromRepository(
    rep: Repository
  ): Promise<CEP_Block[]> {
    const result: any = this.githubFetchClient
      .get(rep.url, {
        headers: {
          "content-type": "application/json",
        },
      })
      .pipe(
        map((data) => {
          const name = _.values(data);
          name.forEach((b) => {
            b.id = b.sha;
            b.repositoryName = rep.name;
          });
          return name;
        })
      )
      .toPromise();
    return result;
  }

  async getBlock_Sample_Content(name: string): Promise<string> {
    const sampleUrl = `${GITHUB_BASE}/repos/${REPO_SAMPLES_OWNER}/${REPO_SAMPLES_NAME}/contents/${REPO_SAMPLES_PATH}/${name}`;
    const result: any = this.githubFetchClient
      .get(sampleUrl, {
        headers: {
          //    "content-type": "application/json",
          "content-type": "application/text",
          Accept: "application/vnd.github.raw",
        },
        responseType: "text",
      })
      // .pipe(
      //   map((data) => {
      //     const name = _.values(data);
      //     return name;
      //   }),)
      .toPromise();
    return result;
  }

  async getCEP_Metadata(): Promise<CEP_Metadata> {
    const response: IFetchResponse = await this.fetchClient.fetch(
      `/${PATH_CEP_METADATA_EN}`,
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
      `${PATH_CEP_EN}/${name}`,
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

  async getCEPId(): Promise<string> {
    if (!this._cepId) {
      this._cepId = this.getUncachedCEP_Id();
    }
    return this._cepId;
  }

  async getUncachedCEP_Id(): Promise<string> {
    // get name of microservice from cep endpoint
    const response: IFetchResponse = await this.fetchClient.fetch(
      `${PATH_CEP_STATUS}`,
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
    const cepId = await this.getCEPId();
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
