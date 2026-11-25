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
