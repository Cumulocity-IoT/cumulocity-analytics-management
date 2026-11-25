import { Injectable, inject } from '@angular/core';
import { BottomDrawerService } from '@c8y/ngx-components';
import { Observable, map, take } from 'rxjs';
import { ExtensionWizardComponent, WizardSource } from './extension-wizard.component';

/** Opens the "Add extension" wizard in a bottom drawer. */
@Injectable({ providedIn: 'root' })
export class ExtensionWizardService {
  private readonly drawerService = inject(BottomDrawerService);

  /**
   * @param initialSource skips the first step when the caller already knows the path.
   * @returns emits once when the drawer closes: `true` if an extension was added.
   */
  open(initialSource?: WizardSource): Observable<boolean> {
    const ref = this.drawerService.openDrawer(ExtensionWizardComponent, {
      initialState: { initialSource: initialSource ?? null },
      closeOnNavigation: true
    });
    return ref.onClosed$.pipe(
      take(1),
      map(() => ref.instance.added)
    );
  }
}
