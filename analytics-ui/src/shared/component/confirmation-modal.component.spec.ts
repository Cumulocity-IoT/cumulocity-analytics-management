import { TestBed } from '@angular/core/testing';
import { ConfirmModalComponent, Status } from '@c8y/ngx-components';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationModalComponent } from './confirmation-modal.component';

describe('ConfirmationModalComponent', () => {
  let component: ConfirmationModalComponent;
  let translate: jasmine.SpyObj<TranslateService>;

  beforeEach(() => {
    translate = jasmine.createSpyObj('TranslateService', ['instant']);
    translate.instant.and.callFake((key: string) => `translated:${key}`);
    TestBed.configureTestingModule({
      imports: [ConfirmationModalComponent],
      providers: [{ provide: TranslateService, useValue: translate }]
    });
    TestBed.overrideComponent(ConfirmationModalComponent, { set: { template: '', templateUrl: undefined, imports: [] } });
    component = TestBed.createComponent(ConfirmationModalComponent).componentInstance;
  });

  const answers = () => {
    const received: boolean[] = [];
    let completed = false;
    component.closeSubject.subscribe({ next: v => received.push(v), complete: () => (completed = true) });
    return { received, isCompleted: () => completed };
  };

  it('defaults to a warning with Ok/Cancel buttons', () => {
    expect(component.status).toBe(Status.WARNING);
    expect(component.labels).toEqual({ ok: 'Ok', cancel: 'Cancel' });
  });

  it('translates the message when initialised', () => {
    component.message = 'Delete it?';
    component.ngOnInit();
    expect(component.messageTranslated).toBe('translated:Delete it?');
  });

  it('answers true and completes on confirm', () => {
    const { received, isCompleted } = answers();
    component.onClose();
    expect(received).toEqual([true]);
    expect(isCompleted()).toBeTrue();
  });

  it('answers false and completes on dismiss', () => {
    const { received, isCompleted } = answers();
    component.onDismiss();
    expect(received).toEqual([false]);
    expect(isCompleted()).toBeTrue();
  });

  it('maps the modal result to the answer once the view is ready', async () => {
    const confirmed = answers();
    component.modalRef = { result: Promise.resolve() } as unknown as ConfirmModalComponent;
    await component.ngAfterViewInit();
    expect(confirmed.received).toEqual([true]);

    const dismissed = TestBed.createComponent(ConfirmationModalComponent).componentInstance;
    const received: boolean[] = [];
    dismissed.closeSubject.subscribe(v => received.push(v));
    dismissed.modalRef = { result: Promise.reject(new Error('dismissed')) } as unknown as ConfirmModalComponent;
    await dismissed.ngAfterViewInit();
    expect(received).toEqual([false]);
  });
});
