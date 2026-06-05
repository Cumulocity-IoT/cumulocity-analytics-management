import { Injectable } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, retryWhen, mergeMap, finalize } from 'rxjs/operators';
import { AlertService } from '@c8y/ngx-components';
import { ErrorHandlerService } from './error-handler.service';
import { HttpError } from './error.model';

/**
 * HTTP interceptor for error handling and retry logic
 * Provides:
 * - Automatic retry for failed requests
 * - Standardized error handling
 * - User-friendly error messages
 * - Request/response logging
 */
@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  private readonly retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;
  private readonly exponentialBackoff = true;
  private readonly backoffMultiplier = 2;

  private requestCount = 0;

  constructor(
    private errorHandler: ErrorHandlerService,
    private alertService: AlertService
  ) {}

  intercept(
    request: HttpRequest<unknown>,
    next: HttpHandler
  ): Observable<HttpEvent<unknown>> {
    this.requestCount++;
    const requestId = `${Date.now()}-${this.requestCount}`;
    
    // Add request headers
    const modifiedRequest = request.clone({
      setHeaders: {
        'X-Request-ID': requestId,
      },
    });

    console.debug(`[${requestId}] ${request.method} ${request.url}`, {
      params: request.params,
      body: this.shouldLogBody(request) ? request.body : '[redacted]',
    });

    return next.handle(modifiedRequest).pipe(
      // Retry logic
      retryWhen((errors) =>
        errors.pipe(
          mergeMap((error, attempt) => {
            if (
              this.shouldRetry(error, attempt) &&
              this.isRetryableStatusCode(error.status)
            ) {
              const delay = this.calculateDelay(attempt);
              console.warn(
                `[${requestId}] Retrying (attempt ${attempt + 1}/${this.maxRetries}) after ${delay}ms`
              );
              return timer(delay);
            }
            return throwError(() => error);
          })
        )
      ),
      finalize(() => {
        console.debug(`[${requestId}] Request completed`);
      }),
      catchError((error: HttpErrorResponse) =>
        this.handleError(error, requestId, request)
      )
    );
  }

  /**
   * Determine if request should be retried
   */
  private shouldRetry(error: HttpErrorResponse, attempt: number): boolean {
    return attempt < this.maxRetries && !this.isAuthError(error);
  }

  /**
   * Check if status code is retryable
   */
  private isRetryableStatusCode(status: number): boolean {
    return this.retryableStatusCodes.includes(status);
  }

  /**
   * Calculate delay for exponential backoff
   */
  private calculateDelay(attempt: number): number {
    if (!this.exponentialBackoff) {
      return this.retryDelay;
    }
    return this.retryDelay * Math.pow(this.backoffMultiplier, attempt);
  }

  /**
   * Check if error is authentication-related
   */
  private isAuthError(error: HttpErrorResponse): boolean {
    return error.status === 401 || error.status === 403;
  }

  /**
   * Handle HTTP errors
   */
  private handleError(
    error: HttpErrorResponse,
    requestId: string,
    request: HttpRequest<unknown>
  ): Observable<never> {
    console.error(`[${requestId}] HTTP Error:`, {
      status: error.status,
      statusText: error.statusText,
      url: error.url,
      body: error.error,
    });

    // Create standardized error response
    const httpError = new HttpError({
      status: error.status,
      statusText: error.statusText,
      message: error.error?.message || error.statusText,
      userMessage: this.getErrorMessage(error),
      timestamp: new Date().toISOString(),
      path: error.url || request.url,
      details: error.error?.details,
    });

    // Show user-friendly error message
    this.alertService.danger(httpError.response.userMessage);

    // Let error handler process the error
    this.errorHandler.handleError(httpError);

    return throwError(() => httpError);
  }

  /**
   * Get user-friendly error message based on status code
   */
  private getErrorMessage(error: HttpErrorResponse): string {
    switch (error.status) {
      case 0:
        return 'Network error. Please check your connection and try again.';
      case 400:
        return 'Invalid request. Please check your input and try again.';
      case 401:
        return 'Session expired. Please login again.';
      case 403:
        return 'You do not have permission to perform this action.';
      case 404:
        return 'The requested resource was not found.';
      case 408:
      case 504:
        return 'Request timeout. Please try again.';
      case 429:
        return 'Too many requests. Please wait a moment and try again.';
      case 500:
      case 502:
      case 503:
        return 'Server error. The service is temporarily unavailable. Please try again later.';
      default:
        return error.error?.userMessage || `An error occurred (${error.status}). Please try again.`;
    }
  }

  /**
   * Determine if request body should be logged (exclude sensitive data)
   */
  private shouldLogBody(request: HttpRequest<unknown>): boolean {
    const sensitiveUrls = ['/login', '/auth', '/token', '/password'];
    return !sensitiveUrls.some((url) => request.url.includes(url));
  }
}
