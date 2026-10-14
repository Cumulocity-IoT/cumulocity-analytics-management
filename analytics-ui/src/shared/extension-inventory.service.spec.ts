import { TestBed } from '@angular/core/testing';
import { IManagedObject, InventoryBinaryService, InventoryService } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { CepError } from './cep-error';
import { ExtensionInventoryService } from './extension-inventory.service';

const mo = (id: string, name = `ext-${id}`) => ({ id, name }) as unknown as IManagedObject;
const page = (n: number, start = 0) => Array.from({ length: n }, (_, i) => mo(String(start + i)));

describe('ExtensionInventoryService', () => {
  let service: ExtensionInventoryService;
  let inventory: jasmine.SpyObj<InventoryService>;
  let binaries: jasmine.SpyObj<InventoryBinaryService>;
  let alerts: jasmine.SpyObj<AlertService>;

  beforeEach(() => {
    inventory = jasmine.createSpyObj('InventoryService', ['list']);
    binaries = jasmine.createSpyObj('InventoryBinaryService', ['create', 'delete', 'download']);
    alerts = jasmine.createSpyObj('AlertService', ['success', 'danger']);
    TestBed.configureTestingModule({
      providers: [
        { provide: InventoryService, useValue: inventory },
        { provide: InventoryBinaryService, useValue: binaries },
        { provide: AlertService, useValue: alerts }
      ]
    });
    service = TestBed.inject(ExtensionInventoryService);
    spyOn(console, 'error');
    spyOn(console, 'warn');
  });

  describe('getExtensionsFromInventory', () => {
    it('queries extensions by fragment and returns a single short page', async () => {
      inventory.list.and.resolveTo({ data: page(3), paging: { nextPage: null } } as never);
      expect((await service.getExtensionsFromInventory()).length).toBe(3);
      expect(inventory.list).toHaveBeenCalledOnceWith(jasmine.objectContaining({ fragmentType: 'pas_extension', currentPage: 1, pageSize: 100 }));
    });

    it('pages through all results while the server reports a next page', async () => {
      inventory.list.and.returnValues(
        Promise.resolve({ data: page(100, 0), paging: { nextPage: 2 } } as never),
        Promise.resolve({ data: page(100, 100), paging: { nextPage: 3 } } as never),
        Promise.resolve({ data: page(7, 200), paging: { nextPage: null } } as never)
      );
      expect((await service.getExtensionsFromInventory()).length).toBe(207);
      expect(inventory.list.calls.allArgs().map(a => (a[0] as { currentPage: number }).currentPage)).toEqual([1, 2, 3]);
    });

    it('stops on a short page even if a next page is announced', async () => {
      inventory.list.and.resolveTo({ data: page(10), paging: { nextPage: 2 } } as never);
      await service.getExtensionsFromInventory();
      expect(inventory.list).toHaveBeenCalledTimes(1);
    });

    it('alerts and raises a CepError on failure', async () => {
      inventory.list.and.rejectWith(new Error('down'));
      await expectAsync(service.getExtensionsFromInventory()).toBeRejectedWith(jasmine.any(CepError));
      expect(alerts.danger).toHaveBeenCalled();
    });
  });

  describe('uploadExtension', () => {
    const file = new File(['x'], 'e.zip');
    const created = { res: { ok: true, status: 201 }, data: mo('99', 'E') };

    it('uploads and announces the new extension', async () => {
      binaries.create.and.resolveTo(created as never);
      const emitted: IManagedObject[] = [];
      service.extensionChanged$.subscribe(e => emitted.push(e));

      expect(await service.uploadExtension(file, mo('', 'E'), 'add')).toBe(created.data as never);
      expect(binaries.create).toHaveBeenCalledWith(file, jasmine.objectContaining({ name: 'E' }));
      expect(emitted).toEqual([created.data]);
      expect(binaries.delete).not.toHaveBeenCalled();
    });

    it('in update mode first deletes the old binary and re-creates it with only name/pas_extension', async () => {
      binaries.delete.and.resolveTo({} as never);
      binaries.create.and.resolveTo(created as never);

      await service.uploadExtension(file, { ...mo('5', 'E'), build_information: { x: 1 } } as never, 'update');

      expect(binaries.delete).toHaveBeenCalledWith('5');
      expect(binaries.create).toHaveBeenCalledWith(file, { name: 'E', pas_extension: 'E' });
      expect(alerts.success).not.toHaveBeenCalled(); // silent delete
    });

    it('fails with the friendly message for a non-OK response', async () => {
      binaries.create.and.resolveTo({ res: { ok: false, status: 500 }, data: {} } as never);
      const error = await service.uploadExtension(file, mo('', 'E'), 'add').catch(e => e);
      expect(error).toBeInstanceOf(CepError);
      expect(alerts.danger).toHaveBeenCalledOnceWith(jasmine.stringContaining('Could not upload extension "E"'));
    });

    it('wraps unexpected errors', async () => {
      binaries.create.and.rejectWith(new Error('net'));
      await expectAsync(service.uploadExtension(file, mo('', 'E'), 'add')).toBeRejectedWith(jasmine.any(CepError));
    });
  });

  describe('deleteExtension', () => {
    it('deletes by id, shows a success message by default and announces the change', async () => {
      binaries.delete.and.resolveTo({ res: {} } as never);
      const emitted: IManagedObject[] = [];
      service.extensionChanged$.subscribe(e => emitted.push(e));
      const ext = mo('7');

      await service.deleteExtension(ext);

      expect(binaries.delete).toHaveBeenCalledWith('7');
      expect(alerts.success).toHaveBeenCalled();
      expect(emitted).toEqual([ext]);
    });

    it('can suppress the success message', async () => {
      binaries.delete.and.resolveTo({} as never);
      await service.deleteExtension(mo('7'), false);
      expect(alerts.success).not.toHaveBeenCalled();
    });

    it('alerts and raises a CepError on failure', async () => {
      binaries.delete.and.rejectWith(new Error('403'));
      await expectAsync(service.deleteExtension(mo('7'))).toBeRejectedWith(jasmine.any(CepError));
      expect(alerts.danger).toHaveBeenCalled();
    });
  });

  describe('downloadExtension', () => {
    it('returns the binary content', async () => {
      const buffer = new ArrayBuffer(4);
      binaries.download.and.resolveTo({ arrayBuffer: async () => buffer } as never);
      expect(await service.downloadExtension(mo('1'))).toBe(buffer);
    });

    it('raises a CepError naming the extension on failure', async () => {
      binaries.download.and.rejectWith(new Error('404'));
      await expectAsync(service.downloadExtension(mo('1', 'E'))).toBeRejectedWith(jasmine.any(CepError));
      expect(alerts.danger).toHaveBeenCalledWith(jasmine.stringContaining('"E"'));
    });
  });

  describe('cancelExtensionCreation', () => {
    it('deletes a half-created extension and swallows cleanup errors', async () => {
      binaries.delete.and.rejectWith(new Error('gone'));
      service.cancelExtensionCreation({ id: '3' });
      await Promise.resolve();
      await Promise.resolve();
      expect(binaries.delete).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
    });

    it('does nothing without an id', () => {
      service.cancelExtensionCreation({});
      expect(binaries.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateUploadProgress', () => {
    const event = (loaded: number, total: number, lengthComputable = true) => ({ loaded, total, lengthComputable }) as ProgressEvent;
    let progress: (number | null)[];
    beforeEach(() => {
      progress = [];
      service.uploadProgress$.subscribe(p => progress.push(p));
    });

    it('scales progress to 95% so the rest is reserved for server processing', () => {
      service.updateUploadProgress(event(50, 100));
      service.updateUploadProgress(event(100, 100));
      expect(progress).toEqual([null, 47.5, 95]);
    });

    it('ignores events without a computable length', () => {
      service.updateUploadProgress(event(1, 0));
      service.updateUploadProgress(event(1, 10, false));
      expect(progress).toEqual([null]);
    });
  });
});
