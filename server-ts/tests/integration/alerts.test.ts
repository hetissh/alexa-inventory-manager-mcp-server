import { describe, expect, it } from 'vitest';

import {
  adjust,
  confirmation,
  expectStatus,
  quantityOf,
  tokenOf,
  undo,
  useCommandHarness,
  WORKSPACE_ID,
} from '../helpers/service.js';

const harness = useCommandHarness();

async function alertsFor(status: 'open' | 'resolved' | 'all'): Promise<{ resource: string; status: string }[]> {
  const rows = await harness().store.listAlerts(WORKSPACE_ID, { status, limit: 50 });
  return rows.map((alert) => ({ resource: alert.resourceId, status: alert.status }));
}

describe('low-stock alerts', () => {
  it('"remove ten brake pads": 12 to 2 opens exactly one alert, in the same change', async () => {
    const h = harness();

    const outcome = expectStatus(await adjust(h, 'brake pads', -10), 'committed');

    expect(outcome.alerts.opened).toHaveLength(1);
    expect(outcome.alerts.opened[0]).toMatchObject({
      resourceId: 'item_brake_pads',
      rule: 'low_stock',
      status: 'open',
      message: 'Brake Pads is low on stock: 2 pieces left (reorder level 5).',
    });
    expect(outcome.alerts.resolved).toEqual([]);
    expect(outcome.spoken).toBe(
      'Removed 10. Brake Pads is now at 2 pieces. Alert: Brake Pads is low on stock: 2 pieces left (reorder level 5).',
    );
    expect(await alertsFor('open')).toEqual([{ resource: 'item_brake_pads', status: 'open' }]);
  });

  it('does not raise a second alert while stock stays low', async () => {
    const h = harness();
    await adjust(h, 'brake pads', -8);

    const further = expectStatus(await adjust(h, 'brake pads', -2), 'committed');

    expect(further.alerts.opened).toEqual([]);
    expect(await alertsFor('all')).toHaveLength(1);
  });

  it('clears by itself when stock is replenished, and says so', async () => {
    const h = harness();
    await adjust(h, 'brake pads', -10);

    const restock = expectStatus(await adjust(h, 'brake pads', 10), 'committed');

    expect(restock.alerts.resolved).toHaveLength(1);
    expect(restock.spoken).toBe('Added 10. Brake Pads is now at 12 pieces. Alert cleared for Brake Pads.');
    expect(await alertsFor('open')).toEqual([]);
    expect(await alertsFor('resolved')).toEqual([{ resource: 'item_brake_pads', status: 'resolved' }]);
  });

  it('is fine exactly at the reorder level: the alert is for strictly below it', async () => {
    const h = harness();

    const outcome = expectStatus(await adjust(h, 'brake pads', -7), 'committed');

    expect(await quantityOf(h, 'item_brake_pads')).toBe(5);
    expect(outcome.alerts.opened).toEqual([]);
  });

  it('opens a fresh alert if stock drops again after it was cleared', async () => {
    const h = harness();
    await adjust(h, 'brake pads', -10);
    await adjust(h, 'brake pads', 10);

    const again = expectStatus(await adjust(h, 'brake pads', -10), 'committed');

    expect(again.alerts.opened).toHaveLength(1);
    expect((await alertsFor('all')).map((alert) => alert.status).sort()).toEqual(['open', 'resolved']);
  });

  it('raises exactly one alert when two removals race across the threshold', async () => {
    const h = harness();

    await Promise.all([adjust(h, 'brake pads', -4), adjust(h, 'brake pads', -4)]);

    expect(await quantityOf(h, 'item_brake_pads')).toBe(4);
    expect(await alertsFor('open')).toHaveLength(1);
  });

  it('is not raised by a change that is still waiting for a yes, only once it is applied', async () => {
    const h = harness();
    const token = tokenOf(await adjust(h, 'brake pads', -12));
    expect(await alertsFor('all')).toEqual([]);

    const done = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, token)), 'committed');

    expect(done.alerts.opened).toHaveLength(1);
    expect(done.alerts.opened[0]?.message).toBe('Brake Pads is low on stock: 0 pieces left (reorder level 5).');
  });

  it('follows an undo: undoing the removal clears the alert', async () => {
    const h = harness();
    await adjust(h, 'brake pads', -10);
    const asked = tokenOf(await undo(h));

    const done = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, asked)), 'committed');

    expect(done.alerts.resolved).toHaveLength(1);
    expect(await alertsFor('open')).toEqual([]);
    expect(await quantityOf(h, 'item_brake_pads')).toBe(12);
  });

  it('does not apply to items that stay above their level, or to non-inventory resources', async () => {
    const h = harness();
    const outcome = expectStatus(await adjust(h, 'air filters', -5), 'committed');
    expect(outcome.alerts).toEqual({ opened: [], resolved: [] });
    expect(await alertsFor('all')).toEqual([]);
  });
});
