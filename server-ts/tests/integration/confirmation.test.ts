import { describe, expect, it } from 'vitest';

import { ALREADY_UNDONE_MESSAGE, DUPLICATE_MESSAGE, STALE_MESSAGE } from '../../src/app/commit.js';
import { hashToken } from '../../src/app/confirmationCode.js';
import { AlreadyReversedError } from '../../src/app/errors.js';
import type { Store } from '../../src/app/ports.js';
import {
  ACTOR,
  adjust,
  attributesOf,
  boardVersion,
  CAFE_ID,
  commandStatus,
  confirmation,
  eventCount,
  expectStatus,
  quantityOf,
  request,
  setStatus,
  tokenOf,
  TTL_SECONDS,
  useCommandHarness,
  WORKSPACE_ID,
} from '../helpers/service.js';

const harness = useCommandHarness();

describe('a status change waits for a yes', () => {
  it('does nothing until it is confirmed, and says exactly what it will do', async () => {
    const h = harness();

    const outcome = expectStatus(await setStatus(h, WORKSPACE_ID, 'compressor two', 'under maintenance'), 'confirmation_required');

    expect(outcome.spoken).toBe('Mark Compressor 2 as under maintenance (currently available)?');
    expect(outcome.confirmation).toEqual({
      token: `${'t'.repeat(21)}1`,
      readback: 'Mark Compressor 2 as under maintenance (currently available)?',
      reason: 'status_change',
      expiresAt: new Date(h.clock.current.getTime() + TTL_SECONDS * 1000),
    });
    expect(await attributesOf(h, WORKSPACE_ID, 'equipment_compressor_2')).toEqual({ status: 'available' });
    expect(await eventCount(h)).toBe(0);
    expect(await boardVersion(h)).toBe(0);
  });

  it('stores only a hash of the token', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));

    const rows = await h.pool.query<Record<string, unknown>>('SELECT * FROM commands');

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.['token_hash']).toBe(hashToken(token));
    expect(JSON.stringify(rows.rows[0])).not.toContain(token);
  });

  it('applies the change once confirmed, with a full audit record', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'under maintenance'));

    const done = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, token)), 'committed');

    expect(done).toMatchObject({
      replayed: false,
      spoken: 'Compressor 2 is now under maintenance.',
      resource: { id: 'equipment_compressor_2', version: 2, attributes: { status: 'maintenance' } },
      event: {
        operation: 'SET_STATUS',
        before: { status: 'available' },
        after: { status: 'maintenance' },
        summary: 'Changed Compressor 2 from available to under maintenance',
        actor: ACTOR,
        source: 'mcp',
        clientName: 'test-client',
      },
    });
    expect(await attributesOf(h, WORKSPACE_ID, 'equipment_compressor_2')).toEqual({ status: 'maintenance' });
    expect(await eventCount(h)).toBe(1);
    expect(await boardVersion(h)).toBe(1);
    expect(await commandStatus(h, token)).toBe('confirmed');
  });

  it('works for a cafe menu item too: same engine, different workspace', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, CAFE_ID, 'chicken biryani', 'sold out'));

    const done = expectStatus(await h.service.confirm(confirmation(CAFE_ID, token)), 'committed');

    expect(done.resource.attributes).toEqual({ price: 260, currency: 'INR', status: 'sold_out' });
    expect(done.spoken).toBe('Chicken Biryani is now sold out.');
  });

  it('returns the original result when the same confirmation arrives again', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));
    const first = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, token)), 'committed');

    const second = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, token)), 'committed');

    expect(second.replayed).toBe(true);
    expect(second.event.eventId).toBe(first.event.eventId);
    expect(await eventCount(h)).toBe(1);
  });

  it('applies exactly once when two confirmations arrive at the same moment', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));

    const [a, b] = await Promise.all([
      h.service.confirm(confirmation(WORKSPACE_ID, token)),
      h.service.confirm(confirmation(WORKSPACE_ID, token)),
    ]);

    expect([expectStatus(a, 'committed').replayed, expectStatus(b, 'committed').replayed].sort()).toEqual([false, true]);
    expect(await eventCount(h)).toBe(1);
    expect(await boardVersion(h)).toBe(1);
  });

  it('can be re-proposed with the same key: whichever confirmation comes first wins, the other replays', async () => {
    const h = harness();
    const first = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance', { commandId: 'same-key-1' }));
    const second = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance', { commandId: 'same-key-1' }));
    expect(second).not.toBe(first);

    const applied = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, second)), 'committed');
    const replayed = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, first)), 'committed');

    expect(applied.replayed).toBe(false);
    expect(replayed).toMatchObject({ replayed: true, event: { eventId: applied.event.eventId } });
    expect(await eventCount(h)).toBe(1);
  });

  it('asking again with the same key after it was applied just replays it', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance', { commandId: 'same-key-2' }));
    await h.service.confirm(confirmation(WORKSPACE_ID, token));

    const again = await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance', { commandId: 'same-key-2' });

    expect(expectStatus(again, 'committed').replayed).toBe(true);
    expect(await eventCount(h)).toBe(1);
  });

  it('refuses at the first step a status that is invalid, already set, or ambiguous: no token is issued', async () => {
    const h = harness();

    expect(await setStatus(h, WORKSPACE_ID, 'compressor two', 'sold out')).toMatchObject({ status: 'rejected', code: 'INVALID_STATUS' });
    expect(await setStatus(h, WORKSPACE_ID, 'compressor two', 'available')).toMatchObject({ status: 'rejected', code: 'NO_CHANGE' });
    expect(await setStatus(h, CAFE_ID, 'biryani', 'sold out')).toMatchObject({
      status: 'ambiguous',
      candidates: [{ name: 'Chicken Biryani' }, { name: 'Veg Biryani' }],
    });
    expect(await setStatus(h, WORKSPACE_ID, 'forklift', 'maintenance')).toMatchObject({ status: 'not_found' });
    expect((await h.pool.query('SELECT 1 FROM commands')).rowCount).toBe(0);
  });
});

describe('a large or zeroing stock change waits for a yes', () => {
  it('asks first for a large addition, then applies it', async () => {
    const h = harness();

    const asked = expectStatus(await adjust(h, 'air filters', 100), 'confirmation_required');

    expect(asked.confirmation).toMatchObject({
      reason: 'large_adjustment',
      readback: 'Added 100 pieces to Air Filter (35 to 135)?',
    });
    expect(await quantityOf(h, 'item_air_filter')).toBe(35);

    const done = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, asked.confirmation.token)), 'committed');
    expect(done.spoken).toBe('Added 100. Air Filter is now at 135 pieces.');
    expect(await quantityOf(h, 'item_air_filter')).toBe(135);
  });

  it('asks first when a removal would leave nothing', async () => {
    const h = harness();
    const asked = expectStatus(await adjust(h, 'brake pads', -12), 'confirmation_required');
    expect(asked.confirmation.reason).toBe('reaches_zero');
    expect(await quantityOf(h, 'item_brake_pads')).toBe(12);
  });
});

describe('declining, expiring and going stale', () => {
  it('cancelling discards the change, and cancelling twice is harmless', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));

    expect(await h.service.cancel(confirmation(WORKSPACE_ID, token))).toEqual({
      status: 'cancelled',
      spoken: 'Okay, cancelled. Nothing was changed.',
    });
    expect((await h.service.cancel(confirmation(WORKSPACE_ID, token))).status).toBe('cancelled');
    expect(await commandStatus(h, token)).toBe('cancelled');
    expect(await attributesOf(h, WORKSPACE_ID, 'equipment_compressor_2')).toEqual({ status: 'available' });
    expect(await eventCount(h)).toBe(0);
  });

  it('a cancelled change can no longer be confirmed', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));
    await h.service.cancel(confirmation(WORKSPACE_ID, token));

    expect(await h.service.confirm(confirmation(WORKSPACE_ID, token))).toMatchObject({
      status: 'rejected',
      code: 'CONFIRMATION_CANCELLED',
    });
    expect(await eventCount(h)).toBe(0);
  });

  it('an applied change cannot be cancelled: it points to undo instead', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));
    await h.service.confirm(confirmation(WORKSPACE_ID, token));

    expect(await h.service.cancel(confirmation(WORKSPACE_ID, token))).toMatchObject({
      status: 'rejected',
      code: 'ALREADY_CONFIRMED',
      message: expect.stringContaining('undo-last-change') as string,
    });
  });

  it('stops working after the time limit, and stays expired', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));
    h.clock.advance(TTL_SECONDS);

    const late = await h.service.confirm(confirmation(WORKSPACE_ID, token));

    expect(late).toMatchObject({ status: 'rejected', code: 'CONFIRMATION_EXPIRED' });
    expect(await commandStatus(h, token)).toBe('expired');
    expect(await h.service.confirm(confirmation(WORKSPACE_ID, token))).toMatchObject({ code: 'CONFIRMATION_EXPIRED' });
    expect((await h.service.cancel(confirmation(WORKSPACE_ID, token))).status).toBe('cancelled');
    expect(await attributesOf(h, WORKSPACE_ID, 'equipment_compressor_2')).toEqual({ status: 'available' });
  });

  it('still works one second before the time limit', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));
    h.clock.advance(TTL_SECONDS - 1);

    expect((await h.service.confirm(confirmation(WORKSPACE_ID, token))).status).toBe('committed');
  });

  it('applies nothing if the item changed after the question was asked', async () => {
    const h = harness();
    const stale = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));
    const other = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'out of service'));
    await h.service.confirm(confirmation(WORKSPACE_ID, other));

    const outcome = await h.service.confirm(confirmation(WORKSPACE_ID, stale));

    expect(outcome).toEqual({ status: 'conflict', message: STALE_MESSAGE, spoken: STALE_MESSAGE });
    expect(await commandStatus(h, stale)).toBe('expired');
    expect(await attributesOf(h, WORKSPACE_ID, 'equipment_compressor_2')).toEqual({ status: 'out_of_service' });
    expect(await eventCount(h)).toBe(1);
  });

  it('reports a conflict if the idempotency key was used by a different request in the meantime', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance', { commandId: 'clash-key-1' }));
    await adjust(h, 'oil filters', 5, { commandId: 'clash-key-1' });

    const outcome = await h.service.confirm(confirmation(WORKSPACE_ID, token));

    expect(outcome).toMatchObject({ status: 'conflict', message: DUPLICATE_MESSAGE });
    expect(await commandStatus(h, token)).toBe('cancelled');
    expect(await attributesOf(h, WORKSPACE_ID, 'equipment_compressor_2')).toEqual({ status: 'available' });
  });
});

describe('only the person who asked can confirm', () => {
  it('treats an unknown token, another person and another workspace the same: not valid', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'maintenance'));

    for (const attempt of [
      h.service.confirm(confirmation(WORKSPACE_ID, 'z'.repeat(22))),
      h.service.confirm(confirmation(WORKSPACE_ID, token, 'someone-else')),
      h.service.confirm(confirmation(CAFE_ID, token)),
      h.service.cancel(confirmation(WORKSPACE_ID, token, 'someone-else')),
      h.service.cancel(confirmation(WORKSPACE_ID, 'z'.repeat(22))),
    ]) {
      expect(await attempt).toMatchObject({ status: 'rejected', code: 'UNKNOWN_CONFIRMATION' });
    }
    expect(await commandStatus(h, token)).toBe('pending');
    expect(await eventCount(h)).toBe(0);

    expect((await h.service.confirm(confirmation(WORKSPACE_ID, token))).status).toBe('committed');
  });

  it('refuses to confirm in a workspace that does not exist', async () => {
    await expect(harness().service.confirm(confirmation('no-such-workspace', 'z'.repeat(22)))).rejects.toThrow(
      /was not found/,
    );
    await expect(harness().service.cancel(confirmation('no-such-workspace', 'z'.repeat(22)))).rejects.toThrow(
      /was not found/,
    );
  });
});

describe('damaged or inconsistent pending changes', () => {
  async function insertCommand(token: string, overrides: Record<string, unknown> = {}): Promise<void> {
    const h = harness();
    const row = {
      token_hash: hashToken(token),
      workspace_id: WORKSPACE_ID,
      command_id: 'crafted-1',
      actor: ACTOR,
      source: 'mcp',
      operation: 'SET_STATUS',
      resource_id: 'equipment_compressor_2',
      request_args: JSON.stringify({ status: 'maintenance' }),
      expected_version: 1,
      reason: 'status_change',
      readback: 'Mark Compressor 2 as under maintenance?',
      status: 'pending',
      expires_at: new Date(h.clock.current.getTime() + 60_000),
      ...overrides,
    };
    const columns = Object.keys(row);
    await h.pool.query(
      `INSERT INTO commands (${columns.join(', ')}) VALUES (${columns.map((_, index) => `$${String(index + 1)}`).join(', ')})`,
      Object.values(row),
    );
  }

  it('cancels a pending change whose arguments are no longer valid', async () => {
    const token = 'a'.repeat(22);
    await insertCommand(token, { request_args: JSON.stringify({}) });

    expect(await harness().service.confirm(confirmation(WORKSPACE_ID, token))).toMatchObject({
      status: 'rejected',
      code: 'INVALID_ARGUMENT',
    });
    expect(await commandStatus(harness(), token)).toBe('cancelled');
  });

  it('does not claim success for a change marked confirmed that has no event', async () => {
    const token = 'b'.repeat(22);
    await insertCommand(token, { status: 'confirmed' });

    expect(await harness().service.confirm(confirmation(WORKSPACE_ID, token))).toMatchObject({
      status: 'rejected',
      code: 'ALREADY_CONFIRMED',
    });
  });
});

describe('mapping of "already used" database errors', () => {
  it('reports a conflict if the event being undone was undone concurrently', async () => {
    const h = harness();
    const racing: Store = {
      ...h.store,
      withTransaction: (work) =>
        h.store.withTransaction((tx) =>
          work({ ...tx, insertEvent: () => Promise.reject(new AlreadyReversedError('some-event')) }),
        ),
    };

    const outcome = await h.serviceWith(racing).execute(request(WORKSPACE_ID, 'ADJUST_QUANTITY', 'air filters', { delta: 1 }));

    expect(outcome).toEqual({ status: 'conflict', message: ALREADY_UNDONE_MESSAGE, spoken: ALREADY_UNDONE_MESSAGE });
  });
});
