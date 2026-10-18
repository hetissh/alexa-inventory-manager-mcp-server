import { describe, expect, it } from 'vitest';

import { reverseEvent } from '../../src/domain/operations/reverseEvent.js';
import type { Resource } from '../../src/domain/schemas.js';
import type { EventRecord } from '../../src/domain/types.js';
import { planFor } from '../helpers/plan.js';
import { inventoryItem } from '../helpers/resources.js';

const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  eventId: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60',
  seq: 1,
  workspaceId: 'northside-warehouse',
  commandId: 'cmd-1',
  resourceId: 'item_air_filter',
  resourceName: 'Air Filter',
  operation: 'ADJUST_QUANTITY',
  arguments: { delta: 20 },
  before: { quantity: 35 },
  after: { quantity: 55 },
  summary: 'Added 20 pieces to Air Filter (35 to 55)',
  actor: 'manager-1',
  source: 'mcp',
  clientName: null,
  createdAt: new Date('2026-10-18T10:00:00.000Z'),
  reversalOf: null,
  ...overrides,
});

const airFilterAt = (quantity: number): Resource => inventoryItem('item_air_filter', 'Air Filter', [], quantity);

describe('reverseEvent', () => {
  it('targets the actor\'s last change rather than a named resource, and takes no arguments', () => {
    expect(reverseEvent.name).toBe('REVERSE_EVENT');
    expect(reverseEvent.targetsLastEvent).toBe(true);
    expect(reverseEvent.bind({}).ok).toBe(true);
  });

  it('restores the earlier values and asks for confirmation', () => {
    expect(planFor(reverseEvent, airFilterAt(55), {}, { reversing: event() })).toEqual({
      kind: 'ready',
      attributes: { quantity: 35, unit: 'pieces', reorderLevel: 5 },
      before: { quantity: 55 },
      after: { quantity: 35 },
      summary: 'Undid: Added 20 pieces to Air Filter (35 to 55)',
      spoken: 'Undone: Added 20 pieces to Air Filter (35 to 55).',
      confirmation: { reason: 'undo', readback: 'Undo "Added 20 pieces to Air Filter (35 to 55)"?' },
      reversesEventId: '0b7c3f5e-6d0a-4f0e-9a52-1b2d3c4e5f60',
    });
  });

  it('says there is nothing to undo when there is no event', () => {
    expect(planFor(reverseEvent, airFilterAt(55), {})).toEqual({
      kind: 'rejected',
      code: 'NOTHING_TO_UNDO',
      message: 'There is nothing to undo.',
    });
  });

  it('refuses when the resource has changed since, so a later change is not overwritten', () => {
    expect(planFor(reverseEvent, airFilterAt(60), {}, { reversing: event() })).toEqual({
      kind: 'rejected',
      code: 'STATE_CHANGED',
      message: 'Air Filter has changed since "Added 20 pieces to Air Filter (35 to 55)", so it cannot be undone safely.',
    });
  });

  it('treats an attribute the resource no longer has as a change', () => {
    expect(planFor(reverseEvent, airFilterAt(55), {}, { reversing: event({ after: { colour: 'red' }, before: { colour: 'blue' } }) })).toMatchObject({
      kind: 'rejected',
      code: 'STATE_CHANGED',
    });
  });
});
