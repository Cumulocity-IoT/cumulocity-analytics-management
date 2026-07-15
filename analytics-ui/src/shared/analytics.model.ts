import { uuidCustom } from './utils';

export interface ApplicationState {
  label: string;
  class: string;
}

export enum Wizards {
  APPLICATION_UPLOAD = 'applicationUpload',
  MICROSERVICE_UPLOAD = 'microserviceUpload',
  RELEASE_DEPLOY = 'deployFromGitHubRelease'
}

export enum ERROR_TYPE {
  TYPE_VALIDATION = 'TYPE_VALIDATION',
  ALREADY_SUBSCRIBED = 'ALREADY_SUBSCRIBED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NO_MANIFEST_FILE = 'NO_MANIFEST_FILE',
  INVALID_PACKAGE = 'INVALID_PACKAGE',
  INVALID_APPLICATION = 'INVALID_APPLICATION'
}

export enum Category {
  INPUT = 'INPUT',
  OUTPUT = 'OUTPUT',
  LOGIC = 'LOGIC',
  CALCULATION = 'CALCULATION',
  AGGREGATE = 'AGGREGATE',
  FLOW_MANIPULATION = 'FLOW_MANIPULATION',
  UTILITY = 'UTILITY'
}

export interface CepExtensionsMetadata {
  metadatas: string[];
  messages: string[];
}

export interface CepExtension {
  name: string;
  analytics: CepBlock[];
  version: string;
  loaded: true;
  extensionType?: ExtensionType;
}

export interface CepBlock {
  id: string;
  name: string;
  file: string;
  type: string;
  installed?: boolean;
  producesOutput?: string;
  description?: string;
  url: string;
  downloadUrl: string;
  path?: string;
  custom: boolean;
  extension?: string;
  resultingExtension?: string;
  // Only populated for repository-sourced blocks; deployed blocks read back from
  // the CEP correlator have no originating repository, so these stay undefined.
  repositoryName?: string;
  repositoryId?: string;
  category?: Category;
}

/**
 * Raw block payload as returned by the CEP correlator
 * (`service/cep/apamacorrelator/en/<extension>.json` → `analytics[]`).
 * Every field is optional/untrusted; `addBlockMetadata` normalizes it into a
 * {@link CepBlock}.
 */
export interface RawCepBlock {
  id?: string;
  name?: string;
  file?: string;
  type?: string;
  installed?: boolean;
  producesOutput?: string;
  description?: string;
  url?: string;
  downloadUrl?: string;
  path?: string;
  resultingExtension?: string;
  category?: Category;
}


export interface RepositoryItem {
  id: string;
  name: string;
  path?: string;
  url: string;
  downloadUrl: string;
  type: string;
  file: string;
  repositoryName: string;
  repositoryId: string;
  installed?: boolean;
  extensionsYamlItem?: RepositoryItem;
  /**
   * All fully-qualified block names this item's file defines (see
   * `extractBlockFqns`). A `.mon` file can define more than one block, so
   * "installed" status is decided against this whole set, not just `id`
   * (which holds just the first one, for display/identification).
   */
  blockIds?: string[];
}

export interface Repository {
  id: string;
  name: string;
  url: string;
  accessToken: string;
  enabled: boolean;
}

export interface RepositoryTestResult {
  success: boolean;
  message?: string;
  status?: number;
}

/**
 * A single asset (file) attached to a GitHub Release, e.g. a pre-built
 * extension zip such as `Abs-1.0.1.zip`.
 */
export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  browserDownloadUrl: string;
  contentType: string;
}

/**
 * A GitHub Release (`GET /repos/{owner}/{repo}/releases`), with its attached
 * assets already embedded — no separate "list assets" call is needed.
 */
export interface GitHubRelease {
  id: number;
  tagName: string;
  name: string;
  publishedAt: string;
  assets: GitHubReleaseAsset[];
}

export const CEP_PATH_BASE = 'service/cep';
export const CEP_PATH_CORRELATOR = `${CEP_PATH_BASE}/apamacorrelator`;
export const CEP_PATH_EN = `${CEP_PATH_CORRELATOR}/en`;
export const CEP_PATH_METADATA_EN = `${CEP_PATH_CORRELATOR}/en/block-metadata.json`;
export const CEP_PATH_DIAGNOSTICS = `${CEP_PATH_BASE}/diagnostics`;
export const CEP_PATH_DIAGNOSTICS_EXTENSION_NAMES = `${CEP_PATH_BASE}/diagnostics/extensionNames`;
export const CEP_PATH_STATUS = `${CEP_PATH_DIAGNOSTICS}/apamaCtrlStatus`;

export const BACKEND_PATH_BASE = 'service/analytics-ext-service';
export const EXTENSION_ENDPOINT = 'extension';
export const CEP_ENDPOINT = 'cep';
export const REPOSITORY_CONTENT_ENDPOINT = 'repository/content';
export const REPOSITORY_CONTENT_LIST_ENDPOINT = 'repository/contentList';
export const REPOSITORY_CONFIGURATION_ENDPOINT = 'repository/configuration';
export const APPLICATION_ANALYTICS_BUILDER_SERVICE = 'analytics-ext-service';
export const ANALYTICS_REPOSITORIES_TYPE = 'c8y_CEP_repository';

/**
 * Tenant option category repository config is stored under, read/written
 * directly via `@c8y/client`'s `TenantOptionsService` (no backend proxy).
 * Must match `analytics-service/c8y_agent.py`'s `CATEGORY` constant so that
 * repos created by either the microservice or the browser stay interoperable.
 */
export const REPOSITORY_OPTION_CATEGORY = 'analytics-management.repository';

/**
 * Placeholder shown for an already-set access token instead of the real
 * secret. Must match `analytics-service/c8y_agent.py`'s `DUMMY_ACCESS_TOKEN`.
 * On save, a repository whose `accessToken` still equals this sentinel is
 * treated as "unchanged" and the previously stored token is kept as-is.
 */
export const DUMMY_ACCESS_TOKEN = '_DUMMY_ACCESS_CODE_';

export const STATUS_MESSAGE_01 = 'Recording apama-ctrl safe mode state';
export const STATUS_MESSAGE_02 = 'Deployment was changed';

export const CEP_METADATA_FILE_EXTENSION_1 = '.json';
export const CEP_METADATA_FILE_EXTENSION_2 = '.zip';
export const GITHUB_BASE = 'https://api.github.com';
export const REPO_OWNER = 'Cumulocity-IoT';
export const REPO_BLOCKSDK = `${GITHUB_BASE}/repos/${REPO_OWNER}/apama-analytics-builder-block-sdk/contents/samples/blocks`;
export const REPO_CONTRIB_BLOCK = `${GITHUB_BASE}/repos/${REPO_OWNER}/analytics-builder-blocks-contrib/contents/blocks`;
export const REPO_CONTRIB_CUMULOCITY = `${GITHUB_BASE}/repos/${REPO_OWNER}/analytics-builder-blocks-contrib/contents/cumulocity-blocks`;
export const REPO_CONTRIB_SIMULATION = `${GITHUB_BASE}/repos/${REPO_OWNER}/analytics-builder-blocks-contrib/contents/simulation-blocks`;
export const REPO_ANALYTICS_MANAGEMENT = `${GITHUB_BASE}/repos/${REPO_OWNER}/cumulocity-analytics-management/contents/repository/blocks`;
export const REPO_SAMPLES = [
  {
    id: uuidCustom(),
    name: 'Block SDK Quick Start Samples',
    url: REPO_ANALYTICS_MANAGEMENT,
    enabled: true
  },
  {
    id: uuidCustom(),
    name: 'Block SDK Samples',
    url: REPO_BLOCKSDK,
    enabled: true
  },
  {
    id: uuidCustom(),
    name: 'Contrib Samples Block',
    url: REPO_CONTRIB_BLOCK,
    enabled: false
  },
  {
    id: uuidCustom(),
    name: 'Contrib Samples Simulation-Block',
    url: REPO_CONTRIB_SIMULATION,
    enabled: false
  },
  {
    id: uuidCustom(),
    name: 'Contrib Samples Cumulocity-Block',
    url: REPO_CONTRIB_CUMULOCITY,
    enabled: false
  }
] as Repository[];


export const DESCRIPTOR_YAML = "extensions.yaml";


export type CepEngineStatus = 'loading' | 'loaded' | 'empty' | 'loadingError' | 'started' | 'down' | 'up' | 'unknown';

export type ExtensionType = 'block' | 'zip';

/**
 * Status payload for the CEP/Apama engine. Sourced either from the backend
 * microservice (`.../cep/status`) or, when it is unavailable, directly from the
 * CEP correlator diagnostics (`CEP_PATH_STATUS`). Only the fields the UI relies
 * on are typed; the index signature keeps the remaining diagnostic fields
 * accessible (e.g. the engine-monitoring view iterates all keys).
 */
export interface CepStatusObject {
  status?: string;
  is_safe_mode?: boolean;
  microservice_name?: string;
  microservice_application_id?: string;
  number_extensions?: number;
  // Remaining diagnostic fields are untyped; the engine-monitoring view iterates
  // and renders them generically.
  [key: string]: any;
}

export type UploadMode = 'add' | 'update';