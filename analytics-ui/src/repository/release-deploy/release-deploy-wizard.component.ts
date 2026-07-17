import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertService, CoreModule, WizardComponent } from '@c8y/ngx-components';
import { IManagedObject } from '@c8y/client';
import { gettext } from '@c8y/ngx-components/gettext';
import {
  AnalyticsService,
  ExtensionAddComponent,
  FetchExtensionService,
  GitHubRelease,
  GitHubReleaseAsset,
  GitHubReleaseService,
  Repository,
  RepositoryService,
  UploadMode,
  triggerBrowserDownload
} from '../../shared';

type Phase = 'select' | 'upload';

@Component({
  selector: 'a17t-release-deploy-wizard',
  templateUrl: './release-deploy-wizard.component.html',
  standalone: true,
  imports: [CommonModule, FormsModule, CoreModule, ExtensionAddComponent]
})
export class ReleaseDeployWizardComponent implements OnInit {
  phase: Phase = 'select';
  loading = false;

  repositories: Repository[] = [];
  selectedRepository: Repository | null = null;

  releases: GitHubRelease[] = [];
  selectedRelease: GitHubRelease | null = null;

  selectedAsset: GitHubReleaseAsset | null = null;

  errorMessage: string | null = null;

  sendingFetchEvent = false;

  constructor(
    private readonly repositoryService: RepositoryService,
    private readonly githubReleaseService: GitHubReleaseService,
    private readonly analyticsService: AnalyticsService,
    private readonly fetchExtensionService: FetchExtensionService,
    private readonly alertService: AlertService,
    private readonly wizardComponent: WizardComponent
  ) { }

  uploadExtensionHandler = (
    file: File,
    extension: Partial<IManagedObject>,
    mode: UploadMode
  ) => this.analyticsService.uploadExtension(file, extension as IManagedObject, mode);

  ngOnInit(): void {
    this.repositoryService.getRepositories().subscribe(repositories => {
      this.repositories = repositories;
      if (!this.selectedRepository && repositories.length > 0) {
        this.onRepositorySelected(repositories.find(r => r.enabled) || repositories[0]);
      }
    });
  }

  get assets(): GitHubReleaseAsset[] {
    return (this.selectedRelease?.assets || []).filter(asset => asset.name.toLowerCase().endsWith('.zip'));
  }

  async onRepositorySelected(repository: Repository | null): Promise<void> {
    this.selectedRepository = repository;
    this.releases = [];
    this.selectedRelease = null;
    this.selectedAsset = null;
    this.errorMessage = null;

    if (!repository) {
      return;
    }

    const ownerRepo = this.githubReleaseService.parseOwnerRepo(repository);
    if (!ownerRepo) {
      this.errorMessage = gettext('This repository URL could not be parsed as a GitHub owner/repo.');
      return;
    }

    this.loading = true;
    try {
      // repository.accessToken is always the masked DUMMY_ACCESS_TOKEN
      // placeholder (see RepositoryService.parseRepositoryOption) — fetch
      // the real token separately for the actual GitHub call.
      const accessToken = await this.repositoryService.getRepositoryAccessToken(repository.id);
      this.releases = await this.githubReleaseService.listReleases(
        ownerRepo.owner,
        ownerRepo.repo,
        accessToken
      );
      if (this.releases.length > 0) {
        this.onReleaseSelected(this.releases[0]);
      }
    } catch (error: any) {
      this.errorMessage = error?.userMessage || gettext('Failed to list releases.');
    } finally {
      this.loading = false;
    }
  }

  onReleaseSelected(release: GitHubRelease | null): void {
    this.selectedRelease = release;
    this.selectedAsset = null;
  }

  downloadAndContinue(): void {
    if (!this.selectedAsset) {
      return;
    }
    // Triggering the download consumes this click's user-activation token
    // (a browser security mechanism — one activation-gated action per
    // gesture), so a *second* activation-gated action — opening the file
    // picker via `dropAreaComponent.showPicker()` — cannot also be fired
    // from here, synchronously or not; the browser silently refuses it
    // (confirmed: even a synchronous same-handler attempt didn't work).
    // The upload step's own drop-area already opens the native file picker
    // on its own (fresh) click — see `c8y-drop-area`'s `clickToOpen` (true
    // by default) — so no workaround is needed, just one more real click.
    triggerBrowserDownload(this.selectedAsset.browserDownloadUrl, this.selectedAsset.name);
    this.alertService.info(
      `Downloading "${this.selectedAsset.name}" — once it's done, drag it from your browser's ` +
      `download tray straight onto the box below (fastest), or click the box to browse for it.`
    );
    this.phase = 'upload';
  }

  /**
   * Experimental, additive path alongside `downloadAndContinue()` — sends a
   * `c8y_FetchExtension` event instead of triggering a browser download. See
   * `FetchExtensionService` and docs/features/block-marketplace/DIRECT_UPLOAD.md:
   * as of this writing the EPL side (`repository/epl/FetchExtensionListener.mon`)
   * only logs the received event — this does NOT yet perform a real deploy.
   * It exists to exercise the event pipeline end to end while the actual
   * fetch/upload (DIRECT_UPLOAD.md R1/R2) is still open. Does not replace or
   * interfere with `downloadAndContinue()`'s working flow.
   */
  async sendFetchExtensionEvent(): Promise<void> {
    if (!this.selectedAsset || this.sendingFetchEvent) {
      return;
    }

    this.sendingFetchEvent = true;
    try {
      // repository.accessToken is always the masked DUMMY_ACCESS_TOKEN
      // placeholder (see RepositoryService.parseRepositoryOption) — fetch
      // the real token separately, same as onRepositorySelected() does for
      // the browser-side GitHub calls.
      const accessToken = this.selectedRepository
        ? await this.repositoryService.getRepositoryAccessToken(this.selectedRepository.id)
        : undefined;
      const { requestId } = await this.fetchExtensionService.sendFetchExtensionEvent(
        this.selectedAsset.browserDownloadUrl,
        this.selectedAsset.name,
        accessToken
      );
      this.alertService.info(
        `Sent fetch request for "${this.selectedAsset.name}" (requestId ${requestId}) — this only reaches ` +
        `the FetchExtensionListener EPL app's log for now, it does not deploy the extension yet.`
      );
    } catch {
      // FetchExtensionService already showed a danger alert with the
      // specific reason (proxy not found, event creation failed, etc.).
    } finally {
      this.sendingFetchEvent = false;
    }
  }

  cancel(): void {
    this.wizardComponent.close();
  }
}
