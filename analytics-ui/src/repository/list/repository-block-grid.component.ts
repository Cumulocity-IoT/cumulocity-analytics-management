import { take } from 'rxjs/operators';
import { MessageService } from '../../shared/message.service';
/*
 * Copyright (c) 2025 Cumulocity GmbH
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @authors Christof Strack
 */

import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  ViewEncapsulation,
  inject,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ActionControl,
  AlertService,
  Column,
  ColumnDataType,
  CoreModule,
  DataGridComponent
} from '@c8y/ngx-components';
import { BsModalService } from 'ngx-bootstrap/modal';
import {
  BooleanRendererComponent,
  Repository,
  RepositoryItem,
  RepositoryService,
  AnalyticsService,
  PAGE_LABELS,
  ROUTES
} from '../../shared';
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  shareReplay,
  switchMap,
  tap
} from 'rxjs';
import { catchError, of } from 'rxjs';
import { ExtensionWizardService } from '../wizard/extension-wizard.service';
import { LabelRendererComponent } from '../../shared/component/label-renderer.component';
import { RepositoriesDrawerComponent } from '../drawer/repositories-drawer.component';
import { EditorModalComponent } from '../editor/editor-modal.component';
import { ExtensionLayoutHelpModalComponent } from './extension-layout-help-modal.component';
import { PopoverModule } from 'ngx-bootstrap/popover';
import { gettext } from '@c8y/ngx-components/gettext';

/** Keeps the items whose name contains `text` (case-insensitive); empty text keeps all. */
export function filterByName(items: RepositoryItem[], text: string): RepositoryItem[] {
  const needle = (text ?? '').trim().toLowerCase();
  return needle ? items.filter(item => (item.name ?? '').toLowerCase().includes(needle)) : items;
}

@Component({
  selector: 'a17t-repository-block-grid',
  templateUrl: 'repository-block-grid.component.html',
  styleUrls: ['./repository-block-grid.component.css'],
  encapsulation: ViewEncapsulation.None,
  imports: [CommonModule, FormsModule, CoreModule, PopoverModule, RepositoriesDrawerComponent]
})
export class RepositoryBlockGridComponent implements OnInit {
  private readonly messages = inject(MessageService);
  readonly labels = PAGE_LABELS;
  readonly routes = ROUTES;

  showConfigSample: boolean = false;
  hideInstalled: boolean = false;
  // Loading items from a repository (GitHub calls, FQN extraction, deployed-
  // blocks lookup) is comparatively expensive, so it's opt-in: off by
  // default, and persisted as a tenant option (see updateMode()) — not
  // localStorage — the same way repository config/PAT is stored.
  loading: boolean = false;
  showDataGrid: boolean = true;
  showMonitorEditor: boolean = false;
  showConfigRepositories: boolean = false;

  backendDeployed: boolean = false;
  backendTogglePending: boolean = false;

  repositoryItems$!: Observable<RepositoryItem[]>;
  repositoryItems!: RepositoryItem[];

  actionControls: ActionControl[] = [];

  /** The repository name shown as a badge after the grid title; null when items come from several. */
  titleRepository: string | null = null;
  gridTitle: string = gettext('Browse blocks from repositories');
  /**
   * CSS string for the badge (`::after` of the grid title). The grid title is plain text and
   * cannot hold markup, so the repository name is drawn as a badge through a custom property.
   */
  repositoryBadge: string | null = null;

  columnsSamples: Column[] = [
    {
      name: 'File',
      header: 'File',
      path: 'name',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: true
    },
    {
      name: 'type',
      header: 'Type',
      path: 'type',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      cellRendererComponent: LabelRendererComponent,
      visible: true
    },
    {
      name: 'installed',
      header: 'Installed',
      path: 'installed',
      dataType: ColumnDataType.Icon,
      filterable: true,
      visible: true,
      cellRendererComponent: BooleanRendererComponent
    },
    {
      name: 'repositoryName',
      header: 'Repository Name',
      path: 'repositoryName',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: true
    },
    {
      name: 'repositoryId',
      header: 'Repository Id',
      path: 'repositoryId',
      dataType: ColumnDataType.TextLong,
      filterable: true,
      visible: false
    }
  ];

  private destroyRef = inject(DestroyRef);
  // The shell may run Angular without zone.js, where a plain field changed after an
  // `await` or inside a subscription is not rendered by itself.
  private readonly cdr = inject(ChangeDetectorRef);

  /** All configured repositories: any of them can be browsed. */
  repositories: Repository[] = [];
  selectedRepositoryId: string | null = null;
  private readonly selectedRepositoryId$ = new BehaviorSubject<string | null>(null);
  private readonly hideInstalled$ = new BehaviorSubject<boolean>(false);
  private readonly searchText$ = new BehaviorSubject<string>('');
  /** Free-text search over item names (case-insensitive, matches anywhere in the name). */
  searchText = '';

  constructor(
    public repositoryService: RepositoryService,
    private analyticsService: AnalyticsService,
    public alertService: AlertService,
    private bsModalService: BsModalService,
    private extensionWizard: ExtensionWizardService
  ) {
    const loaded$ = combineLatest([
      this.selectedRepositoryId$.pipe(distinctUntilChanged()),
      this.hideInstalled$
    ]).pipe(
      switchMap(([repositoryId, hideInstalled]) =>
        repositoryId
          ? this.repositoryService
              .getRepositoryItemsAnalyzedFor(repositoryId)
              .pipe(map(items => (hideInstalled ? items.filter(item => !item.installed) : items)))
          : of([] as RepositoryItem[])
      ),
      shareReplay(1),
      tap(items => {
        // With a single source repository the name is the same on every row:
        // show it in the title and hide the column instead.
        const repoNames = [...new Set(items.map(item => item.repositoryName))];
        const singleRepo = repoNames.length === 1 && !!repoNames[0];
        this.titleRepository = singleRepo ? repoNames[0] : null;
        this.gridTitle = this.titleRepository
          ? gettext('Browse blocks from')
          : gettext('Browse blocks from repositories');
        this.repositoryBadge = this.titleRepository
          ? `"${this.titleRepository.replace(/[\\"]/g, '\\$&').replace(/[\r\n]+/g, ' ')}"`
          : null;
        this.columnsSamples = this.columnsSamples.map(column =>
          column.name === 'repositoryName' ? { ...column, visible: !singleRepo } : column
        );
      })
    );
    // The search narrows the rows only; the title and the repository column above
    // follow the loaded items, so they stay put while the user types.
    this.repositoryItems$ = combineLatest([loaded$, this.searchText$]).pipe(
      map(([items, text]) => filterByName(items, text))
    );
  }

  onSearch(text: string): void {
    this.searchText = text;
    this.searchText$.next(text);
  }

  ngOnInit() {
    this.repositoryItems$?.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(samples => {
      this.repositoryItems = samples;
      this.cdr.markForCheck();
    });

    this.actionControls.push({
      text: 'View Source',
      type: 'VIEW',
      icon: 'document-with-code',
      showIf: item => item['type'] == 'file',
      callback: this.viewMonitor.bind(this)
    });

    this.initializeActiveRepository();
    this.loadBackendStatus();
  }

  private async loadBackendStatus(): Promise<void> {
    try {
      this.backendDeployed = await this.analyticsService.isBackendServiceDeployed();
      this.cdr.markForCheck();
    } catch (error) {
      console.error('Failed to load backend service status:', error);
    }
  }

  async recheckBackend(): Promise<void> {
    this.backendTogglePending = true;
    try {
      this.backendDeployed = await this.analyticsService.recheckBackendServiceDeployed();
      this.cdr.markForCheck();
    } catch (error) {
      console.error('Failed to re-check the backend service:', error);
    } finally {
      this.backendTogglePending = false;
      this.cdr.markForCheck();
    }
  }

  initializeActiveRepository(): void {
    this.repositoryService
      .getRepositories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(repositories => {
        this.repositories = repositories;
        // Keep the choice while it exists; otherwise fall back to the first repository.
        if (!repositories.some(r => r.id === this.selectedRepositoryId)) {
          const [fallback] = repositories;
          this.selectRepository(fallback?.id ?? '');
          if (!fallback) {
            this.selectedRepositoryId = null;
          }
        }
        this.cdr.markForCheck();
      });
  }

  viewMonitor(block: RepositoryItem) {
    const initialState = {
      source$: this.repositoryService.getRepositoryItemContent(block, false).pipe(
        catchError(() => {
          this.alertService.danger(
            this.messages.format(gettext('Failed to load content for "{{blockName}}".'), {
              blockName: block.name
            })
          );
          return of('');
        })
      ),
      monitorName: block.name
    };
    this.bsModalService.show(EditorModalComponent, {
      class: 'modal-editor-wide',
      initialState,
      ariaDescribedby: 'modal-body',
      ariaLabelledBy: 'modal-title',
      ignoreBackdropClick: true
    }).content as EditorModalComponent;
  }

  /**
   * Reload repository items (clears cache only)
   */
  reload(): void {
    this.repositoryService.reload();
  }

  /**
   * Reload repositories and items from backend
   */
  async reloadAll(): Promise<void> {
    this.loading = true;
    this.cdr.markForCheck();
    try {
      await this.repositoryService.reloadAll();
    } catch (error) {
      // Error already handled in service
      console.error('Failed to reload:', error);
    } finally {
      this.loading = false;
      this.cdr.markForCheck();
    }
  }

  async updateFilter() {
    this.repositoryService.updateHideInstalledFilter(this.hideInstalled);
    this.hideInstalled$.next(this.hideInstalled);
  }

  selectRepository(id: string): void {
    if (id !== this.selectedRepositoryId) {
      this.selectedItemIds = [];
    }
    this.selectedRepositoryId = id;
    this.selectedRepositoryId$.next(id);
  }

  openRepositoriesDrawer(): void {
    this.showConfigRepositories = true;
  }

  private readonly dataGrid = viewChild(DataGridComponent);

  /** Ids of the rows ticked in the grid; the wizard starts with them chosen. */
  selectedItemIds: string[] = [];

  onItemsSelect(ids: string[]): void {
    this.selectedItemIds = ids;
  }

  addExtension(): void {
    const options =
      this.selectedItemIds.length > 0 && this.selectedRepositoryId
        ? { repositoryId: this.selectedRepositoryId, selectedIds: this.selectedItemIds }
        : undefined;
    this.extensionWizard.open(options).subscribe(added => {
      if (added) {
        this.dataGrid()?.cancel();
        this.selectedItemIds = [];
        this.reload();
      }
    });
  }

  openLayoutHelp(): void {
    const modalRef = this.bsModalService.show(ExtensionLayoutHelpModalComponent, {
      class: 'modal-lg',
      ariaLabelledBy: 'modal-title',
      ignoreBackdropClick: false
    });
    modalRef.content?.closeSubject.pipe(take(1)).subscribe(() => modalRef.hide());
  }

  onRepositoryCommit(): void {
    // console.log('Repository saved:', repository);
    this.showConfigRepositories = false;
    // Handle the saved repository
  }

  onRepositoryCancel(): void {
    this.showConfigRepositories = false;
  }
}
