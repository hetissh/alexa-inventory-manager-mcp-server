import { describe, expect, it } from 'vitest';

import type { AlertChanges } from '../../src/app/outcomes.js';
import {
  spokenAlertList,
  spokenAmbiguous,
  spokenBoard,
  spokenCommitted,
  spokenEvents,
  spokenNotFound,
  spokenReplayed,
  spokenResource,
  spokenWorkspace,
} from '../../src/app/spoken.js';
import type { Candidate } from '../../src/domain/matcher.js';
import type { AlertRecord } from '../../src/domain/types.js';
import { cafeResources, makeResource, repairResources, warehouseResources } from '../helpers/resources.js';

const NO_ALERTS: AlertChanges = { opened: [], resolved: [] };

const alertRecord = (overrides: Partial<AlertRecord> = {}): AlertRecord => ({
  alertId: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60',
  workspaceId: 'northside-warehouse',
  resourceId: 'item_brake_pads',
  resourceName: 'Brake Pads',
  rule: 'low_stock',
  status: 'open',
  message: 'Brake Pads is low on stock: 2 pieces left (reorder level 5).',
  createdAt: new Date(),
  resolvedAt: null,
  ...overrides,
});

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
    expect(spokenCommitted('Added 20.', state, NO_ALERTS)).toBe(`Added 20.${suffix}`);
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

  it('describes menu items, jobs and technicians', () => {
    const find = (resources: ReturnType<typeof cafeResources>, id: string) => resources.find((r) => r.id === id);
    const biryani = find(cafeResources(), 'menu_chicken_biryani');
    const job = find(repairResources(), 'job_108');
    const rahul = find(repairResources(), 'tech_rahul');
    const vikram = find(repairResources(), 'tech_vikram');
    expect(biryani && spokenResource(biryani)).toBe('Chicken Biryani (260 INR) is available.');
    expect(job && spokenResource(job)).toBe('Job 108 (Brake overhaul) is waiting.');
    expect(rahul && spokenResource(rahul)).toBe('Rahul is on duty.');
    expect(vikram && spokenResource(vikram)).toBe('Vikram is not on duty.');
  });

  it('mentions alerts a change opened or cleared, before the spreadsheet state', () => {
    const changes: AlertChanges = {
      opened: [alertRecord()],
      resolved: [alertRecord({ resourceName: 'Air Filter', status: 'resolved' })],
    };
    expect(spokenCommitted('Removed 10.', 'pending', changes)).toBe(
      'Removed 10. Alert: Brake Pads is low on stock: 2 pieces left (reorder level 5). Alert cleared for Air Filter. The spreadsheet update is pending.',
    );
  });

  it('describes alert lists, the board and a workspace', () => {
    expect(spokenAlertList(0, 'open')).toBe('There are no open alerts.');
    expect(spokenAlertList(1, 'open')).toBe('There is 1 open alert.');
    expect(spokenAlertList(3, 'resolved')).toBe('There are 3 resolved alerts.');
    expect(spokenAlertList(2, 'all')).toBe('There are 2 alerts.');
    expect(spokenBoard('Northside Operations', [{ label: 'Low stock', value: 1 }, { label: 'Equipment down', value: 0 }])).toBe(
      'Northside Operations: Low stock 1, Equipment down 0.',
    );
    expect(spokenWorkspace('Harbor Cafe', 'Cafe / restaurant', 5)).toBe(
      'Harbor Cafe is a cafe / restaurant workspace with 5 resources.',
    );
  });
});
