import { TestBed } from '@angular/core/testing';
import { AlertService } from '@c8y/ngx-components';
import { CepBlock } from '../shared';
import { AnalyticsService } from '../shared';
import { BlockGridComponent } from './block-grid.component';

const block = (id: string) => ({ id, name: id }) as CepBlock;

describe('BlockGridComponent', () => {
  let component: BlockGridComponent;
  let analytics: jasmine.SpyObj<AnalyticsService>;

  beforeEach(() => {
    analytics = jasmine.createSpyObj('AnalyticsService', ['clearAllCaches', 'getDeployedBlocks']);
    analytics.getDeployedBlocks.and.resolveTo([block('a.A')]);
    TestBed.configureTestingModule({
      imports: [BlockGridComponent],
      providers: [
        { provide: AnalyticsService, useValue: analytics },
        { provide: AlertService, useValue: jasmine.createSpyObj('AlertService', ['danger']) }
      ]
    });
    TestBed.overrideComponent(BlockGridComponent, { set: { template: '', templateUrl: undefined, styleUrls: [], imports: [] } });
    component = TestBed.createComponent(BlockGridComponent).componentInstance;
  });

  it('is titled after what it shows: the blocks loaded in the engine', () => {
    expect(component.titleBlock).toBe('Blocks in the engine');
    expect(component.labels.installedBlocks).toBe('Installed blocks');
    expect(component.routes.installedBlocks).toBe('c8y-pkg-analytics-extension/installed-blocks');
  });

  it('starts in the loading state', () => {
    expect(component.loading).toBeTrue();
  });

  it('loads the deployed blocks on init from fresh caches', async () => {
    await component.ngOnInit();
    expect(analytics.clearAllCaches).toHaveBeenCalled();
    expect(component.blocks.map(b => b.id)).toEqual(['a.A']);
    expect(component.loading).toBeFalse();
  });

  it('reloads when a refresh is requested', async () => {
    await component.ngOnInit();
    analytics.getDeployedBlocks.and.resolveTo([block('b.B'), block('c.C')]);
    component.refresh.emit();
    await new Promise(resolve => setTimeout(resolve));
    expect(component.blocks.length).toBe(2);
  });

  it('leaves the loading state even when loading fails', async () => {
    analytics.getDeployedBlocks.and.rejectWith(new Error('engine down'));
    await expectAsync(component.loadBlocks()).toBeRejected();
    expect(component.loading).toBeFalse();
    expect(component.blocks).toEqual([]);
  });

  it('defines the columns in display order with renderers for category and custom flag', () => {
    expect(component.columnsBlocks.map(c => c.name)).toEqual(['name', 'category', 'description', 'extension', 'custom']);
    expect(component.columnsBlocks[1].cellRendererComponent).toBeDefined();
    expect(component.columnsBlocks[4].cellRendererComponent).toBeDefined();
  });
});
