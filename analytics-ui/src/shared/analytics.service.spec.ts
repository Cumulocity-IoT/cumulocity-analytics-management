import { TestBed } from '@angular/core/testing';
import { IManagedObject } from '@c8y/client';
import { BehaviorSubject, ReplaySubject } from 'rxjs';
import { AnalyticsService } from './analytics.service';
import { CepRestartService } from './cep-restart.service';
import { CepStatusService } from './cep-status.service';
import { ExtensionEnrichmentService } from './extension-enrichment.service';
import { ExtensionInventoryService } from './extension-inventory.service';

describe('AnalyticsService (facade)', () => {
  let service: AnalyticsService;
  let restart: jasmine.SpyObj<CepRestartService> & { restarting$: BehaviorSubject<boolean> };
  let status: jasmine.SpyObj<CepStatusService>;
  let inventory: jasmine.SpyObj<ExtensionInventoryService> & { extensionChanged$: any; uploadProgress$: BehaviorSubject<number | null> };
  let enrichment: jasmine.SpyObj<ExtensionEnrichmentService>;
  const ext = { id: '1', name: 'E' } as unknown as IManagedObject;

  beforeEach(() => {
    restart = Object.assign(
      jasmine.createSpyObj('CepRestartService', ['isRestarting', 'isRestartWindow', 'isExpectedTransientError']),
      { restarting$: new BehaviorSubject<boolean>(false) }
    );
    status = jasmine.createSpyObj('CepStatusService', [
      'clearCache', 'reinitializeMonitoring', 'getCepStatus', 'getCepOperationObjectStream$', 'restartCepEngine',
      'isBackendServiceAvailable', 'isBackendServiceDeployed', 'isBackendServiceEnabled', 'setBackendServiceEnabled', 'getCepOperationObjectId'
    ]);
    inventory = Object.assign(
      jasmine.createSpyObj('ExtensionInventoryService', [
        'getExtensionsFromInventory', 'uploadExtension', 'deleteExtension', 'downloadExtension', 'cancelExtensionCreation', 'updateUploadProgress'
      ]),
      { extensionChanged$: {}, uploadProgress$: new BehaviorSubject<number | null>(null) }
    );
    enrichment = jasmine.createSpyObj('ExtensionEnrichmentService', [
      'invalidateCache', 'getEnrichedExtensions', 'getDeployedBlocks', 'getExtensionNamesFromCep', 'getDeployedExtensionDetails'
    ]);
    TestBed.configureTestingModule({
      providers: [
        { provide: CepRestartService, useValue: restart },
        { provide: CepStatusService, useValue: status },
        { provide: ExtensionInventoryService, useValue: inventory },
        { provide: ExtensionEnrichmentService, useValue: enrichment }
      ]
    });
    service = TestBed.inject(AnalyticsService);
  });

  it('re-exposes the streams of the underlying services', () => {
    expect(service.restarting$).toBe(restart.restarting$);
    expect(service.uploadProgress$).toBe(inventory.uploadProgress$);
    expect(service.extensionChanged$).toBe(inventory.extensionChanged$);
  });

  describe('cache management', () => {
    it('relays cache reload requests', () => {
      const received: boolean[] = [];
      service.getCacheReloadRequests$().subscribe(v => received.push(v));
      service.triggerCacheReload(true);
      service.triggerCacheReload(false);
      expect(received).toEqual([true, false]);
    });

    it('clearAllCaches clears both the status and the enrichment caches', () => {
      service.clearAllCaches();
      expect(status.clearCache).toHaveBeenCalled();
      expect(enrichment.invalidateCache).toHaveBeenCalled();
    });
  });

  describe('inventory changes invalidate the enrichment cache', () => {
    it('after an upload', async () => {
      const result = { data: ext };
      inventory.uploadExtension.and.resolveTo(result as never);
      const file = new File([], 'e.zip');

      expect(await service.uploadExtension(file, ext, 'add')).toBe(result as never);
      expect(inventory.uploadExtension).toHaveBeenCalledWith(file, ext, 'add');
      expect(enrichment.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('after a delete, passing the success-message flag through', async () => {
      inventory.deleteExtension.and.resolveTo({} as never);
      await service.deleteExtension(ext, false);
      expect(inventory.deleteExtension).toHaveBeenCalledWith(ext, false);
      expect(enrichment.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('but not when the upload or delete failed', async () => {
      inventory.uploadExtension.and.rejectWith(new Error('x'));
      inventory.deleteExtension.and.rejectWith(new Error('y'));
      await expectAsync(service.uploadExtension(new File([], 'e.zip'), ext, 'add')).toBeRejected();
      await expectAsync(service.deleteExtension(ext)).toBeRejected();
      expect(enrichment.invalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('delegation', () => {
    it('forwards each call to the responsible service', async () => {
      status.getCepStatus.and.resolveTo({ status: 'Up' } as never);
      status.getCepOperationObjectId.and.resolveTo('7');
      status.isBackendServiceAvailable.and.resolveTo(true);
      status.isBackendServiceDeployed.and.resolveTo(true);
      status.isBackendServiceEnabled.and.resolveTo(false);
      enrichment.getDeployedBlocks.and.resolveTo([]);
      enrichment.getDeployedExtensionDetails.and.resolveTo(null);
      inventory.getExtensionsFromInventory.and.resolveTo([ext]);
      inventory.downloadExtension.and.resolveTo(new ArrayBuffer(1));
      const stream = new ReplaySubject<IManagedObject>(1);
      status.getCepOperationObjectStream$.and.returnValue(stream);
      restart.isRestarting.and.returnValue(true);
      restart.isRestartWindow.and.returnValue(true);
      restart.isExpectedTransientError.and.returnValue(true);

      expect(await service.getCepStatus()).toEqual({ status: 'Up' } as never);
      expect(await service.getCepOperationObjectId()).toBe('7');
      expect(await service.isBackendServiceAvailable()).toBeTrue();
      expect(await service.isBackendServiceDeployed()).toBeTrue();
      expect(await service.isBackendServiceEnabled()).toBeFalse();
      expect(await service.getDeployedBlocks()).toEqual([]);
      expect(await service.getDeployedExtensionDetails('E')).toBeNull();
      expect(enrichment.getDeployedExtensionDetails).toHaveBeenCalledWith('E');
      expect(await service.getExtensionsFromInventory()).toEqual([ext]);
      expect((await service.downloadExtension(ext)).byteLength).toBe(1);
      expect(service.getCepOperationObjectStream$()).toBe(stream);
      expect(service.isRestarting()).toBeTrue();
      expect(service.isRestartWindow()).toBeTrue();
      expect(service.isExpectedTransientError(new Error('x'))).toBeTrue();

      await service.restartCepEngine();
      await service.reinitializeMonitoring();
      await service.setBackendServiceEnabled(true);
      await service.getEnrichedExtensions();
      await service.getExtensionNamesFromCep();
      service.cancelExtensionCreation(ext);
      const progress = {} as ProgressEvent;
      service.updateUploadProgress(progress);

      expect(status.restartCepEngine).toHaveBeenCalled();
      expect(status.reinitializeMonitoring).toHaveBeenCalled();
      expect(status.setBackendServiceEnabled).toHaveBeenCalledWith(true);
      expect(enrichment.getEnrichedExtensions).toHaveBeenCalled();
      expect(enrichment.getExtensionNamesFromCep).toHaveBeenCalled();
      expect(inventory.cancelExtensionCreation).toHaveBeenCalledWith(ext);
      expect(inventory.updateUploadProgress).toHaveBeenCalledWith(progress);
    });
  });
});
