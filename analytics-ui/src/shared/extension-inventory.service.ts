import { EventEmitter, Injectable } from '@angular/core';
import {
  IManagedObject,
  IManagedObjectBinary,
  InventoryBinaryService,
  InventoryService,
  IResult
} from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import { BehaviorSubject } from 'rxjs';
import { UploadMode } from './analytics.model';
import { CepError } from './cep-error';

/**
 * CRUD for extension binaries against the inventory: list, upload, delete,
 * download. Deployment/enrichment status (is it loaded into the CEP engine,
 * how many blocks does it contain) is a separate concern — see
 * `ExtensionEnrichmentService`.
 */
@Injectable({ providedIn: 'root' })
export class ExtensionInventoryService {
  readonly extensionChanged$ = new EventEmitter<IManagedObject>();
  readonly uploadProgress$ = new BehaviorSubject<number | null>(null);

  private readonly DEFAULT_PAGE_SIZE = 100;

  constructor(
    private readonly alertService: AlertService,
    private readonly inventoryService: InventoryService,
    private readonly inventoryBinaryService: InventoryBinaryService
  ) {}

  async getExtensionsFromInventory(): Promise<IManagedObject[]> {
    try {
      const all: IManagedObject[] = [];
      let currentPage = 1;

      while (true) {
        const { data, paging } = await this.inventoryService.list({
          pageSize: this.DEFAULT_PAGE_SIZE,
          withTotalPages: true,
          fragmentType: 'pas_extension',
          currentPage
        });

        all.push(...data);

        // Stop when the server indicates no further page, or when a short page comes back
        if (!paging?.nextPage || data.length < this.DEFAULT_PAGE_SIZE) break;
        currentPage++;
      }

      return all;
    } catch (error) {
      throw this.handleError(
        error,
        'Failed to fetch extensions from inventory',
        true,
        gettext('Could not load extensions. Please try again.')
      );
    }
  }

  async uploadExtension(
    file: File,
    extension: IManagedObject,
    mode: UploadMode
  ): Promise<IManagedObjectBinary> {
    try {
      const extensionToCreate = mode === 'update'
        ? await this.prepareExtensionForUpdate(extension)
        : extension;

      const result = await this.inventoryBinaryService.create(file, extensionToCreate);

      if (!result.res.ok) {
        throw new CepError(
          `Upload failed with status ${result.res.status}`,
          gettext(`Could not upload extension "${extension['name']}". Please try again.`)
        );
      }

      this.extensionChanged$.emit(result.data as IManagedObject);

      return result.data;
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to upload extension ${extension['name']}`,
        true,
        error instanceof CepError
          ? error.userMessage
          : gettext(`Error uploading extension "${extension['name']}". Please try again.`)
      );
    }
  }

  async deleteExtension(
    extension: IManagedObject,
    showSuccessMessage: boolean = true
  ): Promise<IResult<null>> {
    try {
      const result = await this.inventoryBinaryService.delete(extension.id);

      if (showSuccessMessage) {
        this.alertService.success(gettext('Extension deleted successfully.'));
      }

      this.extensionChanged$.emit(extension);
      return result;
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to delete extension ${extension['name']}`,
        true,
        gettext('Failed to delete extension. Please try again.')
      );
    }
  }

  async downloadExtension(extension: IManagedObject): Promise<ArrayBuffer> {
    try {
      const response = await this.inventoryBinaryService.download(extension);
      return await response.arrayBuffer();
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to download extension ${extension['name']}`,
        true,
        gettext(`Failed to download extension "${extension['name']}". Please try again.`)
      );
    }
  }

  cancelExtensionCreation(extension: Partial<IManagedObject>): void {
    if (extension?.id) {
      this.inventoryBinaryService.delete(extension).catch(error => {
        console.warn('Failed to cleanup extension:', error);
      });
    }
  }

  updateUploadProgress(event: ProgressEvent): void {
    if (!event.lengthComputable || event.total === 0) return;
    // Cap at 95% so the final 5% can be reserved for server-side processing
    const progress = Math.min(95, (event.loaded / event.total) * 95);
    this.uploadProgress$.next(progress);
  }

  private async prepareExtensionForUpdate(
    extension: IManagedObject
  ): Promise<Partial<IManagedObject>> {
    await this.deleteExtension(extension, false);

    return {
      name: extension['name'],
      pas_extension: extension['name']
    };
  }

  private handleError(
    error: unknown,
    logMessage: string,
    showAlert: boolean,
    userMessage: string
  ): Error {
    console.error(`[ExtensionInventoryService] ${logMessage}:`, error);

    if (showAlert) {
      this.alertService.danger(userMessage);
    }

    if (error instanceof CepError) {
      return error;
    }

    return new CepError(logMessage, userMessage, error instanceof Error ? error : undefined);
  }
}
