import { RELEASE_ASSETS, RELEASE_BLOCKS, RELEASE_BUNDLES, RELEASE_PUBLISHED_AT, RELEASE_TAG_URL } from './release-list.data';

describe('release list data', () => {
  it('combines bundles and blocks', () => {
    expect(RELEASE_ASSETS.length).toBe(RELEASE_BUNDLES.length + RELEASE_BLOCKS.length);
  });

  it('tags bundles and blocks with their kind', () => {
    expect(RELEASE_BUNDLES.every(a => a.kind === 'bundle')).toBeTrue();
    expect(RELEASE_BLOCKS.every(a => a.kind === 'block')).toBeTrue();
  });

  it('has unique asset names', () => {
    const names = RELEASE_ASSETS.map(a => a.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('builds download urls from the release tag', () => {
    RELEASE_ASSETS.forEach(a => {
      expect(a.downloadUrl).toBe(`https://github.com/Cumulocity-IoT/analytics-builder-blocks-contrib/releases/download/1.0.1/${a.name}-${a.version}.zip`);
    });
    expect(RELEASE_TAG_URL.endsWith(`/tag/${RELEASE_ASSETS[0].version}`)).toBeTrue();
  });

  it('describes every asset', () => {
    RELEASE_ASSETS.forEach(a => {
      expect(a.description).withContext(a.name).toBeTruthy();
      expect(a.sizeBytes).withContext(a.name).toBeGreaterThan(0);
      expect(a.author).toBe('Cumulocity GmbH');
    });
  });

  it('carries an ISO publication date', () => {
    expect(RELEASE_PUBLISHED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
