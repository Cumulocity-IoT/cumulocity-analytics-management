import { TestBed } from '@angular/core/testing';
import { ReleaseListComponent } from './release-list.component';
import { RELEASE_BLOCKS, RELEASE_BUNDLES } from './release-list.data';

describe('ReleaseListComponent', () => {
  let component: ReleaseListComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ReleaseListComponent] });
    TestBed.overrideComponent(ReleaseListComponent, { set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] } });
    component = TestBed.createComponent(ReleaseListComponent).componentInstance;
  });

  it('shows all bundles and blocks without a filter', () => {
    expect(component.filteredBundles).toEqual(RELEASE_BUNDLES);
    expect(component.filteredBlocks).toEqual(RELEASE_BLOCKS);
  });

  it('treats a blank filter as no filter', () => {
    component.filterTerm = '   ';
    expect(component.filteredBlocks.length).toBe(RELEASE_BLOCKS.length);
  });

  it('filters by name, case-insensitively and ignoring surrounding spaces', () => {
    component.filterTerm = '  ABS ';
    expect(component.filteredBlocks.map(a => a.name)).toContain('Abs');
    expect(component.filteredBlocks.every(a => (a.name + a.description).toLowerCase().includes('abs'))).toBeTrue();
  });

  it('filters by description', () => {
    component.filterTerm = 'cron expression';
    expect(component.filteredBlocks.map(a => a.name)).toEqual(['CronTimer']);
  });

  it('filters bundles and blocks independently with the same term', () => {
    component.filterTerm = 'simulation';
    expect(component.filteredBundles.map(a => a.name)).toEqual(['contrib-simulation-blocks']);
  });

  it('returns nothing when no asset matches', () => {
    component.filterTerm = 'no-such-block';
    expect(component.filteredBundles).toEqual([]);
    expect(component.filteredBlocks).toEqual([]);
  });

  it('formats sizes in KB with one decimal', () => {
    expect(component.formatSize(1536)).toBe('1.5 KB');
    expect(component.formatSize(0)).toBe('0.0 KB');
  });

  it('tracks assets by name', () => {
    expect(component.trackByAsset(0, RELEASE_BLOCKS[0])).toBe(RELEASE_BLOCKS[0].name);
  });
});
