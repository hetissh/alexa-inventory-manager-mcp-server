import { describe, expect, it } from 'vitest';

import type { Store } from '../../src/app/ports.js';
import { inventoryItem } from '../helpers/resources.js';
import {
  ACTOR,
  adjust,
  assign,
  attributesOf,
  boardVersion,
  confirmation,
  eventCount,
  expectStatus,
  quantityOf,
  REPAIR_ID,
  request,
  setStatus,
  tokenOf,
  undo,
  useCommandHarness,
  WORKSPACE_ID,
} from '../helpers/service.js';

const harness = useCommandHarness();

describe('assign a job to a technician', () => {
  it('"assign job one oh eight to Rahul": asks first, then assigns and moves the job on', async () => {
    const h = harness();

    const asked = expectStatus(await assign(h, 'job one oh eight', 'rahul'), 'confirmation_required');

    expect(asked.confirmation).toMatchObject({ reason: 'assignment', readback: 'Assign Job 108 to Rahul?' });
    expect(await attributesOf(h, REPAIR_ID, 'job_108')).toMatchObject({ status: 'waiting', assigneeId: null });

    const done = expectStatus(await h.service.confirm(confirmation(REPAIR_ID, asked.confirmation.token)), 'committed');
    expect(done).toMatchObject({
      spoken: 'Job 108 is now assigned to Rahul.',
      resource: { id: 'job_108', attributes: { status: 'assigned', assigneeId: 'tech_rahul' } },
      event: {
        operation: 'ASSIGN_JOB',
        arguments: { assignee: 'rahul' },
        before: { assigneeId: null, status: 'waiting' },
        after: { assigneeId: 'tech_rahul', status: 'assigned' },
        summary: 'Assigned Job 108 to Rahul',
      },
    });
    expect(await boardVersion(h, REPAIR_ID)).toBe(1);
  });

  it('reassigns a job that someone already has and says who had it', async () => {
    const h = harness();
    const asked = expectStatus(await assign(h, 'job 109', 'Rahul'), 'confirmation_required');
    expect(asked.confirmation.readback).toBe('Reassign Job 109 from Priya to Rahul?');

    const done = expectStatus(await h.service.confirm(confirmation(REPAIR_ID, asked.confirmation.token)), 'committed');
    expect(done.resource.attributes).toMatchObject({ status: 'in_progress', assigneeId: 'tech_rahul' });
  });

  it.each([
    ['a technician who is off duty', 'job 108', 'Vikram', 'INVALID_ASSIGNEE'],
    ['a job that is already done', 'job 107', 'Rahul', 'JOB_CLOSED'],
    ['the technician who already has it', 'job 109', 'Priya', 'NO_CHANGE'],
  ])('refuses straight away: %s (no confirmation is requested)', async (_label, job, assignee, code) => {
    const h = harness();
    expect(await assign(h, job, assignee)).toMatchObject({ status: 'rejected', code });
    expect((await h.pool.query('SELECT 1 FROM commands')).rowCount).toBe(0);
  });

  it('asks which job when the name is ambiguous', async () => {
    const outcome = await assign(harness(), 'job', 'Rahul');
    expect(outcome).toMatchObject({ status: 'ambiguous', query: 'job' });
    expect(outcome.status === 'ambiguous' && outcome.role).toBeUndefined();
  });

  it('says it is the technician it could not find, not the job', async () => {
    const h = harness();
    expect(await assign(h, 'job 108', 'Zed')).toMatchObject({
      status: 'not_found',
      query: 'Zed',
      role: 'assignee',
    });
    expect(await assign(h, 'job 108', 'rahulx')).toMatchObject({
      status: 'ambiguous',
      role: 'assignee',
      spoken: 'I couldn\'t find an exact match for "rahulx". Did you mean Rahul?',
    });
  });

  describe('when another technician shares the first name', () => {
    async function addRahulIyer(): Promise<void> {
      await harness().pool.query(
        `INSERT INTO resources (workspace_id, id, type, name, aliases, attributes)
         VALUES ($1, 'tech_rahul_iyer', 'technician', 'Rahul Iyer', '{}', '{"active": true}')`,
        [REPAIR_ID],
      );
    }

    it('an exact name beats a longer name that merely contains it', async () => {
      await addRahulIyer();
      const asked = expectStatus(await assign(harness(), 'job 108', 'Rahul'), 'confirmation_required');
      expect(asked.confirmation.readback).toBe('Assign Job 108 to Rahul?');
    });

    it('asks which one when the first name alone fits both', async () => {
      const h = harness();
      await addRahulIyer();
      await h.pool.query(`UPDATE resources SET name = 'Rahul Verma' WHERE workspace_id = $1 AND id = 'tech_rahul'`, [REPAIR_ID]);

      const outcome = await assign(h, 'job 108', 'Rahul');

      expect(outcome).toMatchObject({
        status: 'ambiguous',
        role: 'assignee',
        candidates: [{ name: 'Rahul Iyer' }, { name: 'Rahul Verma' }],
      });
    });
  });

  it('does not mistake a job or technician in the wrong role: a job name is not a technician', async () => {
    expect(await assign(harness(), 'job 108', 'job 109')).toMatchObject({ status: 'not_found', role: 'assignee' });
  });
});

describe('undo my last change', () => {
  it('has nothing to undo at first', async () => {
    expect(await undo(harness())).toMatchObject({ status: 'rejected', code: 'NOTHING_TO_UNDO' });
  });

  it('"add twenty air filters" then "undo": asks first, then restores 35 with a new event', async () => {
    const h = harness();
    const added = expectStatus(await adjust(h, 'air filters', 20), 'committed');

    const asked = expectStatus(await undo(h), 'confirmation_required');
    expect(asked.confirmation).toMatchObject({
      reason: 'undo',
      readback: 'Undo "Added 20 pieces to Air Filter (35 to 55)"?',
    });
    expect(await quantityOf(h, 'item_air_filter')).toBe(55);

    const done = expectStatus(await h.service.confirm(confirmation(WORKSPACE_ID, asked.confirmation.token)), 'committed');

    expect(done).toMatchObject({
      resource: { attributes: { quantity: 35 } },
      event: {
        operation: 'REVERSE_EVENT',
        reversalOf: added.event.eventId,
        before: { quantity: 55 },
        after: { quantity: 35 },
        summary: 'Undid: Added 20 pieces to Air Filter (35 to 55)',
      },
    });
    expect(await eventCount(h)).toBe(2); // the original is never edited or deleted
  });

  it('walks back through changes one at a time and then runs out', async () => {
    const h = harness();
    await adjust(h, 'air filters', 5);
    await adjust(h, 'oil filters', 3);

    for (const expected of ['Oil Filter', 'Air Filter']) {
      const asked = expectStatus(await undo(h), 'confirmation_required');
      expect(asked.confirmation.readback).toContain(expected);
      await h.service.confirm(confirmation(WORKSPACE_ID, asked.confirmation.token));
    }

    expect(await undo(h)).toMatchObject({ status: 'rejected', code: 'NOTHING_TO_UNDO' });
    expect(await quantityOf(h, 'item_air_filter')).toBe(35);
    expect(await quantityOf(h, 'item_oil_filter')).toBe(20);
  });

  it('undoes a status change', async () => {
    const h = harness();
    const token = tokenOf(await setStatus(h, WORKSPACE_ID, 'compressor two', 'out of service'));
    await h.service.confirm(confirmation(WORKSPACE_ID, token));

    const asked = expectStatus(await undo(h), 'confirmation_required');
    await h.service.confirm(confirmation(WORKSPACE_ID, asked.confirmation.token));

    expect(await attributesOf(h, WORKSPACE_ID, 'equipment_compressor_2')).toEqual({ status: 'available' });
  });

  it('only ever undoes the asking person\'s own changes', async () => {
    const h = harness();
    await adjust(h, 'air filters', 5, { actorId: 'someone-else' });

    expect(await undo(h)).toMatchObject({ status: 'rejected', code: 'NOTHING_TO_UNDO' });
    const theirs = expectStatus(await undo(h, WORKSPACE_ID, { actorId: 'someone-else' }), 'confirmation_required');
    expect(theirs.confirmation.readback).toContain('Air Filter');
  });

  it('refuses when the item has been changed since, so a later change is not overwritten', async () => {
    const h = harness();
    await adjust(h, 'air filters', 20);
    await adjust(h, 'air filters', 5, { actorId: 'someone-else' });

    expect(await undo(h)).toMatchObject({
      status: 'rejected',
      code: 'STATE_CHANGED',
      message: expect.stringContaining('cannot be undone safely') as string,
    });
    expect(await quantityOf(h, 'item_air_filter')).toBe(60);
  });

  it('is applied once when confirmed twice, and refused if the item moved on', async () => {
    const h = harness();
    await adjust(h, 'air filters', 20);
    const first = tokenOf(await undo(h));
    const second = tokenOf(await undo(h));

    expect((await h.service.confirm(confirmation(WORKSPACE_ID, first))).status).toBe('committed');
    expect(await h.service.confirm(confirmation(WORKSPACE_ID, second))).toMatchObject({ status: 'conflict' });
    expect(await quantityOf(h, 'item_air_filter')).toBe(35);
    expect(await eventCount(h)).toBe(2);
  });

  it('copes with the resource of the last change having disappeared', async () => {
    const h = harness();
    await adjust(h, 'air filters', 20);
    const lookup = await h.store.findLastReversibleEvent(WORKSPACE_ID, ACTOR);
    if (!lookup) {
      throw new Error('expected an event');
    }
    const confused: Store = {
      ...h.store,
      findLastReversibleEvent: () => Promise.resolve({ ...lookup, resourceId: 'item_ghost' }),
      listResources: async (ws, filter) => [...(await h.store.listResources(ws, filter)), inventoryItem('item_other', 'Other')],
    };

    expect(await h.serviceWith(confused).execute(request(WORKSPACE_ID, 'REVERSE_EVENT', '', {}))).toMatchObject({
      status: 'rejected',
      code: 'INVALID_TARGET',
    });
  });
});

describe('workspaces', () => {
  it('refuses a workspace that does not exist', async () => {
    await expect(
      harness().service.execute(request('no-such-workspace', 'ADJUST_QUANTITY', 'x', { delta: 1 })),
    ).rejects.toThrow(/was not found/);
  });
});
