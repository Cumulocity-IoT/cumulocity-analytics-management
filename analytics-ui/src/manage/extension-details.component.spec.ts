import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { AnalyticsService } from '../shared';
import { ExtensionDetailsComponent } from './extension-details.component';

describe('ExtensionDetailsComponent', () => {
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let navigationState: Record<string, unknown> | undefined;

  const create = (data: Record<string, unknown> = {}, name = 'E') => {
    TestBed.configureTestingModule({
      imports: [ExtensionDetailsComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: Router, useValue: { currentNavigation: () => (navigationState ? { extras: { state: navigationState } } : null) } },
        { provide: ActivatedRoute, useValue: { snapshot: { data, params: { name } } } }
      ]
    });
    TestBed.overrideComponent(ExtensionDetailsComponent, { set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] } });
    return TestBed.createComponent(ExtensionDetailsComponent).componentInstance;
  };

  beforeEach(() => {
    navigationState = undefined;
    analytics = jasmine.createSpyObj('AnalyticsService', ['getExtensionNamesFromCep']);
    analytics.getExtensionNamesFromCep.and.resolveTo({} as never);
    history.replaceState({}, '');
  });

  it('takes the extension from the navigation state', async () => {
    navigationState = { extension: { name: 'FromNav' } };
    const component = create();
    await component.ngOnInit();
    expect((component.extension as unknown as { name: string }).name).toBe('FromNav');
  });

  it('falls back to the browser history state', async () => {
    history.replaceState({ extension: { name: 'FromHistory' } }, '');
    const component = create();
    await component.ngOnInit();
    expect((component.extension as unknown as { name: string }).name).toBe('FromHistory');
  });

  it('points the breadcrumb at the extensions page', async () => {
    const component = create();
    await component.ngOnInit();
    expect(component.breadcrumbConfig).toEqual({ icon: 'plugin', label: 'Extensions', path: 'c8y-pkg-analytics-extension/manage' });
  });

  describe('build information', () => {
    const buildInfo = (extra: Record<string, unknown> = {}) => ({
      extension: { build_information: { build_type: 'repository', repository: { name: 'Repo', url: 'https://github.com/o/r' }, ...extra } }
    });

    it('lists build type, repository name and a repository link', async () => {
      navigationState = buildInfo();
      const component = create();
      await component.ngOnInit();
      expect(component.buildInformation.map(b => [b.label, b.type, b.value])).toEqual([
        ['Build Type', 'string', 'repository'],
        ['Repository Name', 'string', 'Repo'],
        ['Repository Url', 'link', 'https://github.com/o/r']
      ]);
    });

    it('opens the repository link in a new, isolated window', async () => {
      navigationState = buildInfo();
      const open = spyOn(window, 'open');
      const component = create();
      await component.ngOnInit();
      const link = component.buildInformation.find(b => b.type === 'link');
      link.action({}, 'https://github.com/o/r');
      expect(open).toHaveBeenCalledWith('https://github.com/o/r', '_blank', 'noopener,noreferrer');
    });

    it('shows nothing for extensions without build information', async () => {
      navigationState = { extension: { name: 'Plain' } };
      const component = create();
      await component.ngOnInit();
      expect(component.buildInformation).toEqual([]);
    });
  });

  describe('file list', () => {
    it('merges monitors and files, strips the "files/" prefix and removes duplicates', async () => {
      navigationState = {
        extension: {
          build_information: {
            monitors: [{ file: 'files/A.mon' }, { file: 'B.mon' }, {}],
            files: [{ file: 'files/A.mon' }, { file: 'files/sub/c.py' }]
          }
        }
      };
      const component = create();
      await component.ngOnInit();
      expect(component.extensionContent).toEqual(['A.mon', 'B.mon', 'sub/c.py']);
    });

    it('adds the contents the engine reports for a deployed extension', async () => {
      navigationState = { extension: { build_information: { monitors: [{ file: 'A.mon' }] } } };
      analytics.getExtensionNamesFromCep.and.resolveTo({ 'E.zip': { contents: ['files/A.mon', 'files/events/E_metadata.evt'] } } as never);
      const component = create({ extensionFromCep: { name: 'E' } }, 'E');
      await component.ngOnInit();
      expect(component.extensionContent).toEqual(['A.mon', 'events/E_metadata.evt']);
    });

    it('does not ask the engine when the extension is not deployed', async () => {
      const component = create({ extensionFromCep: null });
      await component.ngOnInit();
      expect(analytics.getExtensionNamesFromCep).not.toHaveBeenCalled();
      expect(component.extensionContent).toEqual([]);
    });
  });
});
