import { TestBed } from '@angular/core/testing';
import { FetchClient, IManagedObject } from '@c8y/client';
import { AlertService } from '@c8y/ngx-components';
import { Category } from './analytics.model';
import { CepError } from './cep-error';
import { ExtensionEnrichmentService } from './extension-enrichment.service';
import { ExtensionInventoryService } from './extension-inventory.service';

const ok = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => body }) as unknown as Response;
const ext = (name: string) => ({ id: name, name }) as unknown as IManagedObject;

const METADATA_URL = '/service/cep/apamacorrelator/en/block-metadata.json';
const NAMES_URL = '/service/cep/diagnostics/extensionNames';
const detailUrl = (name: string) => `service/cep/apamacorrelator/en/${name}.json`;

describe('ExtensionEnrichmentService', () => {
  let service: ExtensionEnrichmentService;
  let fetchClient: jasmine.SpyObj<FetchClient>;
  let inventory: jasmine.SpyObj<ExtensionInventoryService>;
  let alerts: jasmine.SpyObj<AlertService>;
  let routes: Record<string, () => Response>;

  const count = (url: string) => fetchClient.fetch.calls.allArgs().filter(a => a[0] === url).length;

  beforeEach(() => {
    routes = {
      [METADATA_URL]: () => ok({ metadatas: [], messages: [] }),
      [NAMES_URL]: () => ok({ metadatas: [], messages: [] })
    };
    fetchClient = jasmine.createSpyObj('FetchClient', ['fetch']);
    fetchClient.fetch.and.callFake(async (url: string) => {
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      return route();
    });
    inventory = jasmine.createSpyObj('ExtensionInventoryService', ['getExtensionsFromInventory']);
    inventory.getExtensionsFromInventory.and.resolveTo([]);
    alerts = jasmine.createSpyObj('AlertService', ['danger']);
    TestBed.configureTestingModule({
      providers: [
        { provide: FetchClient, useValue: fetchClient },
        { provide: ExtensionInventoryService, useValue: inventory },
        { provide: AlertService, useValue: alerts }
      ]
    });
    service = TestBed.inject(ExtensionEnrichmentService);
    spyOn(console, 'error');
    spyOn(console, 'warn');
  });

  describe('getEnrichedExtensions', () => {
    it('marks extensions deployed via block metadata as loaded and counts their blocks', async () => {
      inventory.getExtensionsFromInventory.and.resolveTo([ext('Alpha'), ext('Beta')]);
      routes[METADATA_URL] = () => ok({ metadatas: ['Alpha.json'], messages: [] });
      routes[detailUrl('Alpha')] = () => ok({ analytics: [{ id: 'a.A1', name: 'A1' }, { id: 'a.A2', name: 'A2' }] });

      const [alpha, beta] = await service.getEnrichedExtensions();

      expect(alpha['loaded']).toBeTrue();
      expect(alpha['blocksCount']).toBe(2);
      expect(alpha['extensionType']).toBeUndefined();
      expect(beta['loaded']).toBeFalsy();
      expect(beta['blocksCount']).toBe(0);
      expect(count(detailUrl('Beta'))).toBe(0); // no detail fetch for undeployed extensions
    });

    it('recognizes zip extensions listed by the diagnostics endpoint', async () => {
      inventory.getExtensionsFromInventory.and.resolveTo([ext('Zipped')]);
      routes[NAMES_URL] = () => ok({ 'Zipped.zip': {} });
      routes[detailUrl('Zipped')] = () => ok({ analytics: [{ id: 'z.Z', name: 'Z' }] });

      const [zipped] = await service.getEnrichedExtensions();
      expect(zipped['loaded']).toBeTrue();
      expect(zipped['extensionType']).toBe('zip');
    });

    it('matches names regardless of ".json" suffix and strips ".zip" from inventory names', async () => {
      inventory.getExtensionsFromInventory.and.resolveTo([ext('Gamma.zip'), ext('Delta')]);
      routes[METADATA_URL] = () => ok({ metadatas: ['Gamma', 'Delta.json'], messages: [] });
      routes[detailUrl('Gamma')] = () => ok({ analytics: [] });
      routes[detailUrl('Delta')] = () => ok({ analytics: [] });

      const result = await service.getEnrichedExtensions();
      expect(result.map(e => [e['name'], e['loaded']])).toEqual([['Gamma', true], ['Delta', true]]);
    });

    it('caches the result until invalidated', async () => {
      await service.getEnrichedExtensions();
      await service.getEnrichedExtensions();
      expect(inventory.getExtensionsFromInventory).toHaveBeenCalledTimes(1);

      service.invalidateCache();
      await service.getEnrichedExtensions();
      expect(inventory.getExtensionsFromInventory).toHaveBeenCalledTimes(2);
    });

    it('rejects with a CepError without alerting, and does not cache the failure', async () => {
      routes[METADATA_URL] = () => ok({}, 502);
      await expectAsync(service.getEnrichedExtensions()).toBeRejectedWith(jasmine.any(CepError));
      expect(alerts.danger).not.toHaveBeenCalled();

      routes[METADATA_URL] = () => ok({ metadatas: [], messages: [] });
      await expectAsync(service.getEnrichedExtensions()).toBeResolved();
    });

    it('shares the block-metadata request with the deployed blocks load', async () => {
      await service.getEnrichedExtensions();
      await service.getDeployedBlocks();
      expect(count(METADATA_URL)).toBe(1);
    });
  });

  describe('getDeployedBlocks', () => {
    it('returns an empty list when nothing is deployed', async () => {
      expect(await service.getDeployedBlocks()).toEqual([]);
    });

    it('flattens blocks of all extensions, collapsing .json/.zip duplicates, with custom flag and extension name', async () => {
      routes[METADATA_URL] = () => ok({ metadatas: ['Ext1.json', 'Ext1.zip', 'Ext2.json'], messages: [] });
      routes[detailUrl('Ext1')] = () => ok({ analytics: [{ id: 'com.acme.Foo', name: 'Foo', description: 'does things' }] });
      routes[detailUrl('Ext2')] = () => ok({ analytics: [{ id: 'apama.analyticsbuilder.blocks.Add', name: 'Add' }] });

      const blocks = await service.getDeployedBlocks();

      expect(blocks.map(b => [b.id, b.extension, b.custom])).toEqual([
        ['com.acme.Foo', 'Ext1', true],
        ['apama.analyticsbuilder.blocks.Add', 'Ext2', false]
      ]);
      expect(count(detailUrl('Ext1'))).toBe(1);
    });

    it('drops malformed blocks instead of failing the load', async () => {
      routes[METADATA_URL] = () => ok({ metadatas: ['E.json'], messages: [] });
      routes[detailUrl('E')] = () => ok({ analytics: [{ id: 'a.Good', name: 'Good' }, { id: '', name: 'NoId' }, { id: 'a.NoName' }, null] });
      expect((await service.getDeployedBlocks()).map(b => b.id)).toEqual(['a.Good']);
    });

    it('skips extensions whose details cannot be loaded', async () => {
      routes[METADATA_URL] = () => ok({ metadatas: ['Bad.json', 'Good.json'], messages: [] });
      routes[detailUrl('Bad')] = () => ok({}, 500);
      routes[detailUrl('Good')] = () => ok({ analytics: [{ id: 'g.G', name: 'G' }] });
      expect((await service.getDeployedBlocks()).map(b => b.id)).toEqual(['g.G']);
    });

    it('normalizes missing optional fields', async () => {
      routes[METADATA_URL] = () => ok({ metadatas: ['E.json'], messages: [] });
      routes[detailUrl('E')] = () => ok({ analytics: [{ id: 'a.B', name: 'B' }] });
      const [block] = await service.getDeployedBlocks();
      expect(block).toEqual(jasmine.objectContaining({ file: '', type: '', url: '', downloadUrl: '', custom: true }));
    });

    it('alerts the user and does not cache when the metadata cannot be loaded', async () => {
      routes[METADATA_URL] = () => ok({}, 500);
      await expectAsync(service.getDeployedBlocks()).toBeRejectedWith(jasmine.any(CepError));
      expect(alerts.danger).toHaveBeenCalledTimes(1);

      routes[METADATA_URL] = () => ok({ metadatas: [], messages: [] });
      expect(await service.getDeployedBlocks()).toEqual([]);
    });

    describe('block categorisation', () => {
      const categoryOf = async (name: string, description = '', category?: Category) => {
        service.invalidateCache();
        routes[METADATA_URL] = () => ok({ metadatas: ['E.json'], messages: [] });
        routes[detailUrl('E')] = () => ok({ analytics: [{ id: `x.${name}`, name, description, category }] });
        return (await service.getDeployedBlocks())[0].category;
      };

      it('keeps an explicit category', async () => {
        expect(await categoryOf('Whatever', '', Category.LOGIC)).toBe(Category.LOGIC);
      });

      it('derives the category from keywords in name/description', async () => {
        expect(await categoryOf('Measurement Input')).toBe(Category.INPUT);
        expect(await categoryOf('Send Email')).toBe(Category.OUTPUT);
        expect(await categoryOf('Average')).toBe(Category.AGGREGATE);
        expect(await categoryOf('Multiply')).toBe(Category.CALCULATION);
        expect(await categoryOf('Compare')).toBe(Category.LOGIC);
        expect(await categoryOf('Delay')).toBe(Category.FLOW_MANIPULATION);
        expect(await categoryOf('Random Noise')).toBe(Category.UTILITY);
      });

      it('falls back to UTILITY, and lets earlier categories win', async () => {
        expect(await categoryOf('Zzz')).toBe(Category.UTILITY);
        expect(await categoryOf('Event Counter')).toBe(Category.INPUT); // "event" (INPUT) before "count" (AGGREGATE)
      });
    });
  });

  describe('getDeployedExtensionDetails', () => {
    it('adds the extension name and memoizes per name', async () => {
      routes[detailUrl('E')] = () => ok({ analytics: [], version: '1' });
      const first = await service.getDeployedExtensionDetails('E');
      expect(first).toEqual(jasmine.objectContaining({ name: 'E', version: '1' }));
      await service.getDeployedExtensionDetails('E');
      expect(count(detailUrl('E'))).toBe(1);
    });

    it('returns null for failures and retries on the next call', async () => {
      routes[detailUrl('E')] = () => ok({}, 404);
      expect(await service.getDeployedExtensionDetails('E')).toBeNull();
      routes[detailUrl('E')] = () => ok({ analytics: [] });
      expect(await service.getDeployedExtensionDetails('E')).not.toBeNull();
    });
  });

  describe('getExtensionNamesFromCep', () => {
    it('caches and does not cache failures', async () => {
      routes[NAMES_URL] = () => ok({}, 500);
      await expectAsync(service.getExtensionNamesFromCep()).toBeRejectedWith(jasmine.any(CepError));
      routes[NAMES_URL] = () => ok({ metadatas: ['x'], messages: [] });
      expect((await service.getExtensionNamesFromCep()).metadatas).toEqual(['x']);
      await service.getExtensionNamesFromCep();
      expect(count(NAMES_URL)).toBe(2);
    });
  });
});
