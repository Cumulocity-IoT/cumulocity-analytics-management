import { FetchClient } from '@c8y/client';
import { CepError, fetchCepJSON, isTransientGatewayError } from './cep-error';

describe('cep-error', () => {
  describe('CepError', () => {
    it('keeps message, user message, cause and status', () => {
      const cause = new Error('root');
      const error = new CepError('tech', 'friendly', cause, 503);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CepError');
      expect(error.message).toBe('tech');
      expect(error.userMessage).toBe('friendly');
      expect(error.originalError).toBe(cause);
      expect(error.status).toBe(503);
    });
  });

  describe('isTransientGatewayError', () => {
    it('is true for 502, 503 and 504 CepErrors', () => {
      [502, 503, 504].forEach(status =>
        expect(isTransientGatewayError(new CepError('m', 'u', undefined, status))).toBeTrue()
      );
    });

    it('is false for other statuses, a missing status and foreign errors', () => {
      expect(isTransientGatewayError(new CepError('m', 'u', undefined, 500))).toBeFalse();
      expect(isTransientGatewayError(new CepError('m', 'u'))).toBeFalse();
      expect(isTransientGatewayError(new Error('x'))).toBeFalse();
      expect(isTransientGatewayError(undefined)).toBeFalse();
    });
  });

  describe('fetchCepJSON', () => {
    let fetchClient: jasmine.SpyObj<FetchClient>;

    beforeEach(() => {
      fetchClient = jasmine.createSpyObj<FetchClient>('FetchClient', ['fetch']);
    });

    it('returns the parsed JSON body and sends JSON headers', async () => {
      fetchClient.fetch.and.resolveTo({ ok: true, json: async () => ({ a: 1 }) } as unknown as Response);

      const result = await fetchCepJSON<{ a: number }>(fetchClient, '/service/cep/x');

      expect(result).toEqual({ a: 1 });
      const [url, options] = fetchClient.fetch.calls.mostRecent().args;
      expect(url).toBe('/service/cep/x');
      expect(options?.method).toBe('GET');
      expect(options?.headers).toEqual({ accept: 'application/json', 'content-type': 'application/json' });
    });

    it('lets callers override the HTTP method', async () => {
      fetchClient.fetch.and.resolveTo({ ok: true, json: async () => ({}) } as unknown as Response);
      await fetchCepJSON(fetchClient, '/x', { method: 'PUT' });
      expect(fetchClient.fetch.calls.mostRecent().args[1]?.method).toBe('PUT');
    });

    it('throws a CepError carrying the status for non-OK responses', async () => {
      fetchClient.fetch.and.resolveTo({ ok: false, status: 503, statusText: 'Unavailable' } as unknown as Response);

      await expectAsync(fetchCepJSON(fetchClient, '/x')).toBeRejected();
      try {
        await fetchCepJSON(fetchClient, '/x');
      } catch (error) {
        expect(error).toBeInstanceOf(CepError);
        expect((error as CepError).status).toBe(503);
        expect((error as CepError).message).toContain('503');
      }
    });

    it('wraps network failures in a CepError that keeps the original error', async () => {
      const networkError = new TypeError('Failed to fetch');
      fetchClient.fetch.and.rejectWith(networkError);

      try {
        await fetchCepJSON(fetchClient, '/x');
        fail('expected rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(CepError);
        expect((error as CepError).originalError).toBe(networkError);
        expect((error as CepError).status).toBeUndefined();
      }
    });
  });
});
