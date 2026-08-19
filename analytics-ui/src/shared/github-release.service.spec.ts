import { TestBed } from '@angular/core/testing';
import { GitHubReleaseService, GitHubReleaseError } from './github-release.service';
import { Repository } from './analytics.model';

describe('GitHubReleaseService', () => {
  let service: GitHubReleaseService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GitHubReleaseService]
    });
    service = TestBed.inject(GitHubReleaseService);
    fetchSpy = spyOn(window, 'fetch');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('parseOwnerRepo', () => {
    it('extracts owner/repo from a Contents API URL', () => {
      const repository = {
        url: 'https://api.github.com/repos/Cumulocity-IoT/analytics-builder-blocks-contrib/contents/blocks'
      } as Repository;

      expect(service.parseOwnerRepo(repository)).toEqual({
        owner: 'Cumulocity-IoT',
        repo: 'analytics-builder-blocks-contrib'
      });
    });

    it('extracts owner/repo from a plain GitHub web URL with a tree/branch/path suffix', () => {
      // This is the shape actually stored for user-configured repos added via
      // the "Manage repositories" form (see the Repository URL field there).
      const repository = {
        url: 'https://github.com/Cumulocity-IoT/cumulocity-analytics-management/tree/main/repository'
      } as Repository;

      expect(service.parseOwnerRepo(repository)).toEqual({
        owner: 'Cumulocity-IoT',
        repo: 'cumulocity-analytics-management'
      });
    });

    it('extracts owner/repo from a bare GitHub web URL', () => {
      const repository = {
        url: 'https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib'
      } as Repository;

      expect(service.parseOwnerRepo(repository)).toEqual({
        owner: 'Cumulocity-IoT',
        repo: 'analytics-builder-blocks-contrib'
      });
    });

    it('returns null for a non-matching URL', () => {
      const repository = { url: 'https://example.com/not-github' } as Repository;
      expect(service.parseOwnerRepo(repository)).toBeNull();
    });
  });

  describe('listReleases', () => {
    it('maps the GitHub releases payload into GitHubRelease[]', async () => {
      fetchSpy.and.resolveTo({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          {
            id: 1,
            tag_name: '1.0.1',
            name: 'Release 1.0.1',
            published_at: '2026-02-12T15:11:06Z',
            assets: [
              {
                id: 10,
                name: 'Abs-1.0.1.zip',
                size: 1544,
                browser_download_url: 'https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib/releases/download/1.0.1/Abs-1.0.1.zip',
                content_type: 'application/zip'
              }
            ]
          }
        ])
      } as unknown as Response);

      const releases = await service.listReleases('Cumulocity-IoT', 'analytics-builder-blocks-contrib');

      expect(releases.length).toBe(1);
      expect(releases[0].tagName).toBe('1.0.1');
      expect(releases[0].assets[0].name).toBe('Abs-1.0.1.zip');
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.github.com/repos/Cumulocity-IoT/analytics-builder-blocks-contrib/releases',
        jasmine.objectContaining({ method: 'GET' })
      );
    });

    it('attaches an Authorization header when an access token is given', async () => {
      fetchSpy.and.resolveTo({ ok: true, status: 200, json: () => Promise.resolve([]) } as unknown as Response);

      await service.listReleases('owner', 'repo', 'my-token');

      const [, options] = fetchSpy.calls.mostRecent().args;
      expect(options.headers.authorization).toBe('Bearer my-token');
    });

    it('maps a 404 response to a friendly not-found message', async () => {
      fetchSpy.and.resolveTo({ ok: false, status: 404 } as unknown as Response);

      await expectAsync(service.listReleases('owner', 'repo')).toBeRejectedWith(
        jasmine.any(GitHubReleaseError)
      );
    });

    it('maps a 403 response to a rate-limit message', async () => {
      fetchSpy.and.resolveTo({ ok: false, status: 403 } as unknown as Response);

      try {
        await service.listReleases('owner', 'repo');
        fail('expected listReleases to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(GitHubReleaseError);
        expect((error as GitHubReleaseError).userMessage).toContain('rate limit');
      }
    });
  });
});
