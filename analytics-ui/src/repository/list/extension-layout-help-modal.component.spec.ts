import { TestBed } from '@angular/core/testing';
import { ExtensionLayoutHelpModalComponent } from './extension-layout-help-modal.component';

describe('ExtensionLayoutHelpModalComponent', () => {
  let component: ExtensionLayoutHelpModalComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ExtensionLayoutHelpModalComponent] });
    TestBed.overrideComponent(ExtensionLayoutHelpModalComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    component = TestBed.createComponent(ExtensionLayoutHelpModalComponent).componentInstance;
  });

  it('offers a single "Close" button', () => {
    expect(component.labels).toEqual({ ok: 'Close' });
  });

  it('notifies the opener when closed', () => {
    let closed = 0;
    component.closeSubject.subscribe(() => closed++);
    component.onClose();
    expect(closed).toBe(1);
  });
});
