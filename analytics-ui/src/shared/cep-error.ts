import { FetchClient, IFetchOptions } from '@c8y/client';
import { gettext } from '@c8y/ngx-components/gettext';

/**
 * Shared error type for every Cep/Apama-related service (status, extension
 * inventory, extension enrichment, restart lifecycle).
 */
export class CepError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly originalError?: Error,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'CepError';
  }
}

// Gateway statuses meaning "engine unreachable / still starting" — transient,
// self-recovering, and not worth alarming the user over.
const TRANSIENT_GATEWAY_STATUSES = new Set([502, 503, 504]);

/** Whether an error is a transient gateway error (502/503/504) from a CEP call. */
export function isTransientGatewayError(error: unknown): boolean {
  return error instanceof CepError && TRANSIENT_GATEWAY_STATUSES.has(error.status ?? 0);
}

const JSON_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/json'
};

/** Shared GET/PUT-JSON helper: every Cep sub-service fetches through this. */
export async function fetchCepJSON<T>(
  fetchClient: FetchClient,
  url: string,
  options: Partial<IFetchOptions> = {}
): Promise<T> {
  try {
    const response = await fetchClient.fetch(url, {
      headers: JSON_HEADERS,
      method: 'GET',
      ...options
    });

    if (!response.ok) {
      throw new CepError(
        `API call failed: ${response.status} ${response.statusText}`,
        gettext(`Network request failed (${response.status}). Please check your connection and try again.`),
        undefined,
        response.status
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof CepError) {
      throw error;
    }

    throw new CepError(
      `Failed to fetch from ${url}`,
      gettext('Network error. Please check your connection and try again.'),
      error instanceof Error ? error : undefined
    );
  }
}
