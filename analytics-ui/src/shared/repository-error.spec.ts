import { extractErrorMessage, RepositoryError } from './repository-error';

describe('repository-error', () => {
  describe('RepositoryError', () => {
    it('keeps message, user message, cause and status', () => {
      const cause = new Error('root');
      const error = new RepositoryError('tech', 'friendly', cause, 404);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('RepositoryError');
      expect(error.message).toBe('tech');
      expect(error.userMessage).toBe('friendly');
      expect(error.originalError).toBe(cause);
      expect(error.status).toBe(404);
    });
  });

  describe('extractErrorMessage', () => {
    const response = (json: () => Promise<unknown>, text: () => Promise<string>) =>
      ({ json, text }) as unknown as Response;

    it('prefers the "message" field', async () => {
      const r = response(async () => ({ message: 'm', error: 'e' }), async () => '');
      expect(await extractErrorMessage(r)).toBe('m');
    });

    it('falls back to the "error" field (analytics-service format)', async () => {
      const r = response(async () => ({ error: 'e' }), async () => '');
      expect(await extractErrorMessage(r)).toBe('e');
    });

    it('stringifies other JSON bodies', async () => {
      const r = response(async () => ({ foo: 1 }), async () => '');
      expect(await extractErrorMessage(r)).toBe('{"foo":1}');
    });

    it('uses the plain text when the body is not JSON', async () => {
      const r = response(() => Promise.reject(new SyntaxError()), async () => 'plain text');
      expect(await extractErrorMessage(r)).toBe('plain text');
    });

    it('returns a generic message for an empty text body', async () => {
      const r = response(() => Promise.reject(new Error()), async () => '');
      expect(await extractErrorMessage(r)).toBe('Unknown error occurred');
    });

    it('returns a generic message when the body cannot be read at all', async () => {
      const r = response(() => Promise.reject(new Error()), () => Promise.reject(new Error()));
      expect(await extractErrorMessage(r)).toBe('Unknown error occurred');
    });
  });
});
