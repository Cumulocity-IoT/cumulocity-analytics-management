import { Injectable } from '@angular/core';
import { FetchClient, IFetchResponse } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import {
  BACKEND_PATH_BASE,
  EXTENSION_ENDPOINT,
  Repository,
  REPOSITORY_CONTENT_ENDPOINT,
  REPOSITORY_CONTENT_LIST_ENDPOINT,
  RepositoryItem,
  RepositoryTestResult
} from './analytics.model';
import { extractErrorMessage, RepositoryError } from './repository-error';

interface CreateExtensionRequest {
  extension_name: string;
  upload: boolean;
  deploy: boolean;
  repository: Repository;
  rebuild: boolean;
}

interface CreateExtensionFromListRequest extends CreateExtensionRequest {
  monitors: RepositoryItem[];
}

interface CreateExtensionFromYamlRequest extends CreateExtensionRequest {
  yaml: RepositoryItem;
  sections: string[];
}

/**
 * Backend-proxied implementation of repository test/list/content-fetch/
 * extension-build — everything here calls `analytics-service`. See
 * `RepositoryModeService` for how callers decide whether to use this or
 * `GitHubContentService`/`ExtensionBuilderService`.
 */
@Injectable({
  providedIn: 'root'
})
export class RepositoryBackendService {
  constructor(
    private readonly fetchClient: FetchClient,
    private readonly alertService: AlertService
  ) {}

  async testRepository(repository: Repository): Promise<RepositoryTestResult> {
    // The PAT is passed in a custom header (not a query param) so it doesn't
    // land in HTTP access logs or browser history.
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (repository.accessToken) {
        headers['X-Repository-Access-Token'] = repository.accessToken;
      }

      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONTENT_LIST_ENDPOINT}`,
        {
          headers,
          params: {
            url: encodeURIComponent(repository.url),
            repository_id: repository.id
          },
          method: 'GET'
        }
      );

      if (response.ok) {
        return {
          success: true,
          message: gettext('Successfully connected to repository'),
          status: response.status
        };
      }
      const backendMessage = await extractErrorMessage(response);
      return {
        success: false,
        status: response.status,
        message: backendMessage || this.mapTestStatusToResult(response.status).message
      };
    } catch (error) {
      return this.handleTestError();
    }
  }

  async getContent(repository: Repository): Promise<any[]> {
    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${REPOSITORY_CONTENT_LIST_ENDPOINT}`,
        {
          headers: { 'content-type': 'application/json' },
          params: {
            url: encodeURIComponent(repository.url),
            repository_id: repository.id
          },
          method: 'GET'
        }
      );

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
        gettext('Failed to connect to server. Please check your connection.'),
        error instanceof Error ? error : undefined
      );
    }
  }

  getItemContent(block: RepositoryItem, extractFQN: boolean): Promise<string> {
    return this.fetchClient.fetch(
      `${BACKEND_PATH_BASE}/${REPOSITORY_CONTENT_ENDPOINT}`,
      {
        headers: { 'content-type': 'text/plain' },
        params: {
          url: encodeURIComponent(block.url),
          extract_fqn_cep_block: extractFQN.toString(),
          repository_id: block.repositoryId,
          cep_block_name: block.name
        },
        method: 'GET'
      }
    ).then(resp => {
      if (!resp.ok) {
        throw new RepositoryError(
          `Failed to fetch content: ${resp.status}`,
          gettext('Failed to load content from server.')
        );
      }
      return resp.text();
    });
  }

  async createExtensionFromList(
    name: string,
    monitors: RepositoryItem[],
    repository: Repository,
    upload: boolean,
    deploy: boolean,
    rebuild: boolean
  ): Promise<IFetchResponse> {
    const request: CreateExtensionFromListRequest = {
      extension_name: name,
      monitors,
      repository,
      upload,
      deploy,
      rebuild
    };

    try {
      return await this.createExtension('list', request);
    } catch (error) {
      throw this.handleCreateExtensionError(error, `Failed to create extension from list: ${name}`, name);
    }
  }

  async createExtensionFromYaml(
    name: string,
    yaml: RepositoryItem,
    sections: string[],
    repository: Repository,
    upload: boolean,
    deploy: boolean,
    rebuild: boolean
  ): Promise<IFetchResponse> {
    const request: CreateExtensionFromYamlRequest = {
      extension_name: name,
      yaml,
      sections,
      repository,
      upload,
      deploy,
      rebuild
    };

    try {
      return await this.createExtension('yaml', request);
    } catch (error) {
      throw this.handleCreateExtensionError(error, `Failed to create extension from YAML: ${name}`, name);
    }
  }

  async createExtensionFromRepository(
    name: string,
    repository: Repository,
    upload: boolean,
    deploy: boolean,
    rebuild: boolean
  ): Promise<IFetchResponse> {
    const request: CreateExtensionRequest = {
      extension_name: name,
      repository,
      upload,
      deploy,
      rebuild
    };

    try {
      return await this.createExtension('repository', request);
    } catch (error) {
      throw this.handleCreateExtensionError(error, `Failed to create extension from repository: ${name}`, name);
    }
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

  private async createExtension(endpoint: string, request: unknown): Promise<IFetchResponse> {
    if (!request || typeof request !== 'object') {
      throw new RepositoryError(
        'Invalid extension request',
        gettext('Invalid extension data provided.')
      );
    }

    try {
      const response = await this.fetchClient.fetch(
        `${BACKEND_PATH_BASE}/${EXTENSION_ENDPOINT}/${endpoint}`,
        {
          headers: {
            accept: 'application/json',
            'content-type': 'application/json'
          },
          body: JSON.stringify(request),
          method: 'POST',
          responseType: 'blob'
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new RepositoryError(
          `Failed to create extension: ${response.status}`,
          errorText || gettext('Failed to create extension on server.')
        );
      }

      return response;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to create extension',
        gettext('Failed to create extension. Please try again.'),
        error instanceof Error ? error : undefined
      );
    }
  }

  private handleCreateExtensionError(error: unknown, logMessage: string, name: string): RepositoryError {
    console.error(`[RepositoryBackendService] ${logMessage}:`, error);
    const result = error instanceof RepositoryError
      ? error
      : new RepositoryError(
          logMessage,
          gettext(`Failed to create extension "${name}". Please try again.`),
          error instanceof Error ? error : undefined
        );
    this.alertService.danger(result.userMessage);
    return result;
  }

  private handleTestError(): RepositoryTestResult {
    return {
      success: false,
      message: gettext('Failed to connect to repository. Please check your connection and try again.')
    };
  }
}
