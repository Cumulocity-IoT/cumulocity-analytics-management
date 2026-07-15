import { Injectable } from '@angular/core';
import { gettext } from '@c8y/ngx-components/gettext';
import { GITHUB_BASE, Repository, RepositoryItem, RepositoryTestResult } from './analytics.model';
import { RepositoryConfigService } from './repository-config.service';
import { extractErrorMessage, RepositoryError } from './repository-error';
import { githubWebUrlToContentApi } from './utils';

/**
 * Direct-to-GitHub implementation of repository test/list/content-fetch —
 * no `analytics-service` backend involved. See `RepositoryModeService` for
 * how callers decide whether to use this or `RepositoryBackendService`.
 */
@Injectable({
  providedIn: 'root'
})
export class GitHubContentService {
  constructor(private readonly repositoryConfigService: RepositoryConfigService) {}

  /**
   * Tests a repository directly against GitHub's Content API — works (and
   * fails with a real GitHub-side reason) even without `analytics-service`
   * deployed.
   */
  async testRepository(repository: Repository): Promise<RepositoryTestResult> {
    try {
      const contentApiUrl = this.toContentApiUrl(repository.url);
      const accessToken = await this.repositoryConfigService.resolveAccessToken(repository);

      const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
      if (accessToken) {
        headers['authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(contentApiUrl, { method: 'GET', headers });

      if (response.ok) {
        return {
          success: true,
          message: gettext('Successfully connected to repository'),
          status: response.status
        };
      }
      // Prefer GitHub's specific reason (e.g. bad credentials, SSO
      // authorization required) over the generic status-based message.
      const githubMessage = await extractErrorMessage(response);
      return {
        success: false,
        status: response.status,
        message: githubMessage || this.mapTestStatusToResult(response.status).message
      };
    } catch (error) {
      return this.handleTestError();
    }
  }

  /**
   * Lists a repository's content directly against GitHub's Content API.
   * GitHub returns a directory listing as a plain array (or a single object
   * for a file path); `RepositoryItemsService.processGitHubContent` already
   * handles both via `Object.values(...)`, so the response is passed
   * straight through unchanged.
   */
  async getContent(repository: Repository): Promise<any[]> {
    try {
      const contentApiUrl = this.toContentApiUrl(repository.url);
      const accessToken = await this.repositoryConfigService.resolveAccessToken(repository);

      const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
      if (accessToken) {
        headers['authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(contentApiUrl, { method: 'GET', headers });

      if (!response.ok) {
        const errorMessage = await extractErrorMessage(response);
        throw new RepositoryError(
          `Failed to get GitHub content: ${response.status}`,
          errorMessage,
          undefined,
          response.status
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to fetch GitHub content',
        gettext('Failed to connect to GitHub. Please check your connection and repository settings.'),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Fetches a single file's raw content directly from GitHub (no backend
   * proxy). If `extractFQN` is set, parses the `package X;` declaration out
   * of the content and returns `X.<block name>` instead of the raw text.
   */
  async getItemContent(block: RepositoryItem, extractFQN: boolean): Promise<string> {
    let response: Response;
    try {
      // No custom headers: block.downloadUrl already points straight at
      // raw.githubusercontent.com (a plain static file, not the GitHub API),
      // and any header outside the CORS-safelisted set — e.g. a Content-Type
      // that isn't text/plain/form-encoded — forces a preflight OPTIONS
      // request, which this static CDN doesn't handle, blocking the fetch
      // entirely.
      response = await fetch(block.downloadUrl, { method: 'GET' });
    } catch (error) {
      throw new RepositoryError(
        'Failed to fetch content directly',
        gettext('Failed to download content from GitHub.'),
        error instanceof Error ? error : undefined
      );
    }

    if (!response.ok) {
      throw new RepositoryError(
        `Failed to fetch content: ${response.status}`,
        gettext('Failed to download content from GitHub.')
      );
    }

    const content = await response.text();
    return extractFQN ? this.extractFQN(content, block) : content;
  }

  /**
   * Converts a `Repository.url` into a GitHub Contents API URL, accepting
   * both shapes the field can hold: an already-Contents-API URL (the
   * built-in sample repos) or a plain GitHub web URL, e.g.
   * `github.com/{owner}/{repo}/tree/{branch}/{path}` (what "Manage
   * repositories" actually stores for user-added repos).
   */
  toContentApiUrl(url: string): string {
    if (url.startsWith(GITHUB_BASE)) {
      return url;
    }
    return githubWebUrlToContentApi(url);
  }

  mapTestStatusToResult(status: number): RepositoryTestResult {
    switch (status) {
      case 401:
        return { success: false, status, message: gettext('Authentication failed. The access token is invalid or expired (or not SSO-authorized for the organization).') };
      case 403:
      case 429:
        return { success: false, status, message: gettext('Access denied or GitHub API rate limit exceeded. Unauthenticated requests are limited to 60/hour per IP — add a valid Personal Access Token to raise the limit to 5000/hour.') };
      case 404:
        return { success: false, status, message: gettext('Repository not found. Please check the URL.') };
      default:
        return { success: false, status, message: gettext(`Connection failed (status: ${status}). Please try again.`) };
    }
  }

  private extractFQN(content: string, block: RepositoryItem): string {
    const regex = /(?<=^package\s)(.*?)(?=;)/gm;
    const match = content.match(regex);

    if (match && match[0]) {
      const packageName = match[0].trim();
      // block.name already has its file extension stripped by
      // removeFileExtension() when the RepositoryItem was created — do not
      // slice it again here.
      return `${packageName}.${block.name}`;
    }

    throw new RepositoryError(
      'Could not extract FQN from content',
      gettext('Failed to extract block information from file.')
    );
  }

  private handleTestError(): RepositoryTestResult {
    // fetch() only rejects on network errors (DNS, CORS, abort); status-code
    // mapping happens in mapTestStatusToResult against response.status.
    return {
      success: false,
      message: gettext('Failed to connect to repository. Please check your connection and try again.')
    };
  }
}
