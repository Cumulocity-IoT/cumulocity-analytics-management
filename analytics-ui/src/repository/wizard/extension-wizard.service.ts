import { Injectable, inject } from '@angular/core';
import { BottomDrawerService } from '@c8y/ngx-components';
import { Observable, map, take } from 'rxjs';
import { ExtensionWizardComponent, WizardSource } from './extension-wizard.component';

/** What the wizard starts with. */
export interface ExtensionWizardOptions {
  /** Skips the first step when the caller already knows the path. */
  source?: WizardSource;
  /** With `selectedIds`: a build from this repository, starting at the name step. */
  repositoryId?: string;
  /** Ids of the repository items the user has already ticked. */
  selectedIds?: string[];
}

/** Opens the "Add extension" wizard in a bottom drawer. */
@Injectable({ providedIn: 'root' })
export class ExtensionWizardService {
  private readonly drawerService = inject(BottomDrawerService);

  /**
   * @param options what to start with; a plain source skips the first step
   * @returns emits once when the drawer closes: `true` if an extension was added.
   */
  open(options?: WizardSource | ExtensionWizardOptions): Observable<boolean> {
    const { source, repositoryId, selectedIds }: ExtensionWizardOptions =
      typeof options === 'string' ? { source: options } : (options ?? {});
    const ref = this.drawerService.openDrawer(ExtensionWizardComponent, {
      initialState: {
        initialSource: source ?? null,
        initialRepositoryId: repositoryId ?? null,
        initialSelectedIds: selectedIds ?? []
      },
      closeOnNavigation: true
    });
    return ref.onClosed$.pipe(
      take(1),
      map(() => ref.instance.added)
    );
  }
}
