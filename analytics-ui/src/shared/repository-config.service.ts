import { Injectable } from '@angular/core';
import { FetchClient, ITenantOption, TenantOptionsService } from '@c8y/client';
import { gettext } from '@c8y/ngx-components/gettext';
import {
  DUMMY_ACCESS_TOKEN,
  EXPERT_MODE_OPTION_KEY,
  Repository,
  REPOSITORY_OPTION_CATEGORY,
  SETTINGS_OPTION_CATEGORY,
  USE_BACKEND_SERVICE_OPTION_KEY
} from './analytics.model';
import { RepositoryError } from './repository-error';

/**
 * Repository config storage — always Cumulocity Tenant Options directly, no
 * backend microservice involved. There is no second ("backend") mode here:
 * the old `analytics-service` config endpoint just proxied to the same
 * tenant option store this reads/writes, so there's nothing to branch on
 * (see `RepositoryModeService` for the methods that genuinely have two
 * implementations).
 *
 * Matches the wire format `analytics-service/c8y_agent.py` already
 * writes/reads (category `REPOSITORY_OPTION_CATEGORY`, one option per
 * repository keyed by id), so entries created by either side interoperate.
 */
@Injectable({
  providedIn: 'root'
})
export class RepositoryConfigService {
  constructor(
    private readonly fetchClient: FetchClient,
    private readonly tenantOptionsService: TenantOptionsService
  ) {}

  /**
   * Reads repository config directly from Cumulocity tenant options. The
   * real access token is never returned here; see `parseRepositoryOption`.
   */
  async fetchRepositories(): Promise<Repository[]> {
    try {
      const options = await this.listRepositoryOptions();
      return options
        .map(option => this.parseRepositoryOption(option))
        .filter((repo): repo is Repository => repo !== null);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to fetch repositories',
        gettext('Failed to load repositories. Please check your permissions.'),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Persists the given repository list directly as Cumulocity tenant options
   * (create/update one option per repository, delete options for repositories
   * no longer present) — mirrors `analytics-service/c8y_agent.py`'s
   * `update_repositories`/`_save_repository`/`_delete_repository`
   * (requires `ROLE_OPTION_MANAGEMENT_ADMIN`/`ROLE_TENANT_MANAGEMENT_ADMIN`).
   */
  async saveRepositories(repositories: Repository[]): Promise<void> {
    try {
      const existingOptions = await this.listRepositoryOptions();
      const existingById = new Map(existingOptions.map(option => [option.key, option]));

      for (const repo of repositories) {
        await this.saveRepositoryOption(repo, existingById.get(repo.id));
        existingById.delete(repo.id);
      }

      // Anything left is no longer present in the incoming list — delete it.
      for (const staleId of existingById.keys()) {
        await this.tenantOptionsService.delete({
          category: REPOSITORY_OPTION_CATEGORY,
          key: staleId
        });
      }
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to save repositories',
        gettext('Failed to save repositories. Please check your permissions and try again.'),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Returns the real (unmasked) access token for a repository, for direct
   * GitHub calls — `Repository.accessToken` from `fetchRepositories()` is
   * always masked behind `DUMMY_ACCESS_TOKEN` (see `parseRepositoryOption`)
   * so it's safe to render in the "Manage repositories" form; that masked
   * value is never usable as a real `Authorization` header.
   */
  async getRepositoryAccessToken(repositoryId: string): Promise<string> {
    const options = await this.listRepositoryOptions();
    const option = options.find(o => o.key === repositoryId);
    if (!option) {
      return '';
    }
    let parsed: Partial<Repository> = {};
    try {
      parsed = JSON.parse(option.value || '{}');
    } catch (error) {
      console.warn(`[RepositoryConfigService] Could not parse access token for "${repositoryId}":`, error);
      return '';
    }
    return parsed.accessToken || '';
  }

  /**
   * `Repository.accessToken` is always masked behind `DUMMY_ACCESS_TOKEN`
   * once a repository is persisted, so a freshly-loaded repository's token
   * isn't directly usable against GitHub. Resolve the real token: use it
   * as-is if the caller just typed a new one (not the masked sentinel),
   * look up the stored value for an existing, untouched repository, or fall
   * back to unauthenticated (empty) for a brand-new draft repository that
   * hasn't been saved yet.
   */
  async resolveAccessToken(repository: Repository): Promise<string> {
    if (repository.accessToken && repository.accessToken !== DUMMY_ACCESS_TOKEN) {
      return repository.accessToken;
    }
    if (repository.accessToken === DUMMY_ACCESS_TOKEN && repository.id && !repository.id.startsWith('temp-')) {
      return this.getRepositoryAccessToken(repository.id);
    }
    return '';
  }

  /**
   * Reads the "Expert mode" preference, defaulting to `false` — both when
   * never set (a fresh tenant option category has nothing to `detail()`,
   * i.e. a 404) and on any other read failure, so a transient error can
   * never silently leave the UI stuck in expert mode.
   */
  async getExpertMode(): Promise<boolean> {
    try {
      const { data } = await this.tenantOptionsService.detail({
        category: SETTINGS_OPTION_CATEGORY,
        key: EXPERT_MODE_OPTION_KEY
      });
      return data.value === 'true';
    } catch {
      return false;
    }
  }

  /** Persists the "Expert mode" preference as a tenant option (same storage as repository config/PAT, not `localStorage`). */
  async setExpertMode(expertMode: boolean): Promise<void> {
    try {
      await this.tenantOptionsService.create({
        category: SETTINGS_OPTION_CATEGORY,
        key: EXPERT_MODE_OPTION_KEY,
        value: String(expertMode)
      });
    } catch (error) {
      throw new RepositoryError(
        'Failed to save expert mode setting',
        gettext('Failed to save the Expert mode setting. Please try again.'),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Reads the "use backend service" preference, defaulting to `true` — both
   * when never set and on any read failure, so a transient error doesn't
   * silently strand the app in browser-only mode on an otherwise-working
   * backend.
   */
  async getUseBackendServiceEnabled(): Promise<boolean> {
    try {
      const { data } = await this.tenantOptionsService.detail({
        category: SETTINGS_OPTION_CATEGORY,
        key: USE_BACKEND_SERVICE_OPTION_KEY
      });
      return data.value !== 'false';
    } catch {
      return true;
    }
  }

  /** Persists the "use backend service" preference as a tenant option. */
  async setUseBackendServiceEnabled(enabled: boolean): Promise<void> {
    try {
      await this.tenantOptionsService.create({
        category: SETTINGS_OPTION_CATEGORY,
        key: USE_BACKEND_SERVICE_OPTION_KEY,
        value: String(enabled)
      });
    } catch (error) {
      throw new RepositoryError(
        'Failed to save backend service setting',
        gettext('Failed to save the backend service setting. Please try again.'),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Lists repository tenant options for `REPOSITORY_OPTION_CATEGORY`.
   *
   * Deliberately does NOT use `TenantOptionsService.list()` — that maps to
   * the generic `GET /tenant/options`, which is not filterable by category
   * (an unsupported `category` query param is silently ignored), so it would
   * return every tenant option across every category, not just this app's.
   * Instead this calls the category-scoped `GET /tenant/options/{category}`
   * directly, matching what `tenant.tenant_options.get_all(category=...)`
   * already does server-side in `analytics-service/c8y_agent.py`. That
   * endpoint returns a flat `{ key: value }` map, not a list of entities.
   */
  private async listRepositoryOptions(): Promise<ITenantOption[]> {
    try {
      const response = await this.fetchClient.fetch(
        `tenant/options/${encodeURIComponent(REPOSITORY_OPTION_CATEGORY)}`,
        {
          headers: { accept: 'application/json' },
          method: 'GET'
        }
      );

      if (response.status === 404) {
        // No repositories saved for this tenant yet — not a failure.
        return [];
      }

      if (!response.ok) {
        throw new RepositoryError(
          `Failed to list repository options: ${response.status}`,
          gettext('Failed to load repositories. Please check your permissions.'),
          undefined,
          response.status
        );
      }

      const valuesByKey = (await response.json()) as Record<string, string>;
      return Object.entries(valuesByKey).map(([key, value]) => ({
        category: REPOSITORY_OPTION_CATEGORY,
        key,
        value
      }));
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to list repository options',
        gettext('Failed to connect. Please check your connection.'),
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Parses a raw tenant option into a `Repository`, masking a non-empty
   * access token behind `DUMMY_ACCESS_TOKEN` — mirrors the microservice's
   * own masking-on-read behavior so the real secret is never re-displayed
   * in the "Manage repositories" form after it has been saved once.
   *
   * Returns `null` for anything under this category that doesn't actually
   * look like a repository entry (not valid JSON, or missing `url`) — e.g.
   * unrelated/leftover tenant options that happen to share this category on
   * a shared tenant — instead of surfacing it as a blank "ghost" repository.
   */
  private parseRepositoryOption(option: ITenantOption): Repository | null {
    let parsed: Partial<Repository> = {};
    try {
      parsed = JSON.parse(option.value || '{}');
    } catch (error) {
      console.warn(`[RepositoryConfigService] Skipping option "${option.key}" — not valid JSON:`, error);
      return null;
    }

    if (!parsed.url) {
      console.warn(`[RepositoryConfigService] Skipping option "${option.key}" — not a repository entry (no "url").`);
      return null;
    }

    return {
      id: option.key,
      name: parsed.name || '',
      url: parsed.url,
      accessToken: parsed.accessToken ? DUMMY_ACCESS_TOKEN : '',
      enabled: !!parsed.enabled
    };
  }

  /**
   * Saves a single repository as a tenant option. If `accessToken` is still
   * the `DUMMY_ACCESS_TOKEN` placeholder (i.e. the user didn't touch the PAT
   * field), the previously stored token is preserved — unless the URL
   * changed, in which case the token is cleared, exactly like
   * `_save_repository` does server-side.
   */
  private async saveRepositoryOption(
    repo: Repository,
    existingOption?: ITenantOption
  ): Promise<void> {
    let existingData: Partial<Repository> = {};
    if (existingOption) {
      try {
        existingData = JSON.parse(existingOption.value || '{}');
      } catch (error) {
        console.warn(`[RepositoryConfigService] Could not parse existing option "${existingOption.key}":`, error);
      }
    }

    const isDummyToken = repo.accessToken === DUMMY_ACCESS_TOKEN;
    const urlChanged = existingData.url !== undefined && existingData.url !== repo.url;

    let accessToken = '';
    if (!isDummyToken) {
      accessToken = repo.accessToken || '';
    } else if (!urlChanged) {
      accessToken = existingData.accessToken || '';
    }

    const value: Record<string, unknown> = {
      name: repo.name,
      url: repo.url,
      enabled: !!repo.enabled
    };
    if (accessToken) {
      value['accessToken'] = accessToken;
    }

    await this.tenantOptionsService.create({
      category: REPOSITORY_OPTION_CATEGORY,
      key: repo.id,
      value: JSON.stringify(value)
    });
  }
}
