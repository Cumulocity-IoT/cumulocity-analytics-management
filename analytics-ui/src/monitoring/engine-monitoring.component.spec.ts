import { TestBed } from '@angular/core/testing';
import { AlarmService, EventService } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { BsModalRef } from 'ngx-bootstrap/modal';
import { firstValueFrom } from 'rxjs';
import { AnalyticsService } from '../shared';
import { EngineMonitoringComponent } from './engine-monitoring.component';

describe('EngineMonitoringComponent', () => {
  let component: EngineMonitoringComponent;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let alarms: jasmine.SpyObj<AlarmService>;
  let events: jasmine.SpyObj<EventService>;
  let alerts: jasmine.SpyObj<AlertService>;

  beforeEach(() => {
    analytics = jasmine.createSpyObj('AnalyticsService', [
      'getCepOperationObjectId', 'getCepStatus', 'isBackendServiceDeployed', 'isBackendServiceEnabled', 'setBackendServiceEnabled'
    ]);
    analytics.getCepOperationObjectId.and.resolveTo('ctrl-1');
    analytics.getCepStatus.and.resolveTo({ is_safe_mode: false, microservice_name: 'apama-ctrl', number_extensions: 6, other: 'x' } as never);
    analytics.isBackendServiceDeployed.and.resolveTo(true);
    analytics.isBackendServiceEnabled.and.resolveTo(true);
    analytics.setBackendServiceEnabled.and.resolveTo();
    alarms = jasmine.createSpyObj('AlarmService', ['list']);
    alarms.list.and.resolveTo({ data: [] } as never);
    events = jasmine.createSpyObj('EventService', ['list']);
    events.list.and.resolveTo({ data: [] } as never);
    alerts = jasmine.createSpyObj('AlertService', ['success', 'danger']);
    TestBed.configureTestingModule({
      imports: [EngineMonitoringComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: AlarmService, useValue: alarms },
        { provide: EventService, useValue: events },
        { provide: AlertService, useValue: alerts },
        { provide: BsModalRef, useValue: {} }
      ]
    });
    TestBed.overrideComponent(EngineMonitoringComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    component = TestBed.createComponent(EngineMonitoringComponent).componentInstance;
    spyOn(console, 'error');
  });

  const start = async () => {
    await component.ngOnInit();
    // alarms$/events$ are lazy: subscribing triggers the first request
    await firstValueFrom(component.alarms$);
    await firstValueFrom(component.events$);
  };

  describe('engine status', () => {
    it('shows only safe mode, microservice name and number of extensions, with readable labels', async () => {
      await start();
      const items = component.cepCtrlStatusLabels$.value;
      expect(items.map(i => i.label)).toEqual(['Is safe mode', 'Microservice name', 'Number extensions']);
      expect(items[1].value).toBe('apama-ctrl');
      expect(items[2].value).toBe(6);
    });

    it('turns safe mode into a link to the troubleshooting documentation', async () => {
      const open = spyOn(window, 'open');
      await start();
      const safeMode = component.cepCtrlStatusLabels$.value[0] as unknown as { type: string; value: string; action: (e: unknown) => void };
      expect(safeMode.type).toBe('link');
      expect(safeMode.value).toBe('false');
      safeMode.action({});
      expect(open).toHaveBeenCalledWith(jasmine.stringContaining('apama_safe_mode'), '_blank', 'noopener,noreferrer');
    });

    it('remembers the operation object id (empty when unknown)', async () => {
      await start();
      expect(component.cepOperationObjectId).toBe('ctrl-1');
      analytics.getCepOperationObjectId.and.resolveTo(undefined);
      await component.ngOnInit();
      expect(component.cepOperationObjectId).toBe('');
    });
  });

  describe('backend service switch', () => {
    it('reads the deployed and enabled state', async () => {
      analytics.isBackendServiceEnabled.and.resolveTo(false);
      await start();
      expect(component.backendDeployed).toBeTrue();
      expect(component.backendEnabled).toBeFalse();
    });

    it('enables the backend, confirms to the user and reloads the status', async () => {
      await start();
      analytics.getCepOperationObjectId.calls.reset();
      await component.toggleBackendEnabled(false);
      expect(analytics.setBackendServiceEnabled).toHaveBeenCalledWith(false);
      expect(component.backendEnabled).toBeFalse();
      expect(alerts.success).toHaveBeenCalledWith('Backend service disabled');
      expect(analytics.getCepOperationObjectId).toHaveBeenCalled();
      expect(component.backendTogglePending).toBeFalse();
    });

    it('reverts the switch and alerts when saving the setting fails', async () => {
      await start();
      analytics.setBackendServiceEnabled.and.rejectWith(new Error('denied'));
      component.backendEnabled = true;
      await component.toggleBackendEnabled(false);
      expect(component.backendEnabled).toBeTrue(); // reverted to the previous value
      expect(alerts.danger).toHaveBeenCalled();
      expect(component.backendTogglePending).toBeFalse();
    });
  });

  describe('alarms and events', () => {
    it('requests the first page of alarms and events of the engine, 5 per page', async () => {
      await start();
      expect(alarms.list).toHaveBeenCalledWith({ pageSize: 5, source: 'ctrl-1', currentPage: 1, withTotalPages: true });
      expect(events.list).toHaveBeenCalledWith({ pageSize: 5, source: 'ctrl-1', currentPage: 1, withTotalPages: true });
    });

    it('keeps the engine filter and page size when paging', async () => {
      await start();
      component.nextPageAlarm(1);
      await firstValueFrom(component.alarms$);
      component.nextPageEvent(1);
      await firstValueFrom(component.events$);
      expect(alarms.list.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ source: 'ctrl-1', pageSize: 5, currentPage: 2 }));
      expect(events.list.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ source: 'ctrl-1', pageSize: 5, currentPage: 2 }));
    });

    it('never goes before the first page', async () => {
      await start();
      component.nextPageAlarm(-1);
      expect(component.currentPageAlarm).toBe(1);
      component.nextPageEvent(-1);
      expect(component.currentPageEvent).toBe(1);
    });

    it('filters alarms by status while keeping the engine filter', async () => {
      await start();
      component.status = 'ACTIVE' as never;
      component.search();
      await firstValueFrom(component.alarms$);
      expect(alarms.list.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({ source: 'ctrl-1', status: 'ACTIVE' }));
    });
  });
});
