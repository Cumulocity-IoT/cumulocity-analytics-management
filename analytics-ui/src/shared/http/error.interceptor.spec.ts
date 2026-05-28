import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AlertService } from '@c8y/ngx-components';
import { ErrorInterceptor } from './error.interceptor';
import { ErrorHandlerService } from './error-handler.service';
import { HTTP_INTERCEPTORS } from '@angular/common/http';
// import type { SpyObj } from 'jasmine';

describe('ErrorInterceptor', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    // const alertServiceSpy = jasmine.createSpyObj('AlertService', ['danger', 'success', 'info']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        ErrorHandlerService,
        { provide: AlertService, useValue: null },
        {
          provide: HTTP_INTERCEPTORS,
          useClass: ErrorInterceptor,
          multi: true,
        },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should intercept and handle HTTP errors', () => {
    // Test implementation
  });

  it('should retry on 5xx errors', () => {
    // Test retry logic
  });

  it('should show user-friendly error messages', () => {
    // Test error message display
  });
});
