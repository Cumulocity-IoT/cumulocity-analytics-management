import { Injectable, OnDestroy } from '@angular/core';
import { Alert, AlertService, AlertType } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import { BehaviorSubject } from 'rxjs';
import { isTransientGatewayError } from './cep-error';

/**
 * Owns the CEP/Apama restart lifecycle: the single "restarting…" toast that
 * updates in place, the down->up detection that decides when a restart has
 * genuinely completed, and the shared notion of a "restart window" (during,
 * and briefly after, a restart) in which transient backend errors are
 * expected and should stay quiet instead of alarming the user.
 */
@Injectable({ providedIn: 'root' })
export class CepRestartService implements OnDestroy {
  /** Emits true while a CEP/Apama restart is known to be in progress. */
  readonly restarting$ = new BehaviorSubject<boolean>(false);

  // The single, self-replacing toast used for CEP lifecycle/availability status.
  // Keeping a reference lets us update the status in place instead of stacking
  // a new toast for every phase (restarting -> in progress -> done/failed).
  private cepStatusAlert: Alert | null = null;
  private restartSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  // Wall-clock time until which restart-related transient errors are suppressed.
  private suppressErrorsUntil = 0;
  // Whether the engine has been observed going down since the restart began.
  // Guards against treating the stale pre-restart 'Up' event as completion.
  private restartSawEngineDown = false;

  // Auto-dismiss timeout (ms) for transient CEP warning/error toasts.
  readonly ERROR_TIMEOUT = 8000;
  // Safety net: clear the "restarting" state even if no 'Up' event arrives.
  private readonly RESTART_MAX_DURATION = 90000;
  // Keep suppressing transient errors for a moment after a restart finishes:
  // late 500/502 responses from in-flight status polls can still land.
  private readonly RESTART_GRACE_PERIOD = 10000;

  constructor(private readonly alertService: AlertService) {}

  ngOnDestroy(): void {
    if (this.restartSafetyTimer) {
      clearTimeout(this.restartSafetyTimer);
      this.restartSafetyTimer = null;
    }
  }

  /** Whether a CEP/Apama restart is currently known to be in progress. */
  isRestarting(): boolean {
    return this.restarting$.value;
  }

  /**
   * Whether we are in the restart window — actively restarting, or within the
   * grace period right after. Transient backend errors (500/502, missing
   * operation object, unavailable microservice) are expected here and should
   * not raise toasts or console errors.
   */
  isRestartWindow(): boolean {
    return this.isRestarting() || Date.now() < this.suppressErrorsUntil;
  }

  /**
   * Whether an error is an expected, self-recovering backend condition that
   * should be logged quietly without alarming the user: either we are in a
   * restart window, or the engine returned a transient gateway error
   * (502/503/504) because the streaming-analytics microservice is unreachable
   * or still starting up.
   */
  isExpectedTransientError(error: unknown): boolean {
    return this.isRestartWindow() || isTransientGatewayError(error);
  }

  beginRestart(): void {
    this.restarting$.next(true);
    // Reset down-detection: we must see the engine actually go down before a
    // later 'Up' counts as the restart completing.
    this.restartSawEngineDown = false;
    // A single, persistent "in progress" toast that stays until the engine
    // reports 'Up' (replaced by a success toast) — no intermediate messages.
    this.setCepStatusAlert(
      gettext('Streaming Analytics is restarting. This may take a moment.'),
      'info'
    );

    // Safety net: if the engine never reports 'Up' (e.g. realtime update missed),
    // drop out of the restarting state and clear the lingering toast so it
    // doesn't hang forever.
    if (this.restartSafetyTimer) {
      clearTimeout(this.restartSafetyTimer);
    }
    this.restartSafetyTimer = setTimeout(() => {
      this.endRestart();
      if (this.cepStatusAlert) {
        this.alertService.remove(this.cepStatusAlert);
        this.cepStatusAlert = null;
      }
    }, this.RESTART_MAX_DURATION);
  }

  endRestart(): void {
    if (this.restartSafetyTimer) {
      clearTimeout(this.restartSafetyTimer);
      this.restartSafetyTimer = null;
    }
    if (this.restarting$.value) {
      this.restarting$.next(false);
      // Keep suppressing for a short grace period: in-flight status polls that
      // were fired while the engine was down can still resolve with 500/502
      // just after we flip back to "up".
      this.suppressErrorsUntil = Date.now() + this.RESTART_GRACE_PERIOD;
    }
  }

  /** Whether the engine has been observed going down since the restart began. */
  hasSeenEngineDown(): boolean {
    return this.restartSawEngineDown;
  }

  /** Record that the engine went down (or came back up) as part of a restart. */
  recordEngineDown(): void {
    this.restartSawEngineDown = true;
  }

  restartFailed(): void {
    this.endRestart();
    this.setCepStatusAlert(
      gettext('Failed to restart Streaming Analytics. Please try again.'),
      'danger',
      this.ERROR_TIMEOUT
    );
  }

  restartSucceeded(): void {
    this.endRestart();
    this.setCepStatusAlert(
      gettext('Streaming Analytics restarted successfully.'),
      'success'
    );
  }

  showCepUnavailableWarning(): void {
    // During (and just after) a restart, transient CEP unavailability is expected
    // and the lifecycle toast already covers it.
    if (this.isRestartWindow()) {
      return;
    }
    this.setCepStatusAlert(
      gettext('Streaming Analytics is temporarily unavailable. Please retry in a moment.'),
      'warning',
      this.ERROR_TIMEOUT
    );
  }

  showBackendNotDeployedWarning(): void {
    // Mid-restart, the availability probe can briefly report the microservice as
    // down even though it is only restarting — suppress to avoid a misleading toast.
    if (this.isRestartWindow()) {
      return;
    }
    this.setCepStatusAlert(
      gettext('The supporting microservice for Analytics Management is not deployed. Some features may be unavailable.'),
      'warning',
      this.ERROR_TIMEOUT
    );
  }

  /**
   * Shows a CEP lifecycle/availability toast in a single, self-replacing slot.
   * Replacing the previous status toast (instead of adding a new one) keeps the
   * user looking at one coherent message that updates in place, and an optional
   * timeout lets transient states clear themselves.
   */
  private setCepStatusAlert(text: string, type: AlertType, timeout = 0): void {
    // Remove the previous status toast; remove() is a no-op if it already
    // auto-dismissed, so this is always safe.
    if (this.cepStatusAlert) {
      this.alertService.remove(this.cepStatusAlert);
    }

    const alert: Alert = timeout ? { text, type, timeout } : { text, type };
    this.alertService.add(alert);
    this.cepStatusAlert = alert;
  }
}
