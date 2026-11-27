import { IFetchResponse } from '@c8y/client';
import { gettext } from '@c8y/ngx-components/gettext';

/**
 * Shared error type for every repository-related service (config, GitHub
 * direct calls, backend-proxied calls, item listing, extension building).
 */
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly originalError?: Error,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/** Extracts a human-readable message from an error response body (JSON or plain text). */
export async function extractErrorMessage(response: IFetchResponse | Response): Promise<string> {
  try {
    const errorData = await response.json();
    return errorData.message || errorData.error || JSON.stringify(errorData);
  } catch {
    try {
      return (await response.text()) || gettext('Unknown error occurred');
    } catch {
      return gettext('Unknown error occurred');
    }
  }
}
