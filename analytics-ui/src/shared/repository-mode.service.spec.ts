import { TestBed } from '@angular/core/testing';
import { AnalyticsService } from './analytics.service';
import { RepositoryModeService } from './repository-mode.service';

describe('RepositoryModeService', () => {
  it('delegates the backend-mode decision to AnalyticsService', async () => {
    const analytics = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', ['isBackendServiceAvailable']);
    TestBed.configureTestingModule({ providers: [{ provide: AnalyticsService, useValue: analytics }] });
    const service = TestBed.inject(RepositoryModeService);

    analytics.isBackendServiceAvailable.and.resolveTo(true);
    expect(await service.isBackendMode()).toBeTrue();
    analytics.isBackendServiceAvailable.and.resolveTo(false);
    expect(await service.isBackendMode()).toBeFalse();
  });
});
