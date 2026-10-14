import { TestBed } from '@angular/core/testing';
import { ApplicationService, FetchClient, IManagedObject, InventoryService, Realtime } from '@c8y/client';
import { firstValueFrom } from 'rxjs';
import { CepError } from './cep-error';
import { CepRestartService } from './cep-restart.service';
import { CepStatusService } from './cep-status.service';
import { RepositoryConfigService } from './repository-config.service';

const STATUS_URL = 'service/cep/diagnostics/apamaCtrlStatus';
const BACKEND_STATUS_URL = 'service/analytics-ext-service/cep/status';
const BACKEND_ID_URL = 'service/analytics-ext-service/cep/id';

const ok = (body: unknown = {}, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => body }) as unknown as Response;
const mo = (id: string, status?: string) => ({ id, c8y_Status: status ? { status } : undefined }) as unknown as IManagedObject;
const tick = () => new Promise<void>(resolve => setTimeout(resolve));

describe('CepStatusService', () => {
  let fetchClient: jasmine.SpyObj<FetchClient>;
  let inventory: jasmine.SpyObj<InventoryService>;
  let applications: jasmine.SpyObj<ApplicationService>;
  let restart: jasmine.SpyObj<CepRestartService>;
  let config: jasmine.SpyObj<RepositoryConfigService>;
  let routes: Record<string, () => Response | Promise<Response>>;
  let realtimeCallback: ((payload: unknown) => void) | undefined;
  let realtimeSubscribe: jasmine.Spy;
  let services: CepStatusService[];

  /** Creates the service and waits for the constructor's async monitoring start-up to settle. */
  async function create(): Promise<CepStatusService> {
    const service = TestBed.inject(CepStatusService);
    services.push(service);
    await tick();
    return service;
  }

  const fetchedUrls = () => fetchClient.fetch.calls.allArgs().map(a => a[0] as string);

  beforeEach(() => {
    services = [];
    realtimeCallback = undefined;
    routes = {
      [STATUS_URL]: () => ok({ microservice_name: 'apama', microservice_application_id: '7', status: 'Up' }),
      '/service/cep/restart': () => ok({}),
      [BACKEND_STATUS_URL]: () => ok({}),
      [BACKEND_ID_URL]: () => ok({ id: 'backend-id' })
    };
    fetchClient = jasmine.createSpyObj('FetchClient', ['fetch', 'getUrl']);
    fetchClient.fetch.and.callFake(async (url: string) => {
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      return route();
    });
    inventory = jasmine.createSpyObj('InventoryService', ['detail', 'listQuery']);
    inventory.listQuery.and.resolveTo({ data: [{ id: 'ctrl-1' }] } as never);
    inventory.detail.and.resolveTo({ data: mo('ctrl-1', 'UP') } as never);
    applications = jasmine.createSpyObj('ApplicationService', ['isAvailable']);
    applications.isAvailable.and.resolveTo({ data: false } as never); // backend not subscribed by default
    restart = jasmine.createSpyObj('CepRestartService', [
      'beginRestart', 'restartFailed', 'restartSucceeded', 'recordEngineDown', 'hasSeenEngineDown',
      'isRestarting', 'isExpectedTransientError', 'showCepUnavailableWarning', 'showBackendNotDeployedWarning'
    ]);
    restart.isRestarting.and.returnValue(false);
    restart.isExpectedTransientError.and.returnValue(false);
    config = jasmine.createSpyObj('RepositoryConfigService', ['getUseBackendServiceEnabled', 'setUseBackendServiceEnabled']);
    config.getUseBackendServiceEnabled.and.resolveTo(true);
    config.setUseBackendServiceEnabled.and.resolveTo();

    realtimeSubscribe = spyOn(Realtime.prototype, 'subscribe').and.callFake((_channel: string, cb: any) => {
      realtimeCallback = cb;
      return {} as never;
    });
    spyOn(console, 'error');
    spyOn(console, 'warn');

    TestBed.configureTestingModule({
      providers: [
        { provide: FetchClient, useValue: fetchClient },
        { provide: InventoryService, useValue: inventory },
        { provide: ApplicationService, useValue: applications },
        { provide: CepRestartService, useValue: restart },
        { provide: RepositoryConfigService, useValue: config }
      ]
    });
  });

  afterEach(() => services.forEach(s => s.ngOnDestroy()));

  describe('start-up monitoring', () => {
    it('resolves the operation object via the CEP status endpoint, publishes it and subscribes to updates', async () => {
      const service = await create();

      expect(inventory.listQuery).toHaveBeenCalledWith({ name: 'apama', applicationId: '7' }, jasmine.anything());
      expect(inventory.detail).toHaveBeenCalledWith('ctrl-1');
      expect(realtimeSubscribe).toHaveBeenCalledWith('/managedobjects/ctrl-1', jasmine.any(Function));
      expect((await firstValueFrom(service.getCepOperationObjectStream$())).id).toBe('ctrl-1');
    });

    it('does not subscribe and warns when the operation object cannot be found', async () => {
      inventory.listQuery.and.resolveTo({ data: [] } as never);
      await create();
      expect(realtimeSubscribe).not.toHaveBeenCalled();
      expect(restart.showBackendNotDeployedWarning).toHaveBeenCalled();
    });

    it('reinitializeMonitoring re-subscribes', async () => {
      const service = await create();
      realtimeSubscribe.calls.reset();
      await service.reinitializeMonitoring();
      expect(realtimeSubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe('backend availability', () => {
    it('is not deployed when the application is not subscribed (no probe)', async () => {
      const service = await create();
      expect(await service.isBackendServiceDeployed()).toBeFalse();
      expect(fetchedUrls()).not.toContain(BACKEND_STATUS_URL);
    });

    it('is deployed when subscribed and the probe is not a platform 404, and the answer is cached', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      const service = await create();
      expect(await service.isBackendServiceDeployed()).toBeTrue();
      const probes = () => fetchedUrls().filter(u => u === BACKEND_STATUS_URL).length;
      const before = probes();
      await service.isBackendServiceDeployed();
      expect(probes()).toBe(before);
    });

    it('is not deployed when the probe returns the platform 404 routing error', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      routes[BACKEND_STATUS_URL] = () => ok({}, 404);
      const service = await create();
      expect(await service.isBackendServiceDeployed()).toBeFalse();
    });

    it('is not deployed when the probe fails, and retries next time instead of caching the failure', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      let failing = true;
      routes[BACKEND_STATUS_URL] = () => { if (failing) throw new Error('boom'); return ok({}); };
      const service = await create();
      expect(await service.isBackendServiceDeployed()).toBeFalse();
      failing = false;
      expect(await service.isBackendServiceDeployed()).toBeTrue();
    });

    it('is not deployed when the subscription check throws', async () => {
      applications.isAvailable.and.rejectWith(new Error('403'));
      const service = await create();
      expect(await service.isBackendServiceDeployed()).toBeFalse();
    });

    it('is available only when deployed AND enabled by the user', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      const service = await create();
      expect(await service.isBackendServiceAvailable()).toBeTrue();
      config.getUseBackendServiceEnabled.and.resolveTo(false);
      expect(await service.isBackendServiceAvailable()).toBeFalse();
      expect(await service.isBackendServiceDeployed()).toBeTrue(); // deployment state is independent of the preference
    });

    it('setBackendServiceEnabled persists the preference and clears the mode-dependent caches', async () => {
      const service = await create();
      await service.getCepStatus();
      const statusCalls = () => fetchedUrls().filter(u => u === STATUS_URL).length;
      const before = statusCalls();
      await service.getCepStatus();
      expect(statusCalls()).toBe(before); // cached

      await service.setBackendServiceEnabled(false);
      await service.getCepStatus();

      expect(config.setUseBackendServiceEnabled).toHaveBeenCalledWith(false);
      expect(statusCalls()).toBe(before + 1);
    });
  });

  describe('getCepStatus', () => {
    it('reads from the CEP diagnostics endpoint without backend and caches the result', async () => {
      const service = await create();
      const first = await service.getCepStatus();
      expect(first.status).toBe('Up');
      const count = fetchedUrls().filter(u => u === STATUS_URL).length;
      await service.getCepStatus();
      expect(fetchedUrls().filter(u => u === STATUS_URL).length).toBe(count);
    });

    it('reads through the backend when it is available', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      routes[BACKEND_STATUS_URL] = () => ok({ status: 'Up', via: 'backend' });
      const service = await create();
      service.clearCache();
      expect(((await service.getCepStatus()) as any).via).toBe('backend');
    });

    it('does not cache failures', async () => {
      const service = await create();
      service.clearCache();
      routes[STATUS_URL] = () => ok({}, 503);
      await expectAsync(service.getCepStatus()).toBeRejectedWith(jasmine.any(CepError));
      routes[STATUS_URL] = () => ok({ status: 'Up' });
      expect((await service.getCepStatus()).status).toBe('Up');
    });
  });

  describe('getCepOperationObjectId', () => {
    it('uses the backend id endpoint when available', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      const service = await create();
      service.clearCache();
      expect(await service.getCepOperationObjectId()).toBe('backend-id');
    });

    it('falls back to the CEP status lookup when the backend call fails', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      routes[BACKEND_ID_URL] = () => ok({}, 500);
      const service = await create();
      service.clearCache();
      expect(await service.getCepOperationObjectId()).toBe('ctrl-1');
    });

    it('falls back when the backend answers without an id', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      routes[BACKEND_ID_URL] = () => ok({});
      const service = await create();
      service.clearCache();
      expect(await service.getCepOperationObjectId()).toBe('ctrl-1');
    });

    it('caches a successful lookup', async () => {
      const service = await create();
      inventory.listQuery.calls.reset();
      await service.getCepOperationObjectId();
      await service.getCepOperationObjectId();
      expect(inventory.listQuery).not.toHaveBeenCalled(); // already cached by start-up
    });

    it('returns undefined and warns "microservice not deployed" when nothing is found without backend', async () => {
      const service = await create();
      service.clearCache();
      restart.showBackendNotDeployedWarning.calls.reset();
      inventory.listQuery.and.resolveTo({ data: [{ id: 'a' }, { id: 'b' }] } as never); // ambiguous
      expect(await service.getCepOperationObjectId()).toBeUndefined();
      expect(restart.showBackendNotDeployedWarning).toHaveBeenCalled();
    });

    it('warns "engine unavailable" instead when the backend is available', async () => {
      applications.isAvailable.and.resolveTo({ data: true } as never);
      routes[BACKEND_ID_URL] = () => ok({}, 500);
      inventory.listQuery.and.resolveTo({ data: [] } as never);
      const service = await create();
      service.clearCache();
      restart.showCepUnavailableWarning.calls.reset();
      expect(await service.getCepOperationObjectId()).toBeUndefined();
      expect(restart.showCepUnavailableWarning).toHaveBeenCalled();
    });

    it('does not cache failures: a later call retries', async () => {
      inventory.listQuery.and.resolveTo({ data: [] } as never);
      const service = await create();
      service.clearCache();
      expect(await service.getCepOperationObjectId()).toBeUndefined();
      inventory.listQuery.and.resolveTo({ data: [{ id: 'ctrl-2' }] } as never);
      expect(await service.getCepOperationObjectId()).toBe('ctrl-2');
    });
  });

  describe('realtime updates', () => {
    const update = (managedObject: unknown) => ({ data: { data: managedObject } });

    it('publishes valid managed objects to the stream', async () => {
      const service = await create();
      const received: IManagedObject[] = [];
      service.getCepOperationObjectStream$().subscribe(m => received.push(m));
      received.length = 0;

      realtimeCallback!(update(mo('ctrl-1', 'DOWN')));

      expect(received.map(m => m.id)).toEqual(['ctrl-1']);
    });

    it('ignores malformed payloads', async () => {
      const service = await create();
      const received: IManagedObject[] = [];
      service.getCepOperationObjectStream$().subscribe(m => received.push(m));
      received.length = 0;

      [null, 'x', {}, { data: {} }, { data: { data: 'str' } }].forEach(p => realtimeCallback!(p));

      expect(received).toEqual([]);
      expect(console.warn).toHaveBeenCalled();
    });

    it('refreshes the cached status when the engine reports Up (case-insensitive)', async () => {
      const service = await create();
      await service.getCepStatus();
      const count = () => fetchedUrls().filter(u => u === STATUS_URL).length;
      const before = count();

      realtimeCallback!(update(mo('ctrl-1', 'uP')));
      await tick();

      expect(count()).toBe(before + 1);
    });

    it('does not refresh the status for non-Up states', async () => {
      const service = await create();
      await service.getCepStatus();
      const before = fetchedUrls().length;
      realtimeCallback!(update(mo('ctrl-1', 'DOWN')));
      await tick();
      expect(fetchedUrls().length).toBe(before);
    });

    describe('during a restart', () => {
      beforeEach(async () => {
        await create();
        restart.isRestarting.and.returnValue(true);
      });

      it('records the engine going down', () => {
        realtimeCallback!(update(mo('ctrl-1', 'DOWN')));
        expect(restart.recordEngineDown).toHaveBeenCalled();
        expect(restart.restartSucceeded).not.toHaveBeenCalled();
      });

      it('completes the restart on a genuine down -> up transition', () => {
        restart.hasSeenEngineDown.and.returnValue(true);
        realtimeCallback!(update(mo('ctrl-1', 'UP')));
        expect(restart.restartSucceeded).toHaveBeenCalled();
      });

      it('ignores the stale pre-restart "Up" event', () => {
        restart.hasSeenEngineDown.and.returnValue(false);
        realtimeCallback!(update(mo('ctrl-1', 'UP')));
        expect(restart.restartSucceeded).not.toHaveBeenCalled();
      });
    });

    it('does not touch restart state when no restart is running', async () => {
      await create();
      realtimeCallback!(update(mo('ctrl-1', 'DOWN')));
      expect(restart.recordEngineDown).not.toHaveBeenCalled();
    });
  });

  describe('restartCepEngine', () => {
    it('begins the restart lifecycle, sends PUT and re-subscribes without completing it', async () => {
      const service = await create();
      realtimeSubscribe.calls.reset();

      await service.restartCepEngine();

      expect(restart.beginRestart).toHaveBeenCalled();
      const call = fetchClient.fetch.calls.allArgs().find(a => a[0] === '/service/cep/restart')!;
      expect(call[1]).toEqual(jasmine.objectContaining({ method: 'PUT', body: '{}' }));
      expect(realtimeSubscribe).toHaveBeenCalled();
      expect(restart.restartSucceeded).not.toHaveBeenCalled(); // the realtime Up event does that
      expect(restart.restartFailed).not.toHaveBeenCalled();
    });

    it('marks the restart as failed and rethrows a CepError when the request fails', async () => {
      const service = await create();
      routes['/service/cep/restart'] = () => ok({}, 500);
      await expectAsync(service.restartCepEngine()).toBeRejectedWith(jasmine.any(CepError));
      expect(restart.restartFailed).toHaveBeenCalled();
    });
  });

  it('logs expected transient errors quietly (warn, not error)', async () => {
    restart.isExpectedTransientError.and.returnValue(true);
    inventory.listQuery.and.rejectWith(new Error('502'));
    await create();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });
});
