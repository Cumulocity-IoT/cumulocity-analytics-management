import { AppStateService, NavigatorNode, Permissions } from '@c8y/ngx-components';
import { AnalyticsNavigationFactory } from './analytics-navigation.factory';

describe('AnalyticsNavigationFactory', () => {
  let permissions: jasmine.SpyObj<Permissions>;
  let appState: { options: { contextPath?: string } };
  let factory: AnalyticsNavigationFactory;

  const grant = (...roles: string[]) => permissions.hasRole.and.callFake((role: string) => roles.includes(role));

  beforeEach(() => {
    permissions = jasmine.createSpyObj('Permissions', ['hasRole']);
    appState = { options: { contextPath: 'administration' } };
    factory = new AnalyticsNavigationFactory(permissions, appState as unknown as AppStateService);
  });

  describe('canActivate', () => {
    it('requires both CEP management read and admin roles', () => {
      grant('ROLE_CEP_MANAGEMENT_READ', 'ROLE_CEP_MANAGEMENT_ADMIN');
      expect(factory.canActivate()).toBeTrue();
      grant('ROLE_CEP_MANAGEMENT_READ');
      expect(factory.canActivate()).toBeFalse();
      grant('ROLE_CEP_MANAGEMENT_ADMIN');
      expect(factory.canActivate()).toBeFalse();
      grant();
      expect(factory.canActivate()).toBeFalse();
    });
  });

  describe('get', () => {
    it('returns no navigation for users without the roles', () => {
      grant();
      expect(factory.get()).toEqual([]);
    });

    it('returns the extensions node for authorized users', () => {
      grant('ROLE_CEP_MANAGEMENT_READ', 'ROLE_CEP_MANAGEMENT_ADMIN');
      const nodes = factory.get() as NavigatorNode[];
      expect(nodes.length).toBe(1);
      expect(nodes[0].path).toBe('c8y-pkg-analytics-extension/manage');
      expect(nodes[0].label).toBe('Analytics extensions');
    });

    it('uses the shorter label inside the Streaming Analytics app', () => {
      grant('ROLE_CEP_MANAGEMENT_READ', 'ROLE_CEP_MANAGEMENT_ADMIN');
      appState.options.contextPath = 'streaminganalytics';
      const nodes = factory.get() as NavigatorNode[];
      expect(nodes[0].label).toBe('Extensions');
    });
  });
});
