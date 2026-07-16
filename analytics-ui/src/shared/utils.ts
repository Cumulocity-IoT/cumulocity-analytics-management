import { CepBlock } from './analytics.model';

export function uuidCustom(): string {
  const id = Math.random().toString(36).slice(-6);
  return id;
}

export function removeFileExtension(name: string): string {
  // Remove .zip extension if present, otherwise remove the last extension
  if (name.toLowerCase().endsWith('.zip')) {
    return name.slice(0, -4);
  }
  const result = name.replace(/\.[^.]*$/, '');
  return result;
}

export function getFileExtension(name: string): string {
  const pattern = /\.([0-9a-z]+)(?:[?#]|$)/i;
  const result = name.match(pattern);
  return (result && result != null) ? result[0] : '';
}

/** Finds the index of the `{` opening the declaration at `declIndex`, then its matching `}`. */
export function extractBraceBody(content: string, declIndex: number): string | null {
  const openIndex = content.indexOf('{', declIndex);
  if (openIndex === -1) return null;

  let depth = 0;
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return content.slice(openIndex + 1, i);
    }
  }
  return null;
}

/**
 * Finds every Apama Analytics Builder block's event type name in a `.mon`
 * file's source text: an `event <Name> { ... }` declaration whose body
 * declares a `BlockBase $base;` field — the one field every such block
 * requires (per the block SDK's own docs), regardless of whether it also
 * declares parameters. A `<Name>_$Parameters` companion event is *not* a
 * reliable signal on its own: it's omitted entirely by blocks that take no
 * parameters (e.g. `Distance.mon` in `analytics-builder-blocks-contrib`),
 * which a parameters-only detection would silently miss.
 */
export function findApamaBlockNames(content: string): string[] {
  const names: string[] = [];
  const declPattern = /\bevent\s+(\w+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = declPattern.exec(content))) {
    const body = extractBraceBody(content, match.index);
    if (body && /\bBlockBase\s+\$base\s*;/.test(body)) {
      names.push(match[1]);
    }
  }
  return [...new Set(names)];
}

/**
 * Extracts the fully-qualified block name(s) a `.mon` file defines, matching
 * how the Apama correlator reports deployed block ids (`CepBlock.id`). A
 * file can define more than one block whose names don't match the file name
 * (e.g. a Send/Receive pair in one file) — see `findApamaBlockNames`. Falls
 * back to `package.<fallbackName>` when no block is found (e.g. a `.mon`
 * that isn't an Analytics Builder block at all).
 */
export function extractBlockFqns(content: string, fallbackName: string): string[] {
  const packageMatch = content.match(/^package\s+(.*?);/m);
  const packageName = packageMatch ? packageMatch[1].trim() : '';

  const blockNames = findApamaBlockNames(content);
  const names = blockNames.length > 0 ? blockNames : [fallbackName];
  return packageName ? names.map(name => `${packageName}.${name}`) : names;
}

export function isCustomCepBlock(block: Pick<CepBlock, 'id'>): boolean {
  const id = block.id ?? '';
  return (
    !id.startsWith('apama.analyticsbuilder.blocks') &&
    !id.startsWith('apama.analyticskit.blocks.core') &&
    !id.startsWith('apama.analyticskit.blocks.cumulocity')
  );
}

export const DEFAULT_BRANCH = 'main';

/**
 * Triggers a native browser download of the given URL. This is a plain
 * top-level navigation (not fetch/XHR), so it is not subject to CORS —
 * required for GitHub release assets, whose CDN (release-assets.githubusercontent.com)
 * sends no Access-Control-Allow-Origin header and therefore cannot be read via fetch().
 */
export function triggerBrowserDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * True in Chromium-based browsers, which support the File System Access API
 * (`showDirectoryPicker` and/or `showOpenFilePicker`) — used to grab the
 * "just downloaded" file without the user having to hunt for it. Not
 * supported in Firefox/Safari; callers should fall back to a plain
 * `<input type=file>`/drop-area there.
 */
export function supportsDownloadsFilePicker(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
    || typeof (window as any).showOpenFilePicker === 'function';
}

/**
 * Opens the native file picker starting in the Downloads folder and returns
 * the selected file, or `null` if the user cancelled. Chromium-only.
 */
export async function pickFileFromDownloads(accept: string, description: string): Promise<File | null> {
  try {
    const [handle] = await (window as any).showOpenFilePicker({
      startIn: 'downloads',
      multiple: false,
      types: [{ description, accept: { 'application/octet-stream': [accept] } }]
    });
    return await handle.getFile();
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return null;
    }
    throw error;
  }
}

const DOWNLOADS_HANDLE_DB = 'a17t-file-handles';
const DOWNLOADS_HANDLE_STORE = 'handles';
const DOWNLOADS_HANDLE_KEY = 'downloadsDir';

function openHandleStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DOWNLOADS_HANDLE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DOWNLOADS_HANDLE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadStoredDownloadsHandle(): Promise<any | null> {
  const db = await openHandleStore();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DOWNLOADS_HANDLE_STORE, 'readonly')
      .objectStore(DOWNLOADS_HANDLE_STORE)
      .get(DOWNLOADS_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function saveDownloadsHandle(handle: any): Promise<void> {
  const db = await openHandleStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOADS_HANDLE_STORE, 'readwrite');
    tx.objectStore(DOWNLOADS_HANDLE_STORE).put(handle, DOWNLOADS_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Reading the stored handle is a real async IndexedDB round-trip — awaiting
// it *inside* the click handler, before calling `showDirectoryPicker()`, is
// enough of a delay for Chrome to drop the click's transient user-activation,
// which makes `showDirectoryPicker()` fail immediately with `AbortError` and
// never even show a dialog (verified in practice). So this cache is warmed
// ahead of time via `preloadDownloadsDirectoryHandle()` — call it as soon as
// you know a pick is coming (e.g. right after starting the download), well
// before the user's next click — so that by click time, reading it back is
// synchronous-ish and `showDirectoryPicker()` remains the first real async
// call in the handler.
let cachedDownloadsHandlePromise: Promise<any | null> | null = null;

export function preloadDownloadsDirectoryHandle(): void {
  if (!cachedDownloadsHandlePromise) {
    cachedDownloadsHandlePromise = loadStoredDownloadsHandle().catch(() => null);
  }
}

/**
 * Returns a handle to the user's Downloads folder, reusing a previously
 * granted one (persisted in IndexedDB — `FileSystemDirectoryHandle` is
 * structured-cloneable) so only the *first* use per browser profile needs
 * the native folder-access prompt; later calls just re-check permission
 * (no dialog, no user gesture spent) as long as it's still granted. Returns
 * `null` if the user declines the (re-)prompt. Call
 * `preloadDownloadsDirectoryHandle()` ahead of the triggering click — see
 * above for why.
 */
async function getDownloadsDirectoryHandle(): Promise<any | null> {
  preloadDownloadsDirectoryHandle();

  try {
    const stored = await cachedDownloadsHandlePromise;
    if (stored) {
      const granted = await stored.queryPermission({ mode: 'read' }) === 'granted'
        || await stored.requestPermission({ mode: 'read' }) === 'granted';
      if (granted) {
        return stored;
      }
    }
  } catch {
    // Stored handle is stale/unusable — fall through and re-pick.
  }

  try {
    const handle = await (window as any).showDirectoryPicker({ id: 'a17t-downloads', startIn: 'downloads' });
    cachedDownloadsHandlePromise = Promise.resolve(handle);
    void saveDownloadsHandle(handle);
    return handle;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      return null;
    }
    throw error;
  }
}

/**
 * Polls the Downloads folder for `fileName`, tolerating Chrome's automatic
 * "name (1).ext" suffixing when a file of that name already existed there
 * (picks the highest numbered duplicate, i.e. the newest one). Returns
 * `null` if it never shows up within `timeoutMs` — e.g. the download is
 * still in progress, was blocked, or failed.
 */
async function waitForDownloadedFile(
  dirHandle: any,
  fileName: string,
  timeoutMs = 8000,
  intervalMs = 300
): Promise<File | null> {
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex >= 0 ? fileName.slice(dotIndex) : '';
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const duplicatePattern = new RegExp(`^${escape(baseName)} \\((\\d+)\\)${escape(extension)}$`);

  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const handle = await dirHandle.getFileHandle(fileName);
      return await handle.getFile();
    } catch (error: any) {
      if (error?.name !== 'NotFoundError') {
        throw error;
      }
    }

    let bestDuplicate: { suffix: number; name: string } | null = null;
    for await (const entryName of dirHandle.keys()) {
      const match = entryName.match(duplicatePattern);
      if (match) {
        const suffix = Number(match[1]);
        if (!bestDuplicate || suffix > bestDuplicate.suffix) {
          bestDuplicate = { suffix, name: entryName };
        }
      }
    }
    if (bestDuplicate) {
      const handle = await dirHandle.getFileHandle(bestDuplicate.name);
      return await handle.getFile();
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  } while (Date.now() < deadline);

  return null;
}

/**
 * Best-effort "grab the file I just downloaded, no manual selection"
 * flow. Uses exactly one File System Access API call per invocation (never
 * chains a directory picker and a file picker in the same click — each is
 * independently activation-gated, so the second call in a chain is silently
 * refused, the same constraint documented on `triggerBrowserDownload`):
 * - Where `showDirectoryPicker` exists, look the file up by name in the
 *   (permission-persisted) Downloads folder — zero-click on repeat use.
 * - Otherwise fall back to the plain Downloads-rooted open picker, which
 *   still needs a manual click on the file but at least starts in the
 *   right folder.
 * Returns `null` if unsupported, declined, or not found in time — callers
 * should leave a manual fallback (e.g. the existing drop-area) available.
 */
export async function pickOrFindDownloadedFile(
  fileName: string,
  accept: string,
  description: string
): Promise<File | null> {
  if (typeof (window as any).showDirectoryPicker === 'function') {
    const dirHandle = await getDownloadsDirectoryHandle();
    return dirHandle ? waitForDownloadedFile(dirHandle, fileName) : null;
  }
  return pickFileFromDownloads(accept, description);
}

export /**
* Transforms a GitHub web URL to a GitHub Content API endpoint URL
* @param githubWebUrl A GitHub web URL (e.g., https://github.com/user/repo/tree/branch/path)
* @returns The equivalent GitHub Content API URL
*/
  function githubWebUrlToContentApi(githubWebUrl: string): string {
  try {
    // Parse the URL
    const url = new URL(githubWebUrl);

    // Verify it's a GitHub URL
    if (!url.hostname.includes('github.com')) {
      throw new Error('Not a GitHub URL');
    }

    // Extract repo info from path
    const pathParts = url.pathname.split('/').filter(part => part.length > 0);

    // Need at least user and repo
    if (pathParts.length < 2) {
      throw new Error('Invalid GitHub URL: missing user or repository');
    }

    const user = pathParts[0];
    const repo = pathParts[1];
    let branch = DEFAULT_BRANCH;

    // Check if the URL points to a specific branch/tag/commit
    let pathInRepo = '';

    if (pathParts.length > 3 && pathParts[2] === 'tree') {
      branch = pathParts[3];
      pathInRepo = pathParts.slice(4).join('/');
    } else if (pathParts.length > 2) {
      // URL doesn't specify a branch, assume content is in the root
      pathInRepo = pathParts.slice(2).join('/');
    }

    // Build the Content API URL
    let contentApiUrl = `https://api.github.com/repos/${user}/${repo}/contents`;

    if (pathInRepo) {
      contentApiUrl += `/${pathInRepo}`;
    }

    contentApiUrl += `?ref=${branch}`;

    return contentApiUrl;
  } catch (error) {
    throw new Error(`Failed to convert GitHub URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

