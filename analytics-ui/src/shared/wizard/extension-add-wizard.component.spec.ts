import { TestBed } from '@angular/core/testing';
import { IManagedObject } from '@c8y/client';
import { WizardComponent } from '@c8y/ngx-components';
import { AnalyticsService } from '../analytics.service';
import { ExtensionAddWizardComponent } from './extension-add-wizard.component';

describe('ExtensionAddWizardComponent', () => {
  let component: ExtensionAddWizardComponent;
  let analytics: jasmine.SpyObj<AnalyticsService>;
  let wizard: jasmine.SpyObj<WizardComponent>;
  const file = new File(['x'], 'e.zip');
  const ext = (name: string) => ({ id: '1', name }) as unknown as IManagedObject;

  beforeEach(() => {
    analytics = jasmine.createSpyObj('AnalyticsService', ['uploadExtension']);
    analytics.uploadExtension.and.resolveTo({} as never);
    wizard = jasmine.createSpyObj('WizardComponent', ['close']);
    TestBed.configureTestingModule({
      imports: [ExtensionAddWizardComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: WizardComponent, useValue: wizard }
      ]
    });
    TestBed.overrideComponent(ExtensionAddWizardComponent, { set: { template: '', imports: [] } });
    component = TestBed.createComponent(ExtensionAddWizardComponent).componentInstance;
  });

  it('closes the wizard when cancelled', () => {
    component.onCancelled();
    expect(wizard.close).toHaveBeenCalled();
  });

  it('closes the wizard and asks the opener to refresh when completed', () => {
    let refreshed = 0;
    component.refresh.subscribe(() => refreshed++);
    component.onCompleted();
    expect(wizard.close).toHaveBeenCalled();
    expect(refreshed).toBe(1);
  });

  it('uploads the given extension', async () => {
    await component.uploadExtension(file, ext('New'), 'add');
    expect(analytics.uploadExtension).toHaveBeenCalledWith(file, ext('New'), 'add');
  });

  it('falls back to the extension to replace when none is passed', async () => {
    component.extensionToReplace = ext('Old');
    await component.uploadExtension(file, undefined as never, 'update');
    expect(analytics.uploadExtension).toHaveBeenCalledWith(file, ext('Old'), 'update');
  });

  it('exposes the upload as a handler bound to the component (for the child component input)', async () => {
    const handler = component.uploadExtensionHandler;
    await handler(file, ext('X'), 'add');
    expect(analytics.uploadExtension).toHaveBeenCalled();
  });
});
