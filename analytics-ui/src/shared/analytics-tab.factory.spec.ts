import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AnalyticsTabFactory } from './analytics-tab.factory';

describe('AnalyticsTabFactory', () => {
  const tabsFor = (url: string) => firstValueFrom(new AnalyticsTabFactory({ url } as Router).get());

  it('offers no tabs outside the analytics extension pages', async () => {
    expect(await tabsFor('/apps/administration/#/devices')).toEqual([]);
  });

  it('offers the three tabs in display order on every analytics extension page', async () => {
    for (const url of ['/c8y-pkg-analytics-extension/manage', '/x/c8y-pkg-analytics-extension/repository']) {
      const tabs = await tabsFor(url);
      expect(tabs.map(t => t.path)).toEqual([
        'c8y-pkg-analytics-extension/manage',
        'c8y-pkg-analytics-extension/installed-blocks',
        'c8y-pkg-analytics-extension/repository'
      ]);
    }
  });

  it('names the tabs after the page names and routes (single source: analytics.constants.ts)', async () => {
    const tabs = await tabsFor('/c8y-pkg-analytics-extension/manage');
    expect(tabs.map(t => t.label)).toEqual(['Extensions', 'Installed blocks', 'Repositories']);
    expect(tabs[1].path).toBe('c8y-pkg-analytics-extension/installed-blocks');
  });

  it('orders tabs by descending priority and lays them out horizontally', async () => {
    const tabs = await tabsFor('/c8y-pkg-analytics-extension/manage');
    const priorities = tabs.map(t => t.priority!);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
    expect(new Set(priorities).size).toBe(tabs.length);
    expect(tabs.every(t => t.orientation === 'horizontal')).toBeTrue();
  });
});
