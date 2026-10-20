import { HttpError, HttpErrorResponse } from './error.model';

describe('HttpError', () => {
  const response: HttpErrorResponse = {
    status: 404, statusText: 'Not Found', message: 'raw', userMessage: 'The requested resource was not found.', timestamp: '2026-01-01T00:00:00Z'
  };

  it('uses the user message as the error message by default', () => {
    const error = new HttpError(response);
    expect(error.message).toBe(response.userMessage);
    expect(error.response).toBe(response);
    expect(error.name).toBe('HttpError');
  });

  it('accepts an explicit message', () => {
    expect(new HttpError(response, 'custom').message).toBe('custom');
  });

  it('survives instanceof checks (prototype is restored)', () => {
    expect(new HttpError(response) instanceof HttpError).toBeTrue();
    expect(new HttpError(response) instanceof Error).toBeTrue();
  });
});
