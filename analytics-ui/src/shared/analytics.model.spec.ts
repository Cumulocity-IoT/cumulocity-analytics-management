import { createDefaultRepository, DEFAULT_REPOSITORY_URL, ErrorType, REPO_SAMPLES } from './analytics.model';
import { ERROR_MESSAGES } from './analytics.constants';

describe('analytics.model', () => {
  describe('createDefaultRepository', () => {
    it('is the enabled community blocks repository without an access token', () => {
      const repo = createDefaultRepository();
      expect(repo.url).toBe(DEFAULT_REPOSITORY_URL);
      expect(repo.enabled).toBeTrue();
      expect(repo.accessToken).toBe('');
      expect(repo.name).toContain('Community Blocks');
    });

    it('uses a plain GitHub web url, not a Contents API url', () => {
      expect(DEFAULT_REPOSITORY_URL.startsWith('https://github.com/')).toBeTrue();
    });

    it('creates a new id for each call', () => {
      expect(createDefaultRepository().id).not.toBe(createDefaultRepository().id);
    });
  });

  describe('REPO_SAMPLES', () => {
    it('has unique ids and enables only the first two by default', () => {
      expect(new Set(REPO_SAMPLES.map(r => r.id)).size).toBe(REPO_SAMPLES.length);
      expect(REPO_SAMPLES.filter(r => r.enabled).length).toBe(2);
    });

    it('all point to the GitHub Contents API', () => {
      expect(REPO_SAMPLES.every(r => r.url.startsWith('https://api.github.com/repos/'))).toBeTrue();
    });
  });

  describe('ERROR_MESSAGES', () => {
    it('has a message for every upload error type', () => {
      Object.values(ErrorType).forEach(type =>
        expect((ERROR_MESSAGES as Record<string, string>)[type]).withContext(type).toBeTruthy()
      );
    });
  });
});
