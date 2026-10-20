import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Alert, AlertService } from '@c8y/ngx-components';
import { CepError } from './cep-error';
import { CepRestartService } from './cep-restart.service';

describe('CepRestartService', () => {
  let service: CepRestartService;
  let alerts: jasmine.SpyObj<AlertService>;

  beforeEach(() => {
    alerts = jasmine.createSpyObj('AlertService', ['add', 'remove']);
    TestBed.configureTestingModule({ providers: [{ provide: AlertService, useValue: alerts }] });
    service = TestBed.inject(CepRestartService);
  });

  afterEach(() => service.ngOnDestroy());

  const lastAlert = () => alerts.add.calls.mostRecent().args[0] as Alert;

  it('is idle initially', () => {
    expect(service.isRestarting()).toBeFalse();
    expect(service.isRestartWindow()).toBeFalse();
    expect(service.isExpectedTransientError(new Error('x'))).toBeFalse();
  });

  describe('beginRestart', () => {
    it('flags the restart, resets down-detection and shows one persistent info toast', fakeAsync(() => {
      service.recordEngineDown();
      service.beginRestart();

      expect(service.isRestarting()).toBeTrue();
      expect(service.hasSeenEngineDown()).toBeFalse();
      expect(lastAlert().type).toBe('info');
      expect(lastAlert().timeout).toBeUndefined();
      tick(90000);
    }));

    it('emits on restarting$', fakeAsync(() => {
      const values: boolean[] = [];
      service.restarting$.subscribe(v => values.push(v));
      service.beginRestart();
      service.endRestart();
      expect(values).toEqual([false, true, false]);
    }));

    it('replaces the previous status toast instead of stacking', fakeAsync(() => {
      service.beginRestart();
      const first = lastAlert();
      service.restartSucceeded();
      expect(alerts.remove).toHaveBeenCalledWith(first);
    }));

    it('gives up after 90s: leaves the restarting state and removes the lingering toast', fakeAsync(() => {
      service.beginRestart();
      const toast = lastAlert();
      tick(89999);
      expect(service.isRestarting()).toBeTrue();
      tick(1);
      expect(service.isRestarting()).toBeFalse();
      expect(alerts.remove).toHaveBeenCalledWith(toast);
    }));
  });

  describe('completion', () => {
    it('restartSucceeded shows a success toast and ends the restart', fakeAsync(() => {
      service.beginRestart();
      service.restartSucceeded();
      expect(service.isRestarting()).toBeFalse();
      expect(lastAlert().type).toBe('success');
    }));

    it('restartFailed shows a timed danger toast', fakeAsync(() => {
      service.beginRestart();
      service.restartFailed();
      expect(service.isRestarting()).toBeFalse();
      expect(lastAlert()).toEqual(jasmine.objectContaining({ type: 'danger', timeout: 8000 }));
    }));

    it('endRestart cancels the safety timer', fakeAsync(() => {
      service.beginRestart();
      service.endRestart();
      alerts.remove.calls.reset();
      tick(90000);
      expect(alerts.remove).not.toHaveBeenCalled();
    }));
  });

  describe('restart window', () => {
    it('stays open for a 10s grace period after the restart ended', fakeAsync(() => {
      service.beginRestart();
      service.endRestart();
      expect(service.isRestartWindow()).toBeTrue();
      expect(service.isExpectedTransientError(new Error('500'))).toBeTrue();
      tick(9999);
      expect(service.isRestartWindow()).toBeTrue();
      tick(1);
      expect(service.isRestartWindow()).toBeFalse();
    }));

    it('treats 502/503/504 CepErrors as expected even outside a restart', () => {
      expect(service.isExpectedTransientError(new CepError('m', 'u', undefined, 503))).toBeTrue();
      expect(service.isExpectedTransientError(new CepError('m', 'u', undefined, 500))).toBeFalse();
    });

    it('does not open a grace period when no restart was running', () => {
      service.endRestart();
      expect(service.isRestartWindow()).toBeFalse();
    });
  });

  describe('engine-down tracking', () => {
    it('records that the engine went down', () => {
      expect(service.hasSeenEngineDown()).toBeFalse();
      service.recordEngineDown();
      expect(service.hasSeenEngineDown()).toBeTrue();
    });
  });

  describe('availability warnings', () => {
    it('show timed warning toasts outside a restart window', () => {
      service.showCepUnavailableWarning();
      expect(lastAlert()).toEqual(jasmine.objectContaining({ type: 'warning', timeout: 8000 }));
      expect(lastAlert().text).toContain('temporarily unavailable');

      service.showBackendNotDeployedWarning();
      expect(lastAlert().text).toContain('not deployed');
      expect(alerts.add).toHaveBeenCalledTimes(2);
    });

    it('are suppressed during a restart (the lifecycle toast already covers it)', fakeAsync(() => {
      service.beginRestart();
      alerts.add.calls.reset();
      service.showCepUnavailableWarning();
      service.showBackendNotDeployedWarning();
      expect(alerts.add).not.toHaveBeenCalled();
      tick(90000);
    }));
  });
});
