import { fakeAsync, flush, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { IManagedObject } from '@c8y/client';
import { AlertService, WizardModalService } from '@c8y/ngx-components';
import { BehaviorSubject, Subject } from 'rxjs';
import { AnalyticsService } from '../shared';
import { ExtensionGridComponent } from './extension-grid.component';

const mo = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra }) as unknown as IManagedObject;
const cepObject = (status: string, safeMode = false) =>
  mo('cep', { c8y_Status: { status, is_safe_mode: safeMode } });

describe('ExtensionGridComponent', () => {
  let component: ExtensionGridComponent;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let wizard: jasmine.SpyObj<WizardModalService>;
  let cep$: BehaviorSubject<IManagedObject>;
  let cacheReload$: Subject<boolean>;

  async function create(routeData: Record<string, unknown> = { isBackendServiceAvailable: true }) {
    TestBed.configureTestingModule({
      imports: [ExtensionGridComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: AlertService, useValue: alerts },
        { provide: WizardModalService, useValue: wizard },
        { provide: ActivatedRoute, useValue: { snapshot: { data: routeData } } }
      ]
    });
    // Test the component logic only; the template pulls in the whole c8y UI kit.
    TestBed.overrideComponent(ExtensionGridComponent, {
      set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] }
    });
    component = TestBed.createComponent(ExtensionGridComponent).componentInstance;
    await component.ngOnInit();
  }

  /** Subscribes to extensions$ and records every emission. */
  function collect(): (IManagedObject[] | null)[] {
    const values: (IManagedObject[] | null)[] = [];
    component.extensions$.subscribe(v => values.push(v));
    return values;
  }

  beforeEach(() => {
    cep$ = new BehaviorSubject<IManagedObject>(cepObject('UP'));
    cacheReload$ = new Subject<boolean>();
    analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', [
      'getCepOperationObjectStream$',
      'getCacheReloadRequests$',
      'clearAllCaches',
      'getEnrichedExtensions',
      'restartCepEngine',
      'isExpectedTransientError',
      'uploadExtension'
    ]);
    analytics.getCepOperationObjectStream$.and.returnValue(cep$);
    analytics.getCacheReloadRequests$.and.returnValue(cacheReload$);
    analytics.getEnrichedExtensions.and.resolveTo([mo('1'), mo('2')]);
    analytics.isExpectedTransientError.and.returnValue(false);
    alerts = jasmine.createSpyObj<AlertService>('AlertService', ['add']);
    wizard = jasmine.createSpyObj<WizardModalService>('WizardModalService', ['show']);
    spyOn(console, 'error');
    spyOn(console, 'warn');
  });

  it('reads backend availability from the route data', async () => {
    await create({ isBackendServiceAvailable: Promise.resolve(false) });
    expect(component.isBackendServiceAvailable).toBeFalse();
  });

  describe('engine status streams', () => {
    it('lower-cases the reported status', async () => {
      await create();
      let status: string | undefined;
      component.cepStatus$.subscribe(s => (status = s));
      expect(status).toBe('up');
    });

    it('falls back to "down" when no status is reported', async () => {
      cep$.next(mo('cep'));
      await create();
      let status: string | undefined;
      component.cepStatus$.subscribe(s => (status = s));
      expect(status).toBe('down');
    });

    it('exposes safe mode, defaulting to false', async () => {
      await create();
      const modes: boolean[] = [];
      component.isSafeMode$.subscribe(m => modes.push(m));
      cep$.next(cepObject('UP', true));
      cep$.next(cepObject('UP', true)); // unchanged -> distinct
      expect(modes).toEqual([false, true]);
    });
  });

  describe('extensions$', () => {
    it('emits null while the engine is down and never loads extensions', fakeAsync(async () => {
      cep$.next(cepObject('DOWN'));
      await create();
      const values = collect();
      tick(100);
      expect(values).toEqual([null]);
      expect(analytics.getEnrichedExtensions).not.toHaveBeenCalled();
    }));

    it('emits a loading state (null) and then the extensions once the engine is up', fakeAsync(async () => {
      await create();
      const values = collect();
      tick(100);
      flush();
      expect(values).toEqual([null, [mo('1'), mo('2')]]);
    }));

    it('keeps a genuinely empty list distinct from "not yet known"', fakeAsync(async () => {
      analytics.getEnrichedExtensions.and.resolveTo([]);
      await create();
      const values = collect();
      tick(100);
      flush();
      expect(values).toEqual([null, []]);
    }));

    it('reloads when the engine comes back up', fakeAsync(async () => {
      cep$.next(cepObject('DOWN'));
      await create();
      const values = collect();
      tick(100);
      cep$.next(cepObject('UP'));
      tick(100);
      flush();
      expect(values[values.length - 1]?.length).toBe(2);
    }));

    it('retries transient failures with a growing backoff, then succeeds quietly', fakeAsync(async () => {
      analytics.isExpectedTransientError.and.returnValue(true);
      let calls = 0;
      analytics.getEnrichedExtensions.and.callFake(() =>
        ++calls < 3 ? Promise.reject(new Error('502')) : Promise.resolve([mo('1')])
      );
      await create();
      const values = collect();
      tick(100);
      flush();
      tick(1500); // 1st retry delay
      tick(3000); // 2nd retry delay
      flush();

      expect(analytics.getEnrichedExtensions).toHaveBeenCalledTimes(3);
      expect(values[values.length - 1]).toEqual([mo('1')]);
      expect(alerts.add).not.toHaveBeenCalled();
    }));

    it('stays quiet (no alert) when transient failures outlast all retries', fakeAsync(async () => {
      analytics.isExpectedTransientError.and.returnValue(true);
      analytics.getEnrichedExtensions.and.callFake(() => Promise.reject(new Error('502')));
      await create();
      const values = collect();
      tick(100);
      flush();
      tick(60000);

      expect(analytics.getEnrichedExtensions).toHaveBeenCalledTimes(7); // 1 + 6 retries
      expect(values[values.length - 1]).toEqual([]);
      expect(alerts.add).not.toHaveBeenCalled();
    }));

    it('alerts once and emits an empty list for non-transient failures, without retrying', fakeAsync(async () => {
      analytics.getEnrichedExtensions.and.callFake(() => Promise.reject(new Error('boom')));
      await create();
      const values = collect();
      tick(100);
      flush();

      expect(analytics.getEnrichedExtensions).toHaveBeenCalledTimes(1);
      expect(alerts.add).toHaveBeenCalledOnceWith(jasmine.objectContaining({ type: 'warning' }));
      expect(values[values.length - 1]).toEqual([]);
    }));

    it('clears the caches when a cache-clearing reload is requested', fakeAsync(async () => {
      await create();
      collect();
      tick(100);
      analytics.clearAllCaches.calls.reset();

      cacheReload$.next(true);
      tick(100);
      flush();
      expect(analytics.clearAllCaches).toHaveBeenCalledTimes(1);

      cacheReload$.next(false);
      tick(100);
      flush();
      expect(analytics.clearAllCaches).toHaveBeenCalledTimes(1);
    }));

    it('debounces bursts of reload requests into one load', fakeAsync(async () => {
      await create();
      collect();
      tick(100);
      flush();
      analytics.getEnrichedExtensions.calls.reset();

      cacheReload$.next(false);
      cacheReload$.next(false);
      cacheReload$.next(false);
      tick(100);
      flush();
      expect(analytics.getEnrichedExtensions).toHaveBeenCalledTimes(1);
    }));
  });

  describe('actions', () => {
    beforeEach(async () => create());

    it('reload() clears caches immediately and triggers a (debounced) reload', fakeAsync(() => {
      collect();
      tick(100);
      flush();
      analytics.clearAllCaches.calls.reset();
      analytics.getEnrichedExtensions.calls.reset();

      component.reload();
      expect(analytics.clearAllCaches).toHaveBeenCalledTimes(1);
      tick(100);
      flush();
      expect(analytics.getEnrichedExtensions).toHaveBeenCalledTimes(1);
    }));

    it('restartCep() delegates to the service', async () => {
      analytics.restartCepEngine.and.resolveTo();
      await component.restartCep();
      expect(analytics.restartCepEngine).toHaveBeenCalled();
    });

    it('restartCep() swallows errors to avoid unhandled rejections', async () => {
      analytics.restartCepEngine.and.rejectWith(new Error('fail'));
      await expectAsync(component.restartCep()).toBeResolved();
      expect(console.error).toHaveBeenCalled();
    });

    it('addExtension() opens the wizard in add mode and reloads when it closes', () => {
      const onClose = new Subject<void>();
      wizard.show.and.returnValue({ content: { onClose } } as never);
      const reload = spyOn(component, 'reload');

      component.addExtension();

      const { initialState } = wizard.show.calls.mostRecent().args[0] as { initialState: Record<string, any> };
      expect(initialState['id']).toBe('uploadAnalyticsExtension');
      expect(initialState['componentInitialState'].mode).toBe('add');
      expect(reload).not.toHaveBeenCalled();
      onClose.next();
      onClose.next(); // take(1): second close is ignored
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('addExtension() tolerates a wizard without content', () => {
      wizard.show.and.returnValue({} as never);
      expect(() => component.addExtension()).not.toThrow();
    });

    it('trackByExtension() uses the managed object id', () => {
      expect(component.trackByExtension(0, mo('abc'))).toBe('abc');
    });

    it('links to the microservices page of the administration app', () => {
      expect(component.getCepMicroserviceUrl()).toContain('/ecosystem/microservice/microservices');
    });

    it('stops its streams on destroy', fakeAsync(() => {
      const values = collect();
      tick(100);
      flush();
      component.ngOnDestroy();
      const before = values.length;
      cep$.next(cepObject('DOWN'));
      tick(100);
      expect(values.length).toBe(before);
    }));
  });
});
