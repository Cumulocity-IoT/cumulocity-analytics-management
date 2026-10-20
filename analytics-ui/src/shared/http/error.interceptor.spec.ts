import { HttpClient, provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { AlertService } from '@c8y/ngx-components';
import { ErrorHandlerService } from './error-handler.service';
import { ErrorInterceptor } from './error.interceptor';
import { HttpError } from './error.model';

describe('ErrorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let alertService: jasmine.SpyObj<AlertService>;
  let errorHandler: ErrorHandlerService;

  beforeEach(() => {
    alertService = jasmine.createSpyObj<AlertService>('AlertService', ['danger']);
    spyOn(console, 'debug');
    spyOn(console, 'warn');
    spyOn(console, 'error');
    spyOn(console, 'group');
    spyOn(console, 'groupEnd');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        ErrorHandlerService,
        { provide: AlertService, useValue: alertService },
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    errorHandler = TestBed.inject(ErrorHandlerService);
  });

  afterEach(() => httpMock.verify());

  /** Issues a GET and returns a holder for the eventual result. */
  function get(url = '/api/x') {
    const result: { value?: unknown; error?: HttpError } = {};
    http.get(url).subscribe({ next: v => (result.value = v), error: e => (result.error = e) });
    return result;
  }

  it('adds an X-Request-ID header and passes successful responses through', () => {
    const result = get();

    const req = httpMock.expectOne('/api/x');
    expect(req.request.headers.has('X-Request-ID')).toBeTrue();
    req.flush({ ok: true });

    expect(result.value).toEqual({ ok: true });
    expect(alertService.danger).not.toHaveBeenCalled();
  });

  it('uses a different request id per request', () => {
    get('/a');
    get('/b');
    const a = httpMock.expectOne('/a').request.headers.get('X-Request-ID');
    const b = httpMock.expectOne('/b').request.headers.get('X-Request-ID');
    expect(a).not.toEqual(b);
  });

  it('converts a 404 into an HttpError, alerts the user and records it, without retrying', () => {
    const result = get();

    httpMock.expectOne('/api/x').flush({ message: 'nope' }, { status: 404, statusText: 'Not Found' });

    expect(result.error).toBeInstanceOf(HttpError);
    expect(result.error?.response.status).toBe(404);
    expect(result.error?.response.message).toBe('nope');
    expect(result.error?.response.userMessage).toBe('The requested resource was not found.');
    expect(alertService.danger).toHaveBeenCalledOnceWith('The requested resource was not found.');
    expect(errorHandler.getErrorCount()).toBe(1);
  });

  const userMessages: [number, string][] = [
    [0, 'Network error'],
    [400, 'Invalid request'],
    [401, 'Session expired'],
    [403, 'do not have permission'],
    [418, 'An error occurred (418)']
  ];
  userMessages.forEach(([status, fragment]) => {
    it(`maps status ${status} to a friendly message`, () => {
      const result = get();
      httpMock.expectOne('/api/x').flush(null, { status, statusText: 'x' });
      expect(result.error?.response.userMessage).toContain(fragment);
    });
  });

  it('never retries authentication errors', () => {
    [401, 403].forEach(status => {
      const result = get(`/auth/${status}`);
      httpMock.expectOne(`/auth/${status}`).flush(null, { status, statusText: 'x' });
      httpMock.expectNone(`/auth/${status}`);
      expect(result.error?.response.status).toBe(status);
    });
  });

  it('never retries non-retryable client errors', () => {
    const result = get();
    httpMock.expectOne('/api/x').flush(null, { status: 400, statusText: 'Bad Request' });
    httpMock.expectNone('/api/x');
    expect(result.error?.response.status).toBe(400);
  });

  it('retries 5xx errors with exponential backoff and succeeds when the server recovers', fakeAsync(() => {
    const result = get();

    httpMock.expectOne('/api/x').flush(null, { status: 503, statusText: 'x' });
    httpMock.expectNone('/api/x'); // waiting for the 1s backoff
    tick(1000);
    httpMock.expectOne('/api/x').flush(null, { status: 503, statusText: 'x' });
    tick(1999);
    httpMock.expectNone('/api/x'); // second backoff is 2s
    tick(1);
    httpMock.expectOne('/api/x').flush({ ok: true });

    expect(result.value).toEqual({ ok: true });
    expect(alertService.danger).not.toHaveBeenCalled();
  }));

  it('gives up after 3 retries (4 requests in total) and reports the error once', fakeAsync(() => {
    const result = get();

    httpMock.expectOne('/api/x').flush(null, { status: 500, statusText: 'x' });
    [1000, 2000, 4000].forEach(delay => {
      tick(delay);
      httpMock.expectOne('/api/x').flush(null, { status: 500, statusText: 'x' });
    });

    expect(result.error).toBeInstanceOf(HttpError);
    expect(result.error?.response.status).toBe(500);
    expect(alertService.danger).toHaveBeenCalledTimes(1);
    expect(errorHandler.getErrorCount()).toBe(1);
  }));

  it('retries 408 and 429', fakeAsync(() => {
    [408, 429].forEach(status => {
      const result = get(`/r/${status}`);
      httpMock.expectOne(`/r/${status}`).flush(null, { status, statusText: 'x' });
      tick(1000);
      httpMock.expectOne(`/r/${status}`).flush({ ok: true });
      expect(result.value).toEqual({ ok: true });
    });
  }));

  it('does not log the body of requests to sensitive URLs', () => {
    http.post('/tenant/oauth/token', { password: 'secret' }).subscribe();
    httpMock.expectOne('/tenant/oauth/token').flush({});

    const logged = (console.debug as jasmine.Spy).calls.allArgs().find(args => args[1]?.body !== undefined);
    expect(logged?.[1].body).toBe('[redacted]');
  });
});
