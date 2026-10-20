import { gettext } from '@c8y/ngx-components/gettext';
import { ErrorType } from './analytics.model';

export const ERROR_MESSAGES = {
  [ErrorType.TYPE_VALIDATION]: gettext(
    'Wrong file format. Expected a *.zip file with a valid manifest.'
  ),
  [ErrorType.ALREADY_SUBSCRIBED]: gettext(
    'Could not subscribe to the microservice because another application with the same context path is already subscribed.'
  ),
  [ErrorType.NO_MANIFEST_FILE]: gettext('Could not find a manifest.'),
  [ErrorType.INVALID_PACKAGE]: gettext(
    'You have not uploaded a valid package.'
  ),
  [ErrorType.INVALID_APPLICATION]: gettext(
    'You have not uploaded a valid application.'
  ),
  [ErrorType.INTERNAL_ERROR]: gettext(
    'An internal error occurred, try to upload again.'
  )
};

/** Root path of all pages contributed by this plugin. */
export const ROUTE_ROOT = 'c8y-pkg-analytics-extension';

/** Route paths. Labels for the same pages: `PAGE_LABELS`. */
export const ROUTES = {
  manage: `${ROUTE_ROOT}/manage`,
  installedBlocks: `${ROUTE_ROOT}/installed-blocks`,
  repository: `${ROUTE_ROOT}/repository`,
  monitoring: `${ROUTE_ROOT}/monitoring`,
  release: `${ROUTE_ROOT}/release`
};

/**
 * One name per page, used for the tab, the page title and the breadcrumb.
 * Defined with `gettext()` so the strings are extracted for translation;
 * templates translate them with the `translate` pipe.
 */
export const PAGE_LABELS = {
  extensions: gettext('Extensions'),
  installedBlocks: gettext('Installed blocks'),
  repositories: gettext('Repositories'),
  monitoring: gettext('Monitoring')
};
