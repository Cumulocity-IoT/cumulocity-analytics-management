import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/**
 * Translates user-facing messages that contain dynamic values.
 *
 * Follows the Cumulocity UI convention: the message key is a static string
 * wrapped in `gettext()` (so it is extracted for translation) and dynamic
 * values are passed as `{{placeholder}}` parameters, never via template
 * literals.
 *
 * ```ts
 * this.messages.format(gettext('Failed to delete "{{extensionName}}".'), { extensionName });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class MessageService {
  private readonly translate = inject(TranslateService, { optional: true });

  format(key: string, params: Record<string, unknown> = {}): string {
    if (this.translate) {
      return this.translate.instant(key, params);
    }
    return key.replace(/{{\s*(\w+)\s*}}/g, (_, p) => String(params[p] ?? ''));
  }
}
