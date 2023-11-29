export interface ApplicationState {
  label: string;
  class: string;
}

/** Wizard types  */
export enum Wizards {
  APPLICATION_UPLOAD = "applicationUpload",
  MICROSERVICE_UPLOAD = "microserviceUpload",
}

export enum ERROR_TYPE {
  TYPE_VALIDATION = "TYPE_VALIDATION",
  ALREADY_SUBSCRIBED = "ALREADY_SUBSCRIBED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
  NO_MANIFEST_FILE = "NO_MANIFEST_FILE",
  INVALID_PACKAGE = "INVALID_PACKAGE",
  INVALID_APPLICATION = "INVALID_APPLICATION",
}

export interface ApplicationPlugin {
  id: string;
  name?: string;
  module: string;
  path: string;
  description?: string;
  version?: string;
  scope?: string;
  installed?: boolean;
  contextPath?: string;
}

/** Wizard types  */
export enum Category {
  INPUT = "INPUT",
  OUPUT = "OUTPUT",
  LOGIC = "LOGIC",
  CALCULATION = "CALCULATION",
  AGGREGATE = "AGGREGATE",
  FLOW_MANIPULATION = "FLOW_MANIPULATION",
  UTILITY = "UTILITY",
}

// export interface Block {
//   name: string;
//   custom: boolean;
//   category: Category;
// }

export interface CEP_Metadata {
  metadatas: string[];
  messages: string[];
}

export interface CEP_Extension {
  analytics: CEP_Block[];
  version: string;
}

export interface CEP_Block {
  id: string;
  name: string;
  producesOutput: string;
  description: string;
  url: string;
  downloadUrl: string;
  path: string;
  custom: boolean;
  extension: string;
  repositoryName: string;
  category: Category;
}

export interface Repository {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export const PATH_CEP_BASE = "service/cep";
export const PATH_CEP_CORRELATOR = `${PATH_CEP_BASE}/apamacorrelator`;
export const PATH_CEP_EN = `${PATH_CEP_CORRELATOR}/EN`;
export const PATH_CEP_METADATA_EN = `${PATH_CEP_CORRELATOR}/EN/block-metadata.json`;
export const PATH_CEP_DIAGNOSTICS = `${PATH_CEP_BASE}/diagnostics`;
export const PATH_CEP_STATUS = `${PATH_CEP_DIAGNOSTICS}/apamaCtrlStatus`;

export const STATUS_MESSAGE_01 = "Recording apama-ctrl safe mode state";

export const GITHUB_BASE = "https://api.github.com";
export const REPO_SAMPLES_OWNER = "SoftwareAG";
export const REPO_SAMPLES_BLOCKSDK = `${GITHUB_BASE}/repos/${REPO_SAMPLES_OWNER}/apama-analytics-builder-block-sdk/contents/samples/blocks`;
export const REPO_SAMPLES_CONTRIB_BLOCK = `${GITHUB_BASE}/repos/${REPO_SAMPLES_OWNER}/analytics-builder-blocks-contrib/contents/blocks`;
export const REPO_SAMPLES_CONTRIB_CUMULOCITY = `${GITHUB_BASE}/repos/${REPO_SAMPLES_OWNER}/analytics-builder-blocks-contrib/contents/cumulocity-blocks`;
export const REPO_SAMPLES_CONTRIB_SIMULATION = `${GITHUB_BASE}/repos/${REPO_SAMPLES_OWNER}/analytics-builder-blocks-contrib/contents/simulation-blocks`;

export const BASE_URL = "service/analytics-ext-service";
export const ENDPOINT_EXTENSION = "extension";
export const ANALYTICS_REPOSITORIES_TYPE = "c8y_CEP_repository";

export function uuidCustom(): string {
  let id = Math.random().toString(36).slice(-6);
  return id;
}

// https://api.github.com/repos/SoftwareAG/apama-analytics-builder-block-sdk/contents/samples
// http://localhost:9000/cep/apamacorrelator/EN/block-metadata.json
// http://localhost:9000/service/cep/apamacorrelator/EN/core.json
