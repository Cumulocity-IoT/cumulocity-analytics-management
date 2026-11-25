import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { IManagedObject } from '@c8y/client';
import { AlertService, BottomDrawerRef, CoreModule } from '@c8y/ngx-components';
import { gettext } from '@c8y/ngx-components/gettext';
import { firstValueFrom } from 'rxjs';
import {
  AnalyticsService,
  ExtensionAddComponent,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubReleaseService,
  Repository,
  RepositoryItem,
  RepositoryService,
  UploadMode,
  triggerBrowserDownload
} from '../../shared';
import { MessageService } from '../../shared/message.service';
import { ContentState, evaluateContent, isSection, toBuildInput } from './extension-wizard.logic';

export type WizardSource = 'release' | 'build' | 'upload';
type StepId =
  | 'source'
  | 'repository'
  | 'release'
  | 'download'
  | 'content'
  | 'details'
  | 'review'
  | 'result'
  | 'upload';
type ResultState = 'running' | 'done' | 'failed';

/**
 * With the backend service a release is deployed server-side (the browser cannot read GitHub
 * release assets). Without it the user downloads the file and uploads it in two separate steps.
 */
const steps = (source: WizardSource, backendAvailable: boolean): StepId[] => {
  switch (source) {
    case 'release':
      return backendAvailable
        ? ['source', 'repository', 'release', 'review', 'result']
        : ['source', 'repository', 'release', 'download', 'upload'];
    case 'build':
      return ['source', 'repository', 'content', 'details', 'review', 'result'];
    default:
      return ['source', 'upload'];
  }
};

const STEP_LABELS: Record<StepId, string> = {
  source: gettext('Source'),
  repository: gettext('Repository'),
  release: gettext('Release and asset'),
  download: gettext('Download'),
  content: gettext('Content'),
  details: gettext('Name and options'),
  review: gettext('Review'),
  result: gettext('Result'),
  upload: gettext('Upload')
};

const STEP_TITLES: Record<StepId, string> = {
  source: gettext('What do you want to do?'),
  repository: gettext('Select a repository'),
  release: gettext('Select a release and an asset'),
  download: gettext('Download the extension file'),
  content: gettext('Select what goes into the extension'),
  details: gettext('Provide the extension details'),
  review: gettext('Review the extension'),
  result: gettext('Creating the extension'),
  upload: gettext('Upload a *.zip file')
};

/**
 * One guided path for adding an extension: deploy a release, build a new
 * extension from one repository, or upload a zip. Replaces the separate
 * release wizard, create modal and the grid's bulk "Create extension" action.
 *
 * Opened through `ExtensionWizardService` in a Cumulocity bottom drawer. `added` is `true` when an
 * extension was added (callers reload their list), `false` otherwise.
 */
@Component({
  selector: 'a17t-extension-wizard',
  templateUrl: './extension-wizard.component.html',
  styleUrls: ['./extension-wizard.component.css'],
  host: { class: 'd-flex d-col fit-h min-height-0' },
  imports: [FormsModule, CoreModule, ExtensionAddComponent]
})
export class ExtensionWizardComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly messages = inject(MessageService);
  private readonly repositoryService = inject(RepositoryService);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly githubReleaseService = inject(GitHubReleaseService);
  private readonly alertService = inject(AlertService);
  private readonly drawerRef = inject(BottomDrawerRef);

  readonly stepLabels = STEP_LABELS;

  /** Whether an extension was added; read by `ExtensionWizardService` when the drawer closes. */
  added = false;

  /** Set through `initialState` to skip the first step. */
  initialSource: WizardSource | null = null;

  readonly source = signal<WizardSource | null>(null);
  readonly stepIndex = signal(0);

  readonly repositories = signal<Repository[]>([]);
  readonly repositoryId = signal<string | null>(null);
  readonly backendAvailable = signal(false);

  readonly items = signal<RepositoryItem[]>([]);
  readonly itemsLoading = signal(false);
  readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  readonly filter = signal('');
  readonly name = signal('');
  readonly restart = signal(true);

  readonly releases = signal<GitHubRelease[]>([]);
  readonly releasesLoading = signal(false);
  readonly releaseId = signal<number | null>(null);
  readonly assetId = signal<number | null>(null);
  readonly assetFilter = signal('');
  readonly loadError = signal<string | null>(null);
  /** Repositories that were asked for releases and have none, so the list can mark them. */
  readonly reposWithoutReleases = signal<ReadonlySet<string>>(new Set());

  readonly result = signal<ResultState>('running');
  readonly uploaded = signal(false);
  readonly stepTitles: Record<StepId, string> = STEP_TITLES;

  readonly steps = computed<StepId[]>(() => {
    const source = this.source();
    return source
      ? steps(source, this.backendAvailable())
      : ['source', 'repository', 'content', 'details', 'review', 'result'];
  });
  readonly step = computed(() => this.steps()[this.stepIndex()]);

  readonly repository = computed(
    () => this.repositories().find(r => r.id === this.repositoryId()) ?? null
  );
  readonly states = computed<Map<string, ContentState>>(() =>
    evaluateContent(this.items(), this.selectedIds(), this.backendAvailable())
  );
  readonly visibleItems = computed(() => {
    const filter = this.filter().trim().toLowerCase();
    return this.items().filter(item => !filter || item.name.toLowerCase().includes(filter));
  });
  readonly selectedItems = computed(() => this.items().filter(i => this.selectedIds().has(i.id)));
  readonly selectableCount = computed(
    () => this.items().filter(i => !this.states().get(i.id)?.disabled).length
  );
  readonly allSelected = computed(
    () => this.selectableCount() > 0 && this.selectableCount() === this.selectedIds().size
  );

  readonly release = computed(() => this.releases().find(r => r.id === this.releaseId()) ?? null);
  readonly assets = computed<GitHubReleaseAsset[]>(() =>
    (this.release()?.assets ?? []).filter(a => a.name.toLowerCase().endsWith('.zip'))
  );
  readonly visibleAssets = computed(() => {
    const filter = this.assetFilter().trim().toLowerCase();
    return this.assets().filter(a => !filter || a.name.toLowerCase().includes(filter));
  });
  readonly asset = computed(() => this.assets().find(a => a.id === this.assetId()) ?? null);

  /** The chosen repository publishes no GitHub releases at all. */
  readonly noReleases = computed(
    () =>
      this.step() === 'release' &&
      !this.releasesLoading() &&
      !this.loadError() &&
      !!this.repository() &&
      this.releases().length === 0
  );

  readonly canContinue = computed(() => {
    switch (this.step()) {
      case 'source':
        return !!this.source();
      case 'repository':
        return !!this.repository();
      case 'release':
        return !!this.asset();
      case 'content':
        return this.selectedIds().size > 0 && !this.itemsLoading();
      case 'details':
        return this.name().trim().length > 0;
      default:
        return true;
    }
  });

  /** Why the next button is disabled, shown next to it. Empty when nothing blocks. */
  readonly blockedReason = computed(() => {
    if (this.canContinue()) {
      return '';
    }
    switch (this.step()) {
      case 'repository':
        return gettext('Select a repository to continue.');
      case 'release':
        return this.noReleases()
          ? gettext('This repository has no releases.')
          : gettext('Select an asset to continue.');
      case 'content':
        return gettext('Select at least one item to continue.');
      case 'details':
        return gettext('Enter a name to continue.');
      default:
        return '';
    }
  });

  uploadExtensionHandler = (file: File, extension: Partial<IManagedObject>, mode: UploadMode) =>
    this.analyticsService.uploadExtension(file, extension as IManagedObject, mode);

  ngOnInit(): void {
    this.repositoryService
      .getRepositories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(repositories => this.repositories.set(repositories));
    this.analyticsService
      .isBackendServiceAvailable()
      .then(available => this.backendAvailable.set(available))
      .catch(() => this.backendAvailable.set(false));
    if (this.initialSource) {
      this.chooseSource(this.initialSource);
      this.next();
    }
  }

  chooseSource(source: WizardSource): void {
    if (this.source() !== source) {
      this.source.set(source);
      this.resetSelections();
    }
  }

  chooseRepository(id: string): void {
    if (this.repositoryId() !== id) {
      this.repositoryId.set(id);
      this.resetSelections();
    }
  }

  private resetSelections(): void {
    this.items.set([]);
    this.selectedIds.set(new Set());
    this.filter.set('');
    this.name.set('');
    this.releases.set([]);
    this.releaseId.set(null);
    this.assetId.set(null);
    this.loadError.set(null);
  }

  next(): void {
    const step = this.step();
    this.stepIndex.update(i => i + 1);
    const upcoming = this.step();
    if (step === 'repository' && upcoming === 'content') {
      void this.loadItems();
    } else if (step === 'repository' && upcoming === 'release') {
      void this.loadReleases();
    } else if (step === 'content' && upcoming === 'details' && !this.name()) {
      this.name.set(this.selectedItems()[0]?.name.replace(/\.mon$/i, '') ?? '');
    } else if (upcoming === 'result') {
      void this.create();
    }
  }

  back(): void {
    this.stepIndex.update(i => Math.max(0, i - 1));
  }

  toggleItem(item: RepositoryItem, checked: boolean): void {
    const next = new Set(this.selectedIds());
    if (checked) {
      next.add(item.id);
    } else {
      next.delete(item.id);
    }
    this.selectedIds.set(next);
  }

  toggleAll(checked: boolean): void {
    this.selectedIds.set(
      checked
        ? new Set(
            this.items()
              .filter(i => !this.states().get(i.id)?.disabled)
              .map(i => i.id)
          )
        : new Set()
    );
  }

  reason(item: RepositoryItem): string {
    const state = this.states().get(item.id);
    return state?.reason
      ? this.messages.format(state.reason, { blockName: state.conflictsWith ?? '' })
      : '';
  }

  kind(item: RepositoryItem): string {
    if (isSection(item)) {
      return gettext('Section of extensions.yaml');
    }
    return item.type === 'dir' ? gettext('Directory') : gettext('Monitor file (.mon)');
  }

  isDisabled(item: RepositoryItem): boolean {
    return !!this.states().get(item.id)?.disabled;
  }

  private async loadItems(): Promise<void> {
    const repository = this.repository();
    if (!repository) {
      return;
    }
    this.itemsLoading.set(true);
    try {
      this.items.set(
        await firstValueFrom(this.repositoryService.getRepositoryItemsAnalyzedFor(repository.id))
      );
    } catch (error) {
      console.error('[ExtensionWizardComponent] Failed to load repository items:', error);
      this.items.set([]);
    } finally {
      this.itemsLoading.set(false);
    }
  }

  private async loadReleases(): Promise<void> {
    const repository = this.repository();
    if (!repository) {
      return;
    }
    const ownerRepo = this.githubReleaseService.parseOwnerRepo(repository);
    if (!ownerRepo) {
      this.loadError.set(
        gettext('This repository URL could not be parsed as a GitHub owner/repo.')
      );
      return;
    }
    this.releasesLoading.set(true);
    try {
      // repository.accessToken is the masked placeholder; the real token is read separately.
      const token = await this.repositoryService.getRepositoryAccessToken(repository.id);
      const releases = await this.githubReleaseService.listReleases(
        ownerRepo.owner,
        ownerRepo.repo,
        token
      );
      this.releases.set(releases);
      if (releases.length === 0) {
        this.reposWithoutReleases.update(set => new Set(set).add(repository.id));
      }
      this.chooseRelease(releases[0]?.id ?? null);
    } catch (error: unknown) {
      this.loadError.set(
        (error as { userMessage?: string })?.userMessage || gettext('Failed to list releases.')
      );
    } finally {
      this.releasesLoading.set(false);
    }
  }

  /** Switches from the release path to building from the same repository. */
  buildFromRepository(): void {
    this.chooseSource('build');
    this.stepIndex.set(this.steps().indexOf('content'));
    void this.loadItems();
  }

  chooseRelease(id: number | null): void {
    this.releaseId.set(id);
    this.assetFilter.set('');
    // With a single zip there is nothing to choose, and the list may sit below the fold.
    const [only, ...others] = this.assets();
    this.assetId.set(only && others.length === 0 ? only.id : null);
  }

  downloadAsset(): void {
    const asset = this.asset();
    if (asset) {
      // One user gesture can start one download; the upload box below needs its own click.
      triggerBrowserDownload(asset.browserDownloadUrl, asset.name);
    }
  }

  private async create(): Promise<void> {
    const repository = this.repository();
    if (!repository) {
      return;
    }
    this.result.set('running');
    if (this.source() === 'release') {
      await this.deployRelease(repository);
      return;
    }
    const name = this.name().trim();
    const restart = this.restart();
    const { sections, monitors } = toBuildInput(this.items(), this.selectedIds());
    try {
      const response = sections.length
        ? await this.repositoryService.createExtensionFromYaml(
            name,
            monitors[0],
            sections,
            repository,
            true,
            restart
          )
        : await this.repositoryService.createExtensionFromList(
            name,
            monitors,
            repository,
            true,
            restart
          );
      if (response.status < 400) {
        this.alertService.success(
          restart
            ? this.messages.format(
                gettext(
                  'The extension "{{fileName}}" has been uploaded and Streaming Analytics Engine is restarting…'
                ),
                { fileName: `${name}.zip` }
              )
            : gettext(
                'The selected blocks have been uploaded. They will be available in Analytics Builder after the next Apama restart.'
              )
        );
        this.result.set('done');
        return;
      }
      this.result.set('failed');
    } catch (error) {
      // RepositoryService already showed a specific alert for every failure path.
      console.error('[ExtensionWizardComponent] Failed to create extension:', error);
      this.result.set('failed');
    }
  }

  /** Backend path: the service downloads the asset and uploads it as an extension. */
  private async deployRelease(repository: Repository): Promise<void> {
    const asset = this.asset();
    const release = this.release();
    if (!asset || !release) {
      this.result.set('failed');
      return;
    }
    const restart = this.restart();
    try {
      const { warning } = await this.repositoryService.deployReleaseAsset(
        repository,
        asset,
        release.tagName,
        restart
      );
      if (warning) {
        this.alertService.warning(warning);
      }
      this.alertService.success(
        restart
          ? this.messages.format(
              gettext(
                'The extension "{{fileName}}" has been uploaded and Streaming Analytics Engine is restarting…'
              ),
              { fileName: asset.name }
            )
          : gettext(
              'The extension has been uploaded. Its blocks will be available in Analytics Builder after the next Apama restart.'
            )
      );
      this.result.set('done');
    } catch (error) {
      // RepositoryBackendService already showed the reason.
      console.error('[ExtensionWizardComponent] Failed to deploy the release:', error);
      this.result.set('failed');
    }
  }

  /** The extension name a release asset is stored under: the file name without `.zip`. */
  readonly assetExtensionName = computed(() => this.asset()?.name.replace(/\.zip$/i, '') ?? '');

  onUploaded(): void {
    this.uploaded.set(true);
  }

  /** Closes the drawer. Callers reload their list when `added` is true. */
  finish(added: boolean): void {
    this.added = added;
    void this.drawerRef.close();
  }
}
