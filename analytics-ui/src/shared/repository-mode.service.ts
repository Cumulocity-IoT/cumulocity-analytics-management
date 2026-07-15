import { Injectable } from '@angular/core';
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

  constructor(private readonly analyticsService: AnalyticsService) {}

  isBackendMode(): Promise<boolean> {
    if (!this.backendModePromise) {
      this.backendModePromise = this.analyticsService.isBackendServiceAvailable();
    }
    return this.backendModePromise;
  }

  /** Forces the next `isBackendMode()` call to re-check availability. */
  refresh(): void {
    this.backendModePromise = null;
  }
}
