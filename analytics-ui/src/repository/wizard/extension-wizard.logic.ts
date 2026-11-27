import { gettext } from '@c8y/ngx-components/gettext';
import { DESCRIPTOR_YAML, RepositoryItem } from '../../shared';

/** Whether a row of the content step can be selected, and if not, why. */
export interface ContentState {
  disabled: boolean;
  /** Static `gettext` key, safe to pass to the `translate` pipe. */
  reason?: string;
  /** Name of the selected item that causes the conflict, for the `{{blockName}}` placeholder. */
  conflictsWith?: string;
}

export const isSection = (item: RepositoryItem): boolean => !!item.extensionsYamlItem;

/**
 * Decides, for every item of one repository, whether it can be added to the
 * extension that is being built. The wizard calls this on every change, so the
 * rules are visible as disabled rows with a reason instead of warnings that
 * appear after the click.
 */
export function evaluateContent(
  items: readonly RepositoryItem[],
  selectedIds: ReadonlySet<string>,
  backendAvailable: boolean
): Map<string, ContentState> {
  const selected = items.filter(item => selectedIds.has(item.id));
  const hasSection = selected.some(isSection);
  const hasFile = selected.some(item => !isSection(item));
  const result = new Map<string, ContentState>();

  for (const item of items) {
    if (selectedIds.has(item.id)) {
      result.set(item.id, { disabled: false });
      continue;
    }
    result.set(item.id, stateFor(item, selected, hasSection, hasFile, backendAvailable));
  }
  return result;
}

function stateFor(
  item: RepositoryItem,
  selected: readonly RepositoryItem[],
  hasSection: boolean,
  hasFile: boolean,
  backendAvailable: boolean
): ContentState {
  if (item.installed) {
    return { disabled: true, reason: gettext('Already installed') };
  }
  if (isSection(item)) {
    if (!backendAvailable) {
      return { disabled: true, reason: gettext('Needs the backend service') };
    }
    if (hasFile) {
      return { disabled: true, reason: gettext('Cannot be combined with individual files') };
    }
  } else {
    if (item.type === 'dir' && !backendAvailable) {
      // The browser-side build skips directories, so their content would be lost.
      return { disabled: true, reason: gettext('Needs the backend service') };
    }
    if (item.type === 'file' && !item.file.endsWith('.mon') && item.file !== DESCRIPTOR_YAML) {
      return { disabled: true, reason: gettext('Not a monitor file') };
    }
    if (hasSection) {
      return {
        disabled: true,
        reason: gettext('Cannot be combined with extensions.yaml sections')
      };
    }
  }

  // The engine refuses an extension that defines the same block twice.
  const mine = new Set(item.blockIds ?? item.sectionFiles ?? []);
  if (mine.size > 0) {
    const clash = selected.find(other =>
      (other.blockIds ?? other.sectionFiles ?? []).some(id => mine.has(id))
    );
    if (clash) {
      return {
        disabled: true,
        reason: gettext('Defines the same block as "{{blockName}}"'),
        conflictsWith: clash.name
      };
    }
  }
  return { disabled: false };
}

/**
 * Names of selected items that define a block another selected item defines too. The engine
 * refuses such an extension, so the wizard blocks the build until the rows are unticked.
 */
export function findSelectionConflicts(
  items: readonly RepositoryItem[],
  selectedIds: ReadonlySet<string>
): Set<string> {
  const selected = items.filter(item => selectedIds.has(item.id));
  const owners = new Map<string, string[]>();
  for (const item of selected) {
    for (const id of item.blockIds ?? item.sectionFiles ?? []) {
      owners.set(id, [...(owners.get(id) ?? []), item.id]);
    }
  }
  const conflicting = new Set<string>();
  for (const ids of owners.values()) {
    if (ids.length > 1) {
      ids.forEach(id => conflicting.add(id));
    }
  }
  return conflicting;
}

/** The `createExtensionFrom*` input for the chosen items (sections or plain files). */
export function toBuildInput(
  items: readonly RepositoryItem[],
  selectedIds: ReadonlySet<string>
): { sections: string[]; monitors: RepositoryItem[] } {
  const sections: string[] = [];
  const monitors: RepositoryItem[] = [];
  for (const item of items) {
    if (!selectedIds.has(item.id)) {
      continue;
    }
    if (item.extensionsYamlItem) {
      sections.push(item.name);
      monitors[0] = item.extensionsYamlItem;
    } else {
      monitors.push(item);
    }
  }
  return { sections, monitors };
}

/** What the backend reports for `POST /extension/yaml` when only some sections were uploaded (207). */
export interface SectionOutcome {
  created: string[];
  failed: { section: string; error?: string }[];
}

/** Reads the 207 body (`uploaded_extensions`, `failed_sections`); tolerant of missing fields. */
export function parseSectionOutcome(body: unknown): SectionOutcome {
  const data = (body ?? {}) as {
    uploaded_extensions?: { name?: string }[];
    failed_sections?: { section?: string; error?: string }[];
  };
  return {
    created: (data.uploaded_extensions ?? []).map(e => e?.name ?? '').filter(name => !!name),
    failed: (data.failed_sections ?? []).map(f => ({ section: f?.section ?? '', error: f?.error }))
  };
}
