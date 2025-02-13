import { uuidCustom } from './utils';

export interface ApplicationState {
  label: string;
  class: string;
}

export enum Wizards {
  APPLICATION_UPLOAD = 'applicationUpload',
  MICROSERVICE_UPLOAD = 'microserviceUpload'
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

export interface CEP_ExtensionsMetadata {
  metadatas: string[];
  messages: string[];
}

export interface CEP_Extension {
  name: string;
  analytics: CEP_Block[];
  version: string;
  loaded: true;
}

export interface CEP_Block {
  id: string;
  name: string;
  installed?: boolean;
  producesOutput?: string;
  description?: string;
  url: string;
  downloadUrl: string;
  path?: string;
  custom: boolean;
  extension?: string;
  repositoryName: string;
  repositoryId: string;
  category?: Category;
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

export const CEP_PATH_BASE = 'service/cep';
export const CEP_PATH_CORRELATOR = `${CEP_PATH_BASE}/apamacorrelator`;
export const CEP_PATH_EN = `${CEP_PATH_CORRELATOR}/en`;
export const CEP_PATH_METADATA_EN = `${CEP_PATH_CORRELATOR}/en/block-metadata.json`;
export const CEP_PATH_DIAGNOSTICS = `${CEP_PATH_BASE}/diagnostics`;
export const CEP_PATH_STATUS = `${CEP_PATH_DIAGNOSTICS}/apamaCtrlStatus`;

export const BACKEND_PATH_BASE = 'service/analytics-ext-service';
export const EXTENSION_ENDPOINT = 'extension';
export const CEP_ENDPOINT = 'cep';
export const REPOSITORY_CONTENT_ENDPOINT = 'repository/content';
export const REPOSITORY_CONTENT_LIST_ENDPOINT = 'repository/contentList';
export const REPOSITORY_CONFIGURATION_ENDPOINT = 'repository/configuration';
export const APPLICATION_ANALYTICS_BUILDER_SERVICE = 'analytics-ext-service';
export const ANALYTICS_REPOSITORIES_TYPE = 'c8y_CEP_repository';

export const STATUS_MESSAGE_01 = 'Recording apama-ctrl safe mode state';
export const STATUS_MESSAGE_02 = 'Deployment was changed';

export const CEP_METADATA_FILE_EXTENSION = '.json';
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


export type CEPEngineStatus = 'loading' | 'loaded' | 'empty' | 'loadingError' | 'started' | 'down' | 'up' | 'unknown';

export type CEPStatusObject = any;

export type UploadMode = 'add' | 'update';