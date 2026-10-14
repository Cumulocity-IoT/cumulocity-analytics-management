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
