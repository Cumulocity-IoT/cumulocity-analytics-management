import { Injectable } from '@angular/core';
import { gettext } from '@c8y/ngx-components/gettext';
import { GITHUB_BASE, GitHubRelease, Repository } from './analytics.model';

/**
 * Thrown for any failure while listing GitHub Releases/assets. `userMessage`
 * is always safe to show directly in the UI (parity with `repository.service.ts`'s
 * rate-limit/auth/not-found messages).
 */
export class GitHubReleaseError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'GitHubReleaseError';
  }
}

/**
 * Lists GitHub Releases and their attached assets directly from the browser
 * (no server proxy) — see docs/features/block-marketplace/CONCEPT.md, section
 * "Extension: deploying already-built extensions from GitHub Releases".
 * Listing releases/assets is CORS-open; downloading the asset *bytes* is not
 * (see `triggerBrowserDownload` in `./utils.ts`), which is why this service
 * only ever returns metadata.
 */
@Injectable({
  providedIn: 'root'
})
export class GitHubReleaseService {
  /**
   * Extracts `{owner, repo}` from a `Repository.url`, which is either a GitHub
   * Contents API URL (`https://api.github.com/repos/{owner}/{repo}/contents/...`,
   * used by the built-in sample repos) or a plain GitHub web URL
   * (`https://github.com/{owner}/{repo}[/tree/{branch}/{path}]`, what the
   * "Manage repositories" form actually stores for user-configured repos).
   */
  parseOwnerRepo(repository: Repository): { owner: string; repo: string } | null {
    const rawUrl = repository?.url;
    if (!rawUrl) {
      return null;
    }

    let url: URL;
    try {
      url = new URL(rawUrl.match(/^https?:\/\//) ? rawUrl : `https://${rawUrl}`);
    } catch {
      return null;
    }

    const parts = url.pathname.split('/').filter(Boolean);

    if (url.hostname === 'api.github.com') {
      // ['repos', owner, repo, 'contents', ...]
      return parts[0] === 'repos' && parts[1] && parts[2]
        ? { owner: parts[1], repo: parts[2] }
        : null;
    }

    if (url.hostname === 'github.com') {
      // [owner, repo, 'tree'?, branch?, ...path]
      return parts[0] && parts[1] ? { owner: parts[0], repo: parts[1] } : null;
    }

    return null;
  }

  async listReleases(
    owner: string,
    repo: string,
    accessToken?: string
  ): Promise<GitHubRelease[]> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json'
    };
    if (accessToken) {
      headers['authorization'] = `Bearer ${accessToken}`;
    }

    let response: Response;
    try {
      response = await fetch(`${GITHUB_BASE}/repos/${owner}/${repo}/releases`, {
        method: 'GET',
        headers
      });
    } catch (error) {
      throw new GitHubReleaseError(
        'Failed to reach GitHub',
        gettext('Failed to connect to GitHub. Please check your connection.')
      );
    }

    if (!response.ok) {
      throw this.mapErrorResponse(response.status);
    }

    const data = await response.json();
    return (data as any[]).map(release => this.toGitHubRelease(release));
  }

  private toGitHubRelease(raw: any): GitHubRelease {
    return {
      id: raw.id,
      tagName: raw.tag_name,
      name: raw.name || raw.tag_name,
      publishedAt: raw.published_at,
      assets: (raw.assets || []).map((asset: any) => ({
        id: asset.id,
        name: asset.name,
        size: asset.size,
        browserDownloadUrl: asset.browser_download_url,
        contentType: asset.content_type
      }))
    };
  }

  private mapErrorResponse(status: number): GitHubReleaseError {
    switch (status) {
      case 401:
        return new GitHubReleaseError(
          `Failed to list releases: ${status}`,
          gettext('Authentication failed. The access token is invalid or expired (or not SSO-authorized for the organization).'),
          status
        );
      case 403:
      case 429:
        return new GitHubReleaseError(
          `Failed to list releases: ${status}`,
          gettext('Access denied or GitHub API rate limit exceeded. Unauthenticated requests are limited to 60/hour per IP — add a valid Personal Access Token to raise the limit to 5000/hour.'),
          status
        );
      case 404:
        return new GitHubReleaseError(
          `Failed to list releases: ${status}`,
          gettext('Repository not found, or it has no releases.'),
          status
        );
      default:
        return new GitHubReleaseError(
          `Failed to list releases: ${status}`,
          gettext(`Failed to list releases (status: ${status}). Please try again.`),
          status
        );
    }
  }
}
