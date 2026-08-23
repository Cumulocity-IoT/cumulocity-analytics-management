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

