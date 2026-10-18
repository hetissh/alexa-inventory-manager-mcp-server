import { describe, expect, it } from 'vitest';

import {
  diceCoefficient,
  rankResources,
  resolveResource,
  toCandidate,
} from '../../src/domain/matcher.js';
import { inventoryItem, warehouseResources } from '../helpers/resources.js';

const writes = { autoResolveFuzzy: false } as const;
const reads = { autoResolveFuzzy: true } as const;

function resolvedId(query: string, options = writes): string | undefined {
  const resolution = resolveResource(query, warehouseResources(), options);
  return resolution.kind === 'resolved' ? resolution.match.resource.id : undefined;
}

describe('diceCoefficient', () => {
  it('is 1 for identical strings and 0 when strings are too short to compare', () => {
    expect(diceCoefficient('air filter', 'air filter')).toBe(1);
    expect(diceCoefficient('a', 'ab')).toBe(0);
    expect(diceCoefficient('ab', 'a')).toBe(0);
  });

  it('matches the textbook example', () => {
    expect(diceCoefficient('night', 'nacht')).toBeCloseTo(0.25, 5);
  });

  it('counts repeated bigrams once per occurrence', () => {
    expect(diceCoefficient('aaaa', 'aa')).toBeCloseTo((2 * 1) / (3 + 1), 5);
  });
});

describe('resolveResource: exact tiers', () => {
  it('resolves by id, ignoring case and surrounding whitespace', () => {
    const resolution = resolveResource('  ITEM_AIR_FILTER ', warehouseResources(), writes);
    expect(resolution).toMatchObject({ kind: 'resolved', match: { matchedBy: 'id', score: 1 } });
    expect(resolvedId('item_air_filter')).toBe('item_air_filter');
  });

  it('resolves by name regardless of plural or case', () => {
    expect(resolveResource('Air Filters', warehouseResources(), writes)).toMatchObject({
      kind: 'resolved',
      match: { matchedBy: 'name' },
    });
    expect(resolvedId('air filters')).toBe('item_air_filter');
  });

  it('resolves by alias', () => {
    expect(resolveResource('brake pad set', warehouseResources(), writes)).toMatchObject({
      kind: 'resolved',
      match: { matchedBy: 'alias', resource: { id: 'item_brake_pads' } },
    });
  });

  it('understands spoken numbers', () => {
    expect(resolvedId('compressor two')).toBe('equipment_compressor_2');
  });

  it('treats a name match on one resource and an alias match on another as ambiguous', () => {
    const resources = [inventoryItem('item_filter', 'Filter'), inventoryItem('item_screen', 'Screen', ['filter'])];
    const resolution = resolveResource('filter', resources, writes);
    expect(resolution.kind).toBe('ambiguous');
  });
});

describe('resolveResource: partial names', () => {
  it('resolves a unique partial name', () => {
    expect(resolveResource('brake', warehouseResources(), writes)).toMatchObject({
      kind: 'resolved',
      match: { matchedBy: 'tokens', resource: { id: 'item_brake_pads' } },
    });
    expect(resolvedId('pads')).toBe('item_brake_pads');
  });

  it('is order-insensitive', () => {
    expect(resolvedId('pads brake')).toBe('item_brake_pads');
  });

  it('returns every candidate when a partial name matches several resources', () => {
    const resolution = resolveResource('filter', warehouseResources(), writes);
    expect(resolution.kind).toBe('ambiguous');
    if (resolution.kind === 'ambiguous') {
      expect(resolution.candidates.map((candidate) => candidate.name)).toEqual(['Air Filter', 'Oil Filter']);
      expect(resolution.candidates.every((candidate) => candidate.matchedBy === 'tokens')).toBe(true);
    }
  });

  it('caps the candidate list at five', () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      inventoryItem(`item_widget_${String(index)}`, `Widget ${String(index)}`),
    );
    const resolution = resolveResource('widget', many, writes);
    expect(resolution.kind === 'ambiguous' && resolution.candidates).toHaveLength(5);
  });

  it('does not match when the query has words the resource lacks', () => {
    expect(resolveResource('air filter 2', warehouseResources(), writes).kind).toBe('not_found');
  });

  it('never treats a different number as a typo: "compressor three" is not Compressor 2', () => {
    expect(resolveResource('compressor three', warehouseResources(), reads)).toEqual({ kind: 'not_found' });
    expect(resolveResource('compressor 3', warehouseResources(), reads)).toEqual({ kind: 'not_found' });
    expect(resolveResource('air filter 2', warehouseResources(), reads)).toEqual({ kind: 'not_found' });
  });
});

describe('resolveResource: typos', () => {
  it('lets reads auto-resolve a unique high-confidence typo and reports it as fuzzy', () => {
    expect(resolveResource('air filtr', warehouseResources(), reads)).toMatchObject({
      kind: 'resolved',
      match: { matchedBy: 'fuzzy', resource: { id: 'item_air_filter' } },
    });
  });

  it('never lets writes auto-resolve a typo: it asks instead', () => {
    const resolution = resolveResource('air filtr', warehouseResources(), writes);
    expect(resolution).toMatchObject({ kind: 'ambiguous', candidates: [{ id: 'item_air_filter', matchedBy: 'fuzzy' }] });
  });

  it('suggests, but does not auto-resolve, a weaker typo even for reads', () => {
    const resolution = resolveResource('break pads', warehouseResources(), reads);
    expect(resolution).toMatchObject({ kind: 'ambiguous', candidates: [{ id: 'item_brake_pads' }] });
  });

  it('stays ambiguous when two resources are equally close', () => {
    const resources = [inventoryItem('item_valve_alpha', 'Valve Alpha'), inventoryItem('item_valve_alpho', 'Valve Alpho')];
    const resolution = resolveResource('valve alphe', resources, reads);
    expect(resolution.kind === 'ambiguous' && resolution.candidates.map((c) => c.id)).toEqual([
      'item_valve_alpha',
      'item_valve_alpho',
    ]);
  });

  it('auto-resolves when the best typo match clearly beats the runner-up', () => {
    const resources = [inventoryItem('item_air_filter', 'Air Filter'), inventoryItem('item_air_filtering', 'Air Filtering Unit')];
    expect(resolveResource('air filtr', resources, reads)).toMatchObject({
      kind: 'resolved',
      match: { resource: { id: 'item_air_filter' } },
    });
  });
});

describe('resolveResource: nothing to match', () => {
  it.each(['forklift', '', '   ', '!!!'])('returns not_found for %j', (query) => {
    expect(resolveResource(query, warehouseResources(), reads)).toEqual({ kind: 'not_found' });
  });

  it('returns not_found when there are no resources', () => {
    expect(resolveResource('air filter', [], reads)).toEqual({ kind: 'not_found' });
  });
});

describe('rankResources', () => {
  it('lists each matching resource once, best first', () => {
    const ranked = rankResources('air', warehouseResources());
    expect(ranked.map((entry) => entry.resource.id)).toEqual(['item_air_filter', 'equipment_compressor_2']);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 1);
  });

  it('puts exact matches ahead of partial ones', () => {
    const resources = [inventoryItem('item_oil_filter_xl', 'Oil Filter XL'), inventoryItem('item_oil_filter', 'Oil Filter')];
    expect(rankResources('oil filter', resources).map((entry) => entry.resource.id)).toEqual([
      'item_oil_filter',
      'item_oil_filter_xl',
    ]);
  });

  it('returns nothing for an empty query', () => {
    expect(rankResources('  ', warehouseResources())).toEqual([]);
  });
});

describe('toCandidate', () => {
  it('projects a ranked resource to a user-safe summary', () => {
    const [ranked] = rankResources('brake pads', warehouseResources());
    expect(ranked && toCandidate(ranked)).toEqual({
      id: 'item_brake_pads',
      name: 'Brake Pads',
      type: 'inventory_item',
      matchedBy: 'name',
      score: 1,
    });
  });
});
