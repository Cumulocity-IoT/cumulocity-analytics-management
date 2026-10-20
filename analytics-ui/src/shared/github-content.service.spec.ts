import { TestBed } from '@angular/core/testing';
import { Repository, RepositoryItem } from './analytics.model';
import { GitHubContentService } from './github-content.service';
import { RepositoryConfigService } from './repository-config.service';
import { RepositoryError } from './repository-error';

const res = (over: Record<string, unknown> = {}) =>
  ({ ok: true, status: 200, json: async () => ({}), text: async () => '', ...over }) as unknown as Response;

const repository = { id: 'r1', name: 'Repo', url: 'https://github.com/o/r/tree/dev/blocks', accessToken: '', enabled: true } as Repository;

describe('GitHubContentService', () => {
  let service: GitHubContentService;
  let config: jasmine.SpyObj<RepositoryConfigService>;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    config = jasmine.createSpyObj<RepositoryConfigService>('RepositoryConfigService', ['resolveAccessToken']);
    config.resolveAccessToken.and.resolveTo('');
    TestBed.configureTestingModule({ providers: [{ provide: RepositoryConfigService, useValue: config }] });
    service = TestBed.inject(GitHubContentService);
    fetchSpy = spyOn(window, 'fetch');
  });

  describe('toContentApiUrl', () => {
    it('passes Contents API urls through unchanged', () => {
      const url = 'https://api.github.com/repos/o/r/contents/blocks';
      expect(service.toContentApiUrl(url)).toBe(url);
    });

    it('converts GitHub web urls', () => {
      expect(service.toContentApiUrl('https://github.com/o/r/tree/dev/blocks')).toBe(
        'https://api.github.com/repos/o/r/contents/blocks?ref=dev'
      );
    });
  });

  describe('testRepository', () => {
    it('queries the Contents API, sending the resolved token as Bearer', async () => {
      config.resolveAccessToken.and.resolveTo('tok');
      fetchSpy.and.resolveTo(res());

      const result = await service.testRepository(repository);

      const [url, options] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe('https://api.github.com/repos/o/r/contents/blocks?ref=dev');
      expect(options.headers.authorization).toBe('Bearer tok');
      expect(result.success).toBeTrue();
    });

    it('sends no authorization header without a token', async () => {
      fetchSpy.and.resolveTo(res());
      await service.testRepository(repository);
      expect(fetchSpy.calls.mostRecent().args[1].headers.authorization).toBeUndefined();
    });

    it('prefers GitHub\'s own error message', async () => {
      fetchSpy.and.resolveTo(res({ ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) }));
      expect(await service.testRepository(repository)).toEqual({ success: false, status: 401, message: 'Bad credentials' });
    });

    it('reports a connection failure for network errors and invalid urls', async () => {
      fetchSpy.and.rejectWith(new TypeError('offline'));
      expect((await service.testRepository(repository)).success).toBeFalse();
      const invalid = await service.testRepository({ ...repository, url: 'https://example.com/x/y' });
      expect(invalid.success).toBeFalse();
    });
  });

  describe('getContent', () => {
    it('returns the listing', async () => {
      fetchSpy.and.resolveTo(res({ json: async () => [{ name: 'A.mon' }] }));
      expect(await service.getContent(repository)).toEqual([{ name: 'A.mon' }]);
    });

    it('raises a RepositoryError with the status for HTTP failures', async () => {
      fetchSpy.and.resolveTo(res({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) }));
      const error = await service.getContent(repository).catch(e => e);
      expect(error).toBeInstanceOf(RepositoryError);
      expect(error.status).toBe(404);
      expect(error.userMessage).toBe('Not Found');
    });

    it('wraps network failures', async () => {
      fetchSpy.and.rejectWith(new TypeError('offline'));
      await expectAsync(service.getContent(repository)).toBeRejectedWith(jasmine.any(RepositoryError));
    });
  });

  describe('getItemContent', () => {
    const block = { name: 'Foo', downloadUrl: 'https://raw.githubusercontent.com/o/r/dev/Foo.mon' } as RepositoryItem;

    it('fetches the raw file without custom headers (avoids a CORS preflight)', async () => {
      fetchSpy.and.resolveTo(res({ text: async () => 'content' }));
      expect(await service.getItemContent(block, false)).toBe('content');
      expect(fetchSpy).toHaveBeenCalledWith(block.downloadUrl, { method: 'GET' });
    });

    it('extracts the fully qualified name from the package declaration', async () => {
      fetchSpy.and.resolveTo(res({ text: async () => 'package com.acme.blocks;\nevent Foo {}' }));
      expect(await service.getItemContent(block, true)).toBe('com.acme.blocks.Foo');
    });

    it('fails when FQN extraction is requested but no package exists', async () => {
      fetchSpy.and.resolveTo(res({ text: async () => 'event Foo {}' }));
      await expectAsync(service.getItemContent(block, true)).toBeRejectedWith(jasmine.any(RepositoryError));
    });

    it('fails for non-OK responses and network errors', async () => {
      fetchSpy.and.resolveTo(res({ ok: false, status: 404 }));
      await expectAsync(service.getItemContent(block, false)).toBeRejectedWith(jasmine.any(RepositoryError));
      fetchSpy.and.rejectWith(new TypeError('offline'));
      await expectAsync(service.getItemContent(block, false)).toBeRejectedWith(jasmine.any(RepositoryError));
    });
  });

  describe('mapTestStatusToResult', () => {
    it('maps well-known statuses', () => {
      expect(service.mapTestStatusToResult(401).message).toContain('Authentication failed');
      expect(service.mapTestStatusToResult(403).message).toContain('rate limit');
      expect(service.mapTestStatusToResult(404).message).toContain('not found');
      expect(service.mapTestStatusToResult(418).status).toBe(418);
    });
  });
});
