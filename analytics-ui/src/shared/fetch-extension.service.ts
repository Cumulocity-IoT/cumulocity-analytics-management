import { Injectable } from '@angular/core';
import { EventService, IdentityService, IEvent } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import { CepError } from './cep-error';
import { uuidCustom } from './utils';

export const FETCH_EXTENSION_EVENT_TYPE = 'c8y_FetchExtension';
export const FETCH_EXTENSION_PROXY_EXTERNAL_ID_TYPE = 'c8y_Serial';
export const FETCH_EXTENSION_PROXY_EXTERNAL_ID_VALUE = 'c8y_FetchUploadProxy';

export interface FetchExtensionRequest {
  requestId: string;
  url: string;
  name: string;
}

/**
 * Sends the `c8y_FetchExtension` event described in
 * docs/features/block-marketplace/DIRECT_UPLOAD.md against the
 * `c8y_FetchUploadProxy` managed object as its `source`.
 *
 * IMPORTANT — this does not (yet) deploy anything. As of this writing,
 * `repository/epl/FetchExtensionListener.mon` only resolves/creates that
 * proxy managed object and logs the events it receives (DIRECT_UPLOAD.md's
 * R1/R2 — binary transport between two HttpTransport connections, EPL's
 * memory model for multi-megabyte payloads — are still open). This service
 * exists to exercise the event pipeline end to end while that's being
 * worked out, not as a working alternative to the existing browser
 * download-and-upload flow (`ReleaseDeployWizardComponent`).
 */
@Injectable({ providedIn: 'root' })
export class FetchExtensionService {
  constructor(
    private readonly identityService: IdentityService,
    private readonly eventService: EventService,
    private readonly alertService: AlertService
  ) {}

  /**
   * Resolves the `c8y_FetchUploadProxy` managed object's id — the event
   * `source` a `c8y_FetchExtension` event must carry (DIRECT_UPLOAD.md Q1).
   *
   * Deliberately does NOT create the managed object if it's missing — per
   * Q1's resolution, that bootstrap is `FetchExtensionListener.mon`'s own
   * responsibility on load; duplicating it here could race with it and
   * create two proxy objects. A 404 here means that EPL app hasn't run on
   * this tenant yet, which is a deployment problem for the user to fix, not
   * something the UI should silently paper over.
   */
  async resolveProxySourceId(): Promise<string> {
    try {
      const { data } = await this.identityService.detail({
        type: FETCH_EXTENSION_PROXY_EXTERNAL_ID_TYPE,
        externalId: FETCH_EXTENSION_PROXY_EXTERNAL_ID_VALUE
      });
      const managedObjectId = data.managedObject?.id;
      if (!managedObjectId) {
        throw new CepError(
          'c8y_FetchUploadProxy external id resolved but has no managedObject reference',
          gettext('The fetch/upload proxy is misconfigured on this tenant. Check the FetchExtensionListener EPL app.')
        );
      }
      return String(managedObjectId);
    } catch (error: any) {
      if (error instanceof CepError) {
        throw this.handleError(error, 'Failed to resolve proxy managed object', true, error.userMessage);
      }
      if (error?.res?.status === 404 || error?.status === 404) {
        throw this.handleError(
          error,
          'c8y_FetchUploadProxy external id not found',
          true,
          gettext(
            'The FetchExtensionListener EPL app has not run on this tenant yet (no c8y_FetchUploadProxy ' +
            'managed object found). Deploy/start it under Streaming Analytics > EPL apps first.'
          )
        );
      }
      throw this.handleError(
        error,
        'Failed to resolve proxy managed object',
        true,
        gettext('Could not resolve the fetch/upload proxy. Please try again.')
      );
    }
  }

  /**
   * Resolves the proxy source and sends the `c8y_FetchExtension` event.
   * See the class doc comment — this does not yet result in an actual
   * extension deploy.
   *
   * `accessToken`, if given (a GitHub PAT for a private repository — see
   * `RepositoryService.getRepositoryAccessToken()`), is sent as an
   * `Authorization: Bearer` header inside the event's `c8y_FetchExtension`
   * fragment. **Accepted risk, not an oversight** (see DIRECT_UPLOAD.md Q2):
   * this puts the token in plaintext in Cumulocity's event history, readable
   * by anyone with event-read permission on the `c8y_FetchUploadProxy`
   * source, with no built-in expiry/rotation — a deliberate choice made in
   * place of the alternative (Tenant Options, no secret in the event at
   * all). Omit `accessToken` for public repositories.
   */
  async sendFetchExtensionEvent(url: string, name: string, accessToken?: string): Promise<FetchExtensionRequest> {
    const sourceId = await this.resolveProxySourceId();
    const requestId = uuidCustom();

    const event: IEvent = {
      source: { id: sourceId },
      type: FETCH_EXTENSION_EVENT_TYPE,
      time: new Date().toISOString(),
      text: `Deploy extension from GitHub Release: ${name}`,
      c8y_FetchExtension: {
        requestId,
        url,
        name,
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
      }
    };

    try {
      await this.eventService.create(event);
      return { requestId, url, name };
    } catch (error) {
      throw this.handleError(
        error,
        `Failed to send ${FETCH_EXTENSION_EVENT_TYPE} event for ${name}`,
        true,
        gettext(`Could not send the fetch request for "${name}". Please try again.`)
      );
    }
  }

  private handleError(
    error: unknown,
    logMessage: string,
    showAlert: boolean,
    userMessage: string
  ): Error {
    console.error(`[FetchExtensionService] ${logMessage}:`, error);

    if (showAlert) {
      this.alertService.danger(userMessage);
    }

    if (error instanceof CepError) {
      return error;
    }

    return new CepError(logMessage, userMessage, error instanceof Error ? error : undefined);
  }
}
