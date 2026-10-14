import { TestBed } from '@angular/core/testing';
import { FetchClient, TenantOptionsService } from '@c8y/client';
import {
  DUMMY_ACCESS_TOKEN,
  EXPERT_MODE_OPTION_KEY,
  GLOBAL_ACCESS_TOKEN_OPTION_KEY,
  Repository,
  REPOSITORY_OPTION_CATEGORY,
  SETTINGS_OPTION_CATEGORY,
  USE_BACKEND_SERVICE_OPTION_KEY
} from './analytics.model';
import { RepositoryConfigService } from './repository-config.service';
import { RepositoryError } from './repository-error';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const repo = (over: Partial<Repository> = {}): Repository =>
  ({ id: 'r1', name: 'Repo', url: 'https://github.com/o/r', accessToken: '', enabled: false, ...over }) as Repository;

describe('RepositoryConfigService', () => {
  let service: RepositoryConfigService;
  let fetchClient: jasmine.SpyObj<FetchClient>;
  let options: jasmine.SpyObj<TenantOptionsService>;

  beforeEach(() => {
    fetchClient = jasmine.createSpyObj<FetchClient>('FetchClient', ['fetch']);
    options = jasmine.createSpyObj<TenantOptionsService>('TenantOptionsService', ['create', 'delete', 'detail']);
    options.create.and.resolveTo({} as never);
    options.delete.and.resolveTo({} as never);
    TestBed.configureTestingModule({
      providers: [
        { provide: FetchClient, useValue: fetchClient },
        { provide: TenantOptionsService, useValue: options }
      ]
    });
    service = TestBed.inject(RepositoryConfigService);
    spyOn(console, 'warn');
  });

  /** Makes the category listing return `map` ({ key: json-string }). */
  const stored = (map: Record<string, unknown>) =>
    fetchClient.fetch.and.resolveTo(
      jsonResponse(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])))
    );

  const createdValue = (index = 0) => JSON.parse(options.create.calls.argsFor(index)[0].value as string);

  describe('fetchRepositories', () => {
    it('requests the category-scoped endpoint and masks access tokens', async () => {
      stored({
        a: { name: 'A', url: 'https://github.com/o/a', accessToken: 'secret', enabled: true },
        b: { name: 'B', url: 'https://github.com/o/b' }
      });

      const result = await service.fetchRepositories();

      expect(fetchClient.fetch.calls.mostRecent().args[0]).toBe(`tenant/options/${encodeURIComponent(REPOSITORY_OPTION_CATEGORY)}`);
      expect(result).toEqual([
        { id: 'a', name: 'A', url: 'https://github.com/o/a', accessToken: DUMMY_ACCESS_TOKEN, enabled: true },
        { id: 'b', name: 'B', url: 'https://github.com/o/b', accessToken: '', enabled: false }
      ]);
    });

    it('skips entries that are not valid JSON or have no url', async () => {
      stored({ bad: 'not json', nourl: { name: 'x' }, ok: { url: 'https://github.com/o/r' } });
      const result = await service.fetchRepositories();
      expect(result.map(r => r.id)).toEqual(['ok']);
    });

    it('treats 404 (nothing saved yet) as an empty list', async () => {
      fetchClient.fetch.and.resolveTo(jsonResponse({}, 404));
      expect(await service.fetchRepositories()).toEqual([]);
    });

    it('raises a RepositoryError carrying the status for other HTTP failures', async () => {
      fetchClient.fetch.and.resolveTo(jsonResponse({}, 403));
      await expectAsync(service.fetchRepositories()).toBeRejectedWith(
        jasmine.objectContaining({ name: 'RepositoryError', status: 403 })
      );
    });

    it('wraps network failures in a RepositoryError', async () => {
      fetchClient.fetch.and.rejectWith(new TypeError('offline'));
      const error = await service.fetchRepositories().catch(e => e);
      expect(error).toBeInstanceOf(RepositoryError);
      expect(error.originalError.message).toBe('offline');
    });
  });

  describe('saveRepositories', () => {
    it('creates a tenant option per repository', async () => {
      stored({});
      await service.saveRepositories([repo({ accessToken: 'new', enabled: true })]);

      const [call] = options.create.calls.mostRecent().args;
      expect(call.category).toBe(REPOSITORY_OPTION_CATEGORY);
      expect(call.key).toBe('r1');
      expect(createdValue()).toEqual({ name: 'Repo', url: 'https://github.com/o/r', enabled: true, accessToken: 'new' });
    });

    it('keeps the stored token when the masked placeholder is sent', async () => {
      stored({ r1: { name: 'Repo', url: 'https://github.com/o/r', accessToken: 'stored' } });
      await service.saveRepositories([repo({ accessToken: DUMMY_ACCESS_TOKEN })]);
      expect(createdValue().accessToken).toBe('stored');
    });

    it('clears the token when the url changed and no new token was entered', async () => {
      stored({ r1: { name: 'Repo', url: 'https://github.com/o/old', accessToken: 'stored' } });
      await service.saveRepositories([repo({ accessToken: DUMMY_ACCESS_TOKEN })]);
      expect(createdValue().accessToken).toBeUndefined();
    });

    it('keeps a newly entered token even if the url changed', async () => {
      stored({ r1: { name: 'Repo', url: 'https://github.com/o/old', accessToken: 'stored' } });
      await service.saveRepositories([repo({ accessToken: 'fresh' })]);
      expect(createdValue().accessToken).toBe('fresh');
    });

    it('clears the token when an empty one is sent', async () => {
      stored({ r1: { name: 'Repo', url: 'https://github.com/o/r', accessToken: 'stored' } });
      await service.saveRepositories([repo({ accessToken: '' })]);
      expect(createdValue().accessToken).toBeUndefined();
    });

    it('deletes options of repositories that are no longer in the list', async () => {
      stored({ r1: { url: 'https://github.com/o/r' }, gone: { url: 'https://github.com/o/gone' } });
      await service.saveRepositories([repo()]);
      expect(options.delete).toHaveBeenCalledOnceWith({ category: REPOSITORY_OPTION_CATEGORY, key: 'gone' });
    });

    it('wraps failures in a RepositoryError', async () => {
      stored({});
      options.create.and.rejectWith(new Error('denied'));
      await expectAsync(service.saveRepositories([repo()])).toBeRejectedWith(jasmine.any(RepositoryError));
    });
  });

  describe('access tokens', () => {
    it('getRepositoryAccessToken returns the stored token, or "" when unknown/unparseable', async () => {
      stored({ r1: { url: 'u', accessToken: 'tok' }, broken: 'not json' });
      expect(await service.getRepositoryAccessToken('r1')).toBe('tok');
      expect(await service.getRepositoryAccessToken('missing')).toBe('');
      expect(await service.getRepositoryAccessToken('broken')).toBe('');
    });

    it('resolveAccessToken uses a freshly typed token as-is', async () => {
      expect(await service.resolveAccessToken(repo({ accessToken: 'typed' }))).toBe('typed');
      expect(fetchClient.fetch).not.toHaveBeenCalled();
    });

    it('resolveAccessToken looks up the stored token for a masked, saved repository', async () => {
      stored({ r1: { url: 'u', accessToken: 'tok' } });
      expect(await service.resolveAccessToken(repo({ accessToken: DUMMY_ACCESS_TOKEN }))).toBe('tok');
    });

    it('resolveAccessToken falls back to the global token when the repository has none', async () => {
      stored({ r1: { url: 'u' } });
      options.detail.and.resolveTo({ data: { value: 'global' } } as never);
      expect(await service.resolveAccessToken(repo({ accessToken: DUMMY_ACCESS_TOKEN }))).toBe('global');
    });

    it('resolveAccessToken skips the lookup for unsaved (temp-) repositories', async () => {
      options.detail.and.resolveTo({ data: { value: 'global' } } as never);
      const token = await service.resolveAccessToken(repo({ id: 'temp-1', accessToken: DUMMY_ACCESS_TOKEN }));
      expect(token).toBe('global');
      expect(fetchClient.fetch).not.toHaveBeenCalled();
    });

    it('resolveAccessToken returns "" when nothing is configured', async () => {
      options.detail.and.rejectWith(new Error('404'));
      expect(await service.resolveAccessToken(repo({ accessToken: '' }))).toBe('');
    });
  });

  describe('global access token', () => {
    it('reads the value from the settings category', async () => {
      options.detail.and.resolveTo({ data: { value: 'g' } } as never);
      expect(await service.getGlobalAccessToken()).toBe('g');
      expect(options.detail).toHaveBeenCalledWith({ category: SETTINGS_OPTION_CATEGORY, key: GLOBAL_ACCESS_TOKEN_OPTION_KEY });
    });

    it('returns "" when unset or unreadable', async () => {
      options.detail.and.rejectWith(new Error('404'));
      expect(await service.getGlobalAccessToken()).toBe('');
    });

    it('masks the token for display', async () => {
      options.detail.and.resolveTo({ data: { value: 'g' } } as never);
      expect(await service.getGlobalAccessTokenMasked()).toBe(DUMMY_ACCESS_TOKEN);
      options.detail.and.resolveTo({ data: { value: '' } } as never);
      expect(await service.getGlobalAccessTokenMasked()).toBe('');
    });

    it('does nothing when the masked placeholder is sent', async () => {
      await service.setGlobalAccessToken(DUMMY_ACCESS_TOKEN);
      expect(options.create).not.toHaveBeenCalled();
      expect(options.delete).not.toHaveBeenCalled();
    });

    it('stores a new token', async () => {
      await service.setGlobalAccessToken('g');
      expect(options.create).toHaveBeenCalledOnceWith({ category: SETTINGS_OPTION_CATEGORY, key: GLOBAL_ACCESS_TOKEN_OPTION_KEY, value: 'g' });
    });

    it('deletes the token for an empty value and tolerates "nothing to delete"', async () => {
      options.delete.and.rejectWith(new Error('404'));
      await expectAsync(service.setGlobalAccessToken('')).toBeResolved();
      expect(options.delete).toHaveBeenCalled();
    });

    it('wraps storage failures in a RepositoryError', async () => {
      options.create.and.rejectWith(new Error('denied'));
      await expectAsync(service.setGlobalAccessToken('g')).toBeRejectedWith(jasmine.any(RepositoryError));
    });
  });

  describe('boolean settings', () => {
    it('expert mode: true only for "true", false by default and on errors', async () => {
      options.detail.and.resolveTo({ data: { value: 'true' } } as never);
      expect(await service.getExpertMode()).toBeTrue();
      options.detail.and.resolveTo({ data: { value: 'false' } } as never);
      expect(await service.getExpertMode()).toBeFalse();
      options.detail.and.rejectWith(new Error('404'));
      expect(await service.getExpertMode()).toBeFalse();
    });

    it('use-backend: defaults to true unless explicitly "false"', async () => {
      options.detail.and.resolveTo({ data: { value: 'false' } } as never);
      expect(await service.getUseBackendServiceEnabled()).toBeFalse();
      options.detail.and.resolveTo({ data: { value: 'true' } } as never);
      expect(await service.getUseBackendServiceEnabled()).toBeTrue();
      options.detail.and.rejectWith(new Error('404'));
      expect(await service.getUseBackendServiceEnabled()).toBeTrue();
    });

    it('persists the settings as strings', async () => {
      await service.setExpertMode(true);
      await service.setUseBackendServiceEnabled(false);
      expect(options.create.calls.argsFor(0)[0]).toEqual({ category: SETTINGS_OPTION_CATEGORY, key: EXPERT_MODE_OPTION_KEY, value: 'true' });
      expect(options.create.calls.argsFor(1)[0]).toEqual({ category: SETTINGS_OPTION_CATEGORY, key: USE_BACKEND_SERVICE_OPTION_KEY, value: 'false' });
    });

    it('wraps persistence failures in a RepositoryError', async () => {
      options.create.and.rejectWith(new Error('x'));
      await expectAsync(service.setExpertMode(true)).toBeRejectedWith(jasmine.any(RepositoryError));
      await expectAsync(service.setUseBackendServiceEnabled(true)).toBeRejectedWith(jasmine.any(RepositoryError));
    });
  });
});
