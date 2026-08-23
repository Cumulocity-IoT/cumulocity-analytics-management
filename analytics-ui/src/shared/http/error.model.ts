/**
 * Standardized error response model for HTTP errors
 */
export interface HttpErrorResponse {
  status: number;
  statusText: string;
  message: string;
  userMessage: string;
  timestamp: string;
  path?: string;
  details?: Record<string, unknown>;
}

/**
 * Custom error class for HTTP-related errors
 */
export class HttpError extends Error {
  constructor(
    public readonly response: HttpErrorResponse,
    message?: string
  ) {
    super(message || response.userMessage);
    this.name = 'HttpError';
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

/**
 * Error handling configuration
 */
export interface ErrorHandlingConfig {
  retryableStatusCodes: number[];
  maxRetries: number;
  retryDelay: number;
  exponentialBackoff: boolean;
}

/**
 * Retry strategy for failed requests
 */
export interface RetryConfig {
  maxRetries: number;
  delay: number;
  exponentialBackoff: boolean;
  backoffMultiplier: number;
}
