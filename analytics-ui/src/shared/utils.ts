import { CEP_Block } from './analytics.model';

export function uuidCustom(): string {
  const id = Math.random().toString(36).slice(-6);
  return id;
}

export function removeFileExtension(name: string): string {
  const result = name.replace(/\.[^.]*$/, '');
  return result;
}

export function getFileExtension(name: string): string {
  const pattern = /\.([0-9a-z]+)(?:[?#]|$)/i;
  const result = name.match(pattern);
  return (result || result == null) ? undefined : result[0];
}

export function isCustomCEP_Block(block: CEP_Block): boolean {
  return (
    !block.id.startsWith('apama.analyticsbuilder.blocks') &&
    !block.id.startsWith('apama.analyticskit.blocks.core') &&
    !block.id.startsWith('apama.analyticskit.blocks.cumulocity')
  );
}

export const DEFAULT_BRANCH = 'main';

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
    throw new Error(`Failed to convert GitHub URL: ${error.message}`);
  }
}

