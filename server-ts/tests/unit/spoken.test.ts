import { describe, expect, it } from 'vitest';

import {
  spokenAmbiguous,
  spokenCommitted,
  spokenEvents,
  spokenNotFound,
  spokenReplayed,
  spokenResource,
} from '../../src/app/spoken.js';
import type { Candidate } from '../../src/domain/matcher.js';
import { makeResource, warehouseResources } from '../helpers/resources.js';

const candidate = (name: string): Candidate => ({
  id: name.toLowerCase().replaceAll(' ', '_'),
  name,
  type: 'inventory_item',
  matchedBy: 'tokens',
  score: 0.5,
});

describe('spoken sentences', () => {
  it('says when nothing was found', () => {
    expect(spokenNotFound('forklift')).toBe('I couldn\'t find "forklift" in this workspace.');
  });

  it('lists several candidates and asks which one', () => {
    expect(spokenAmbiguous('filter', [candidate('Air Filter'), candidate('Oil Filter')])).toBe(
      'I found several matches for "filter": Air Filter, Oil Filter. Which one do you mean?',
    );
  });

  it('suggests a single near-match as a question', () => {
    expect(spokenAmbiguous('air filtr', [candidate('Air Filter')])).toBe(
      'I couldn\'t find an exact match for "air filtr". Did you mean Air Filter?',
    );
  });

  it.each([
    ['not_configured', ''],
    ['pending', ' The spreadsheet update is pending.'],
    ['in_progress', ' The spreadsheet update is pending.'],
    ['retrying', ' The spreadsheet update is being retried.'],
    ['failed', ' The spreadsheet update failed.'],
    ['synced', ' The spreadsheet is up to date.'],
  ] as const)('reports spreadsheet state %s truthfully', (state, suffix) => {
    expect(spokenCommitted('Added 20.', state)).toBe(`Added 20.${suffix}`);
    expect(spokenReplayed('Added 20 to Air Filter', state)).toBe(
      `This request was already applied earlier: Added 20 to Air Filter.${suffix}`,
    );
  });

  it('describes inventory and equipment', () => {
    const [airFilter] = warehouseResources();
    expect(airFilter && spokenResource(airFilter)).toBe('Air Filter: 35 pieces in stock (reorder at 10).');
    const brokenCompressor = makeResource({
      id: 'equipment_compressor_2',
      type: 'equipment',
      name: 'Compressor 2',
      aliases: [],
      attributes: { status: 'out_of_service' },
    });
    expect(spokenResource(brokenCompressor)).toBe('Compressor 2 is out of service.');
  });

  it('describes how many events are shown', () => {
    expect(spokenEvents(0)).toBe('No changes have been recorded yet.');
    expect(spokenEvents(1)).toBe('Here is the most recent change.');
    expect(spokenEvents(3)).toBe('Here are the 3 most recent changes.');
  });
});
