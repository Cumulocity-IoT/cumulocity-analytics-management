import { ErrorType } from './analytics.model';
import { ERROR_MESSAGES, PAGE_LABELS, ROUTE_ROOT, ROUTES } from './analytics.constants';

describe('analytics.constants', () => {
  it('keeps every route below the plugin root and without duplicates', () => {
    const paths = Object.values(ROUTES);
    expect(paths.every(p => p.startsWith(`${ROUTE_ROOT}/`))).toBeTrue();
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('uses one name per page, in sentence case', () => {
    expect(PAGE_LABELS).toEqual({
      extensions: 'Extensions',
      installedBlocks: 'Installed blocks',
      repositories: 'Repositories'
    });
  });

  it('has a message for every upload error type', () => {
    Object.values(ErrorType).forEach(type => expect((ERROR_MESSAGES as Record<string, string>)[type]).withContext(type).toBeTruthy());
  });
});
