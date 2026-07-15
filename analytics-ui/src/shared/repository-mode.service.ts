import { Injectable } from '@angular/core';
import { FetchClient } from '@c8y/client';
import { BACKEND_PATH_BASE, REPOSITORY_CONFIGURATION_ENDPOINT } from './analytics.model';
import { AnalyticsService } from './analytics.service';

/**
 * Single source of truth for whether repository/content operations should
 * go through the `analytics-service` backend or directly against
 * GitHub/Cumulocity from the browser. Every other repository-related
 * service (config, GitHub content, backend, items, extension builder)
 * injects THIS and branches on it — none of them decide independently.
 *
 * Checked once per app lifetime and cached (backend availability doesn't
 * change mid-session); call `refresh()` to force a fresh check, e.g. right
 * after the microservice was just subscribed.
 */
@Injectable({
  providedIn: 'root'
})
export class RepositoryModeService {
  private backendModePromise: Promise<boolean> | null = null;

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly fetchClient: FetchClient
  ) {}

  isBackendMode(): Promise<boolean> {
    if (!this.backendModePromise) {
      this.backendModePromise = this.checkBackendMode();
    }
    return this.backendModePromise;
  }

  /** Forces the next `isBackendMode()` call to re-check availability. */
  refresh(): void {
    this.backendModePromise = null;
  }

  /**
   * `AnalyticsService.isBackendServiceAvailable()` only checks whether the
   * microservice is SUBSCRIBED to the tenant (i.e. registered as an
   * application the current user can see) — not whether it's actually
   * running. A subscribed-but-not-currently-running microservice still
   * makes every real request 404 with Cumulocity's own routing error
   * ("Microservice analytics-ext-service not found"), which is exactly what
   * happened here. So: use the subscription check as a cheap first
   * short-circuit, then confirm with a real liveness probe against the
   * microservice's own REST surface before committing to backend mode.
   */
  private async checkBackendMode(): Promise<boolean> {
    const subscribed = await this.analyticsService.isBackendServiceAvailable();
    if (!subscribed) {
      return false;
    }

    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONFIGURATION_ENDPOINT}`,
        { method: 'GET' }
      );
      // A 404 here is Cumulocity's platform-level "no such microservice
      // instance" routing error, not an application-level "no repositories
      // configured yet" response — analytics-service always returns valid
      // JSON (even an empty array) for this endpoint when it's actually
      // running, so any 404 means it isn't.
      return response.status !== 404;
    } catch {
      return false;
    }
  }
}
