import { Injectable } from '@angular/core';
import { AnalyticsService } from './analytics.service';

/**
 * Single source of truth for whether repository/content operations should
 * go through the `analytics-service` backend or directly against
 * GitHub/Cumulocity from the browser. Every other repository-related
 * service (config, GitHub content, backend, items, extension builder)
 * injects THIS and branches on it — none of them decide independently.
 *
 * Delegates the actual liveness check to `AnalyticsService.isBackendServiceAvailable()`
 * — a real probe, not just a subscription check (see that method's doc
 * comment) — so the whole app shares one cached answer instead of each
 * feature area probing the microservice separately.
 */
@Injectable({
  providedIn: 'root'
})
export class RepositoryModeService {
  constructor(private readonly analyticsService: AnalyticsService) {}

  isBackendMode(): Promise<boolean> {
    return this.analyticsService.isBackendServiceAvailable();
  }
}
