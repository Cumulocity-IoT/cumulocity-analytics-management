import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { HttpError } from './error.model';

/**
 * Service for centralized error handling and tracking
 */
@Injectable({
  providedIn: 'root',
})
export class ErrorHandlerService {
  private readonly errors$ = new BehaviorSubject<HttpError[]>([]);
  private readonly lastError$ = new BehaviorSubject<HttpError | null>(null);
  private readonly errorLog: HttpError[] = [];
  private readonly maxErrorLog = 50; // Keep last 50 errors

  /**
   * Get stream of all errors
   */
  getErrors(): Observable<HttpError[]> {
    return this.errors$.asObservable();
  }

  /**
   * Get stream of last error
   */
  getLastError(): Observable<HttpError | null> {
    return this.lastError$.asObservable();
  }

  /**
   * Get error history
   */
  getErrorHistory(): HttpError[] {
    return [...this.errorLog];
  }

  /**
   * Clear error history
   */
  clearErrorHistory(): void {
    this.errorLog.length = 0;
    this.errors$.next([]);
    this.lastError$.next(null);
  }

  /**
   * Handle error and add to log
   */
  handleError(error: HttpError): void {
    this.errorLog.push(error);

    // Keep only last N errors
    if (this.errorLog.length > this.maxErrorLog) {
      this.errorLog.shift();
    }

    this.errors$.next([...this.errorLog]);
    this.lastError$.next(error);

    // Log error details for debugging
    this.logErrorDetails(error);
  }

  /**
   * Log error details for debugging
   */
  private logErrorDetails(error: HttpError): void {
    const logEntry = {
      timestamp: error.response.timestamp,
      status: error.response.status,
      message: error.response.message,
      path: error.response.path,
      details: error.response.details,
    };

    console.group(`❌ Error: ${error.response.status} ${error.response.statusText}`);
    console.error('Error Details:', logEntry);
    console.groupEnd();
  }

  /**
   * Get error count
   */
  getErrorCount(): number {
    return this.errorLog.length;
  }

  /**
   * Get errors by status code
   */
  getErrorsByStatus(status: number): HttpError[] {
    return this.errorLog.filter((e) => e.response.status === status);
  }
}
