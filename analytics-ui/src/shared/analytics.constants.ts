import { gettext } from '@c8y/ngx-components/gettext';
import { ERROR_TYPE } from './analytics.model';
import { PropertiesListItem } from '@c8y/ngx-components';

export const ERROR_MESSAGES = {
  [ERROR_TYPE.TYPE_VALIDATION]: gettext(
    'Wrong file format. Expected a *.zip file with a valid manifest.'
  ),
  [ERROR_TYPE.ALREADY_SUBSCRIBED]: gettext(
    'Could not subscribe to the microservice because another application with the same context path is already subscribed.'
  ),
  [ERROR_TYPE.NO_MANIFEST_FILE]: gettext('Could not find a manifest.'),
  [ERROR_TYPE.INVALID_PACKAGE]: gettext(
    'You have not uploaded a valid package.'
  ),
  [ERROR_TYPE.INVALID_APPLICATION]: gettext(
    'You have not uploaded a valid application.'
  ),
  [ERROR_TYPE.INTERNAL_ERROR]: gettext(
    'An internal error occurred, try to upload again.'
  )
};

export const APP_STATE = {
  SUBSCRIBED: {
    label: gettext('Subscribed`application`'),
    class: 'label-primary'
  },
  CUSTOM: {
    label: gettext('Custom`application`'),
    class: 'label-info'
  },
  EXTERNAL: {
    label: gettext('External`application`'),
    class: 'label-warning'
  },
  UNPACKED: {
    label: gettext('Unpacked`application`'),
    class: 'label-success'
  },
  PACKAGE_APP: {
    label: gettext('Application'),
    class: 'label-success'
  },
  PACKAGE_PLUGIN: {
    label: gettext('Plugins'),
    class: 'label-info'
  }
};

export const packageProperties: PropertiesListItem[] = [
  {
    label: gettext('Version'),
    key: 'version'
  },
  {
    label: gettext('Author'),
    key: 'author'
  },
  {
    label: gettext('Keywords'),
    key: 'keywords'
  },
  {
    label: gettext('Source'),
    key: 'repository',
    transform: (repository: unknown) => {
      if (repository && typeof repository === 'object') {
        const repo = repository as Record<string, unknown>;
        return repo['url'] ? repo['url'] : repository;
      }
      return repository;
    },
    type: 'link',
    action: () => {
      // Action handled by link type
    }
  } as any,
  {
    label: gettext('Homepage'),
    key: 'homepage',
    type: 'link',
    action: () => {
      // Action handled by link type
    }
  },
  {
    label: gettext('Required platform version'),
    key: 'requiredPlatformVersion'
  },
  {
    label: gettext('License'),
    key: 'license'
  }
];
