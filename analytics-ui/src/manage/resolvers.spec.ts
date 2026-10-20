import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { AnalyticsService } from '../shared';
import { backendResolver, extensionResolver } from './resolvers';

describe('route resolvers', () => {
  let analytics: jasmine.SpyObj<AnalyticsService>;

  beforeEach(() => {
    analytics = jasmine.createSpyObj('AnalyticsService', ['getDeployedExtensionDetails', 'isBackendServiceAvailable']);
    TestBed.configureTestingModule({ providers: [{ provide: AnalyticsService, useValue: analytics }] });
  });

  const run = <T>(fn: (r: ActivatedRouteSnapshot, s: RouterStateSnapshot) => unknown, params: Record<string, string> = {}) =>
    TestBed.runInInjectionContext(() => fn({ params } as unknown as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as Promise<T>;

  it('extensionResolver loads the details of the extension named in the route', async () => {
    analytics.getDeployedExtensionDetails.and.resolveTo({ name: 'E' } as never);
    expect(await run(extensionResolver, { name: 'E' })).toEqual({ name: 'E' } as never);
    expect(analytics.getDeployedExtensionDetails).toHaveBeenCalledWith('E');
  });

  it('extensionResolver resolves null for an extension that is not deployed', async () => {
    analytics.getDeployedExtensionDetails.and.resolveTo(null);
    expect(await run(extensionResolver, { name: 'Missing' })).toBeNull();
  });

  it('backendResolver reports whether the backend service can be used', async () => {
    analytics.isBackendServiceAvailable.and.resolveTo(true);
    expect(await run(backendResolver)).toBeTrue();
    analytics.isBackendServiceAvailable.and.resolveTo(false);
    expect(await run(backendResolver)).toBeFalse();
  });
});
