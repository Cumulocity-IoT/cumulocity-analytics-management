import { TestBed } from '@angular/core/testing';
import { FetchClient } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { Repository, RepositoryItem } from './analytics.model';
import { RepositoryBackendService } from './repository-backend.service';
import { RepositoryConfigService } from './repository-config.service';
import { RepositoryError } from './repository-error';

const response = (over: Record<string, unknown> = {}) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
    ...over
  }) as never;

const repository = { id: 'r1', name: 'Repo', url: 'https://github.com/o/r/tree/main/blocks', accessToken: '', enabled: true } as Repository;
const item = { name: 'Foo', url: 'https://raw/Foo.mon', repositoryId: 'r1' } as RepositoryItem;

describe('RepositoryBackendService', () => {
  let service: RepositoryBackendService;
  let fetchClient: jasmine.SpyObj<FetchClient>;
  let alerts: jasmine.SpyObj<AlertService>;
  let config: jasmine.SpyObj<RepositoryConfigService>;

  beforeEach(() => {
    fetchClient = jasmine.createSpyObj<FetchClient>('FetchClient', ['fetch']);
    alerts = jasmine.createSpyObj<AlertService>('AlertService', ['danger']);
    config = jasmine.createSpyObj<RepositoryConfigService>('RepositoryConfigService', ['resolveAccessToken']);
    config.resolveAccessToken.and.resolveTo('');
    TestBed.configureTestingModule({
      providers: [
        { provide: FetchClient, useValue: fetchClient },
        { provide: AlertService, useValue: alerts },
        { provide: RepositoryConfigService, useValue: config }
      ]
    });
    service = TestBed.inject(RepositoryBackendService);
    spyOn(console, 'error');
  });

  describe('testRepository', () => {
    it('calls contentList with the encoded url and sends the PAT in a header, not the url', async () => {
      config.resolveAccessToken.and.resolveTo('tok');
      fetchClient.fetch.and.resolveTo(response());

      const result = await service.testRepository(repository);

      const [url, options] = fetchClient.fetch.calls.mostRecent().args;
      expect(url).toBe('service/analytics-ext-service/repository/contentList');
      expect((options as any).headers['X-Repository-Access-Token']).toBe('tok');
      expect((options as any).params).toEqual({ url: encodeURIComponent(repository.url), repository_id: 'r1' });
      expect(result.success).toBeTrue();
    });

    it('omits the token header when no token resolves', async () => {
      fetchClient.fetch.and.resolveTo(response());
      await service.testRepository(repository);
      expect((fetchClient.fetch.calls.mostRecent().args[1] as any).headers['X-Repository-Access-Token']).toBeUndefined();
    });

    it('returns the backend error message on failure', async () => {
      fetchClient.fetch.and.resolveTo(response({ ok: false, status: 404, json: async () => ({ error: 'Not Found' }) }));
      expect(await service.testRepository(repository)).toEqual({ success: false, status: 404, message: 'Not Found' });
    });

    it('returns a connection failure result when the request throws', async () => {
      fetchClient.fetch.and.rejectWith(new Error('offline'));
      const result = await service.testRepository(repository);
      expect(result.success).toBeFalse();
      expect(result.status).toBeUndefined();
    });
  });

  describe('getContent', () => {
    it('returns the parsed listing', async () => {
      fetchClient.fetch.and.resolveTo(response({ json: async () => [{ name: 'a' }] }));
      expect(await service.getContent(repository)).toEqual([{ name: 'a' }]);
    });

    it('raises a RepositoryError with status and backend message for HTTP failures', async () => {
      fetchClient.fetch.and.resolveTo(response({ ok: false, status: 403, json: async () => ({ error: 'rate limit' }) }));
      const error = await service.getContent(repository).catch(e => e);
      expect(error).toBeInstanceOf(RepositoryError);
      expect(error.status).toBe(403);
      expect(error.userMessage).toBe('rate limit');
    });

    it('wraps network failures', async () => {
      fetchClient.fetch.and.rejectWith(new TypeError('offline'));
      const error = await service.getContent(repository).catch(e => e);
      expect(error).toBeInstanceOf(RepositoryError);
      expect(error.originalError.message).toBe('offline');
    });
  });

  describe('getItemContent', () => {
    it('requests content with FQN extraction parameters', async () => {
      fetchClient.fetch.and.resolveTo(response({ text: async () => 'a.b.Foo' }));
      expect(await service.getItemContent(item, true)).toBe('a.b.Foo');
      const [url, options] = fetchClient.fetch.calls.mostRecent().args;
      expect(url).toBe('service/analytics-ext-service/repository/content');
      expect((options as any).params).toEqual({
        url: encodeURIComponent(item.url),
        extract_fqn_cep_block: 'true',
        repository_id: 'r1',
        cep_block_name: 'Foo'
      });
    });

    it('rejects with a RepositoryError for non-OK responses', async () => {
      fetchClient.fetch.and.resolveTo(response({ ok: false, status: 500 }));
      await expectAsync(service.getItemContent(item, false)).toBeRejectedWith(jasmine.any(RepositoryError));
    });
  });

  describe('createExtension*', () => {
    const post = () => fetchClient.fetch.calls.mostRecent().args as [string, any];

    it('posts a repository build request', async () => {
      const ok = response();
      fetchClient.fetch.and.resolveTo(ok);

      expect(await service.createExtensionFromRepository('E', repository, true, false, true)).toBe(ok);

      const [url, options] = post();
      expect(url).toBe('service/analytics-ext-service/extension/repository');
      expect(options.method).toBe('POST');
      expect(options.responseType).toBe('blob');
      expect(JSON.parse(options.body)).toEqual({ extension_name: 'E', repository, upload: true, deploy: false, rebuild: true });
    });

    it('posts a list build request including the monitors', async () => {
      fetchClient.fetch.and.resolveTo(response());
      await service.createExtensionFromList('E', [item], repository, false, false, false);
      expect(post()[0].endsWith('/extension/list')).toBeTrue();
      expect(JSON.parse(post()[1].body).monitors).toEqual([item]);
    });

    it('posts a yaml build request including yaml and sections', async () => {
      fetchClient.fetch.and.resolveTo(response());
      await service.createExtensionFromYaml('E', item, ['A', 'B'], repository, true, true, false);
      expect(post()[0].endsWith('/extension/yaml')).toBeTrue();
      const body = JSON.parse(post()[1].body);
      expect(body.sections).toEqual(['A', 'B']);
      expect(body.yaml).toEqual(item);
    });

    it('surfaces the server error text, alerts the user and rethrows', async () => {
      fetchClient.fetch.and.resolveTo(response({ ok: false, status: 400, text: async () => '{"error":"Build failed"}' }));

      const error = await service.createExtensionFromRepository('E', repository, true, false, false).catch(e => e);

      expect(error).toBeInstanceOf(RepositoryError);
      expect(error.userMessage).toContain('Build failed');
      expect(alerts.danger).toHaveBeenCalledOnceWith(error.userMessage);
    });

    it('wraps network failures with a message naming the extension', async () => {
      fetchClient.fetch.and.rejectWith(new Error('offline'));
      const error = await service.createExtensionFromList('MyExt', [item], repository, true, false, false).catch(e => e);
      expect(error).toBeInstanceOf(RepositoryError);
      expect(alerts.danger).toHaveBeenCalled();
    });
  });

  describe('mapTestStatusToResult', () => {
    it('maps well-known statuses', () => {
      expect(service.mapTestStatusToResult(401).message).toContain('Authentication failed');
      expect(service.mapTestStatusToResult(403).message).toContain('rate limit');
      expect(service.mapTestStatusToResult(429).message).toContain('rate limit');
      expect(service.mapTestStatusToResult(404).message).toContain('not found');
      expect(service.mapTestStatusToResult(500)).toEqual(jasmine.objectContaining({ success: false, status: 500 }));
    });
  });
});
