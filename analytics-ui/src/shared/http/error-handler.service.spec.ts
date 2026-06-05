import { TestBed } from '@angular/core/testing';
import { ErrorHandlerService } from './error-handler.service';
import { HttpError } from './error.model';
// import type { SpyObj } from 'jasmine';

describe('ErrorHandlerService', () => {
  let service: ErrorHandlerService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ErrorHandlerService],
    });
    service = TestBed.inject(ErrorHandlerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should handle errors and track them', () => {
    const error = new HttpError(
      {
        status: 500,
        statusText: 'Internal Server Error',
        message: 'Test error',
        userMessage: 'An error occurred',
        timestamp: new Date().toISOString(),
      },
      'Test error'
    );

    service.handleError(error);
    service.getErrors().subscribe((errors) => {
      expect(errors.length).toBe(1);
      expect(errors[0]).toBe(error);
    });
  });

  it('should get last error', () => {
    const error = new HttpError(
      {
        status: 404,
        statusText: 'Not Found',
        message: 'Resource not found',
        userMessage: 'Resource not found',
        timestamp: new Date().toISOString(),
      },
      'Not found'
    );

    service.handleError(error);
    service.getLastError().subscribe((lastError) => {
      expect(lastError).toBe(error);
    });
  });

  it('should clear error history', () => {
    const error = new HttpError(
      {
        status: 500,
        statusText: 'Internal Server Error',
        message: 'Test',
        userMessage: 'Error',
        timestamp: new Date().toISOString(),
      }
    );

    service.handleError(error);
    expect(service.getErrorCount()).toBe(1);

    service.clearErrorHistory();
    expect(service.getErrorCount()).toBe(0);
  });
});
