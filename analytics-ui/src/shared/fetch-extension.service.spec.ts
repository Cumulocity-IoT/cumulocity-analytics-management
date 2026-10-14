import { TestBed } from '@angular/core/testing';
import { EventService, IdentityService, IEvent } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { CepError } from './cep-error';
import { FETCH_EXTENSION_EVENT_TYPE, FetchExtensionService } from './fetch-extension.service';

describe('FetchExtensionService', () => {
  let service: FetchExtensionService;
  let identity: jasmine.SpyObj<IdentityService>;
  let events: jasmine.SpyObj<EventService>;
  let alerts: jasmine.SpyObj<AlertService>;

  beforeEach(() => {
    identity = jasmine.createSpyObj('IdentityService', ['detail']);
    events = jasmine.createSpyObj('EventService', ['create']);
    alerts = jasmine.createSpyObj('AlertService', ['danger']);
    TestBed.configureTestingModule({
      providers: [
        { provide: IdentityService, useValue: identity },
        { provide: EventService, useValue: events },
        { provide: AlertService, useValue: alerts }
      ]
    });
    service = TestBed.inject(FetchExtensionService);
    spyOn(console, 'error');
  });

  describe('resolveProxySourceId', () => {
    it('looks up the c8y_FetchUploadProxy external id and returns the managed object id as string', async () => {
      identity.detail.and.resolveTo({ data: { managedObject: { id: 42 } } } as never);
      expect(await service.resolveProxySourceId()).toBe('42');
      expect(identity.detail).toHaveBeenCalledWith({ type: 'c8y_Serial', externalId: 'c8y_FetchUploadProxy' });
    });

    it('reports a misconfigured proxy when the external id has no managed object', async () => {
      identity.detail.and.resolveTo({ data: {} } as never);
      const error = await service.resolveProxySourceId().catch(e => e);
      expect(error).toBeInstanceOf(CepError);
      expect(error.userMessage).toContain('misconfigured');
      expect(alerts.danger).toHaveBeenCalledTimes(1);
    });

    it('explains that the EPL listener has not run on a 404 (either error shape)', async () => {
      identity.detail.and.rejectWith({ res: { status: 404 } });
      expect((await service.resolveProxySourceId().catch(e => e)).userMessage).toContain('FetchExtensionListener');
      identity.detail.and.rejectWith({ status: 404 });
      expect((await service.resolveProxySourceId().catch(e => e)).userMessage).toContain('FetchExtensionListener');
    });

    it('uses a generic message for other failures', async () => {
      identity.detail.and.rejectWith(new Error('500'));
      const error = await service.resolveProxySourceId().catch(e => e);
      expect(error).toBeInstanceOf(CepError);
      expect(error.userMessage).toContain('Could not resolve');
    });
  });

  describe('sendFetchExtensionEvent', () => {
    beforeEach(() => identity.detail.and.resolveTo({ data: { managedObject: { id: '7' } } } as never));

    it('creates a c8y_FetchExtension event on the proxy and returns the request', async () => {
      events.create.and.resolveTo({} as never);

      const request = await service.sendFetchExtensionEvent('https://x/e.zip', 'E');

      const event = events.create.calls.mostRecent().args[0] as IEvent;
      expect(event.source).toEqual({ id: '7' });
      expect(event.type).toBe(FETCH_EXTENSION_EVENT_TYPE);
      expect(event['c8y_FetchExtension']).toEqual({ requestId: request.requestId, url: 'https://x/e.zip', name: 'E', headers: {} });
      expect(request).toEqual({ requestId: jasmine.any(String), url: 'https://x/e.zip', name: 'E' });
    });

    it('sends the access token as Bearer header only when given', async () => {
      events.create.and.resolveTo({} as never);
      await service.sendFetchExtensionEvent('u', 'E', 'ghp_x');
      expect((events.create.calls.mostRecent().args[0] as IEvent)['c8y_FetchExtension'].headers).toEqual({ Authorization: 'Bearer ghp_x' });
    });

    it('does not send an event when the proxy cannot be resolved', async () => {
      identity.detail.and.rejectWith(new Error('x'));
      await expectAsync(service.sendFetchExtensionEvent('u', 'E')).toBeRejected();
      expect(events.create).not.toHaveBeenCalled();
    });

    it('alerts and raises a CepError when the event cannot be created', async () => {
      events.create.and.rejectWith(new Error('403'));
      const error = await service.sendFetchExtensionEvent('u', 'E').catch(e => e);
      expect(error).toBeInstanceOf(CepError);
      expect(alerts.danger).toHaveBeenCalledWith(jasmine.stringContaining('"E"'));
    });
  });
});
