import { describe, expect, it } from 'vitest';

import { createReadService } from '../../src/app/readService.js';
import { ensureDatabase } from '../../src/infra/db/admin.js';
import { migration0001 } from '../../src/infra/db/migrations/0001_init.js';
import { migration0002 } from '../../src/infra/db/migrations/0002_confirmations_alerts.js';
import { migrate } from '../../src/infra/db/migrator.js';
import { seedWorkspace } from '../../src/infra/db/seed.js';
import { restaurantTemplate } from '../../src/templates/restaurant.js';
import type { Template } from '../../src/templates/types.js';
import { createTestPool, RESTAURANT_ID, withTempDatabase,WORKSPACE_ID } from '../helpers/db.js';
import { confirmation, expectStatus, request, setStatus, tokenOf, useCommandHarness } from '../helpers/service.js';

const harness = useCommandHarness();

const labelOf = async (key: string): Promise<string | undefined> =>
  (await harness().pool.query<{ label: string }>('SELECT label FROM collections WHERE workspace_id = $1 AND key = $2', [RESTAURANT_ID, key]))
    .rows[0]?.label;

describe('collections in the database', () => {
  it('seeds each workspace with its named lists, in order, and counts what is in them', async () => {
    const { store } = harness();

    expect((await store.listCollections(RESTAURANT_ID)).map((c) => [c.key, c.label, c.kind, c.position, c.itemCount])).toEqual([
      ['dishes', 'Dishes', 'menu_item', 0, 5],
      ['ingredients', 'Ingredients', 'inventory_item', 1, 4],
      ['kitchen_equipment', 'Kitchen equipment', 'equipment', 2, 2],
      ['dining_tables', 'Dining tables', 'dining_table', 3, 6],
    ]);
    expect((await store.listCollections(WORKSPACE_ID)).map((c) => [c.key, c.kind, c.itemCount])).toEqual([
      ['stock', 'inventory_item', 3],
      ['equipment', 'equipment', 1],
    ]);
  });

  it('keeps the words people use for a list', async () => {
    const lists = await harness().store.listCollections(RESTAURANT_ID);

    expect(lists.find((list) => list.key === 'dining_tables')).toMatchObject({ workspaceId: RESTAURANT_ID, aliases: ['tables'] });
    expect(lists.find((list) => list.key === 'ingredients')?.aliases).toEqual(['inventory', 'stock']);
  });

  it('puts every resource in a list of its own kind, and the database refuses anything else', async () => {
    const { pool } = harness();

    await expect(
      pool.query(`UPDATE resources SET collection_key = 'dishes' WHERE workspace_id = $1 AND id = 'table_1'`, [RESTAURANT_ID]),
    ).rejects.toThrow(/resources_collection_fk/);
    await expect(
      pool.query(`UPDATE resources SET collection_key = 'no_such_list' WHERE workspace_id = $1 AND id = 'table_1'`, [RESTAURANT_ID]),
    ).rejects.toThrow(/resources_collection_fk/);
  });

  it('does not let a list that still holds things be deleted', async () => {
    await expect(
      harness().pool.query(`DELETE FROM collections WHERE workspace_id = $1 AND key = 'dishes'`, [RESTAURANT_ID]),
    ).rejects.toThrow(/resources_collection_fk/);
  });

  it('never overwrites a list someone renamed when seeding again, but a reset restores the fixture', async () => {
    const { pool } = harness();
    await pool.query(`UPDATE collections SET label = 'Menu board' WHERE workspace_id = $1 AND key = 'dishes'`, [RESTAURANT_ID]);

    await seedWorkspace(pool, restaurantTemplate, { reset: false });
    expect(await labelOf('dishes')).toBe('Menu board');

    await seedWorkspace(pool, restaurantTemplate, { reset: true });
    expect(await labelOf('dishes')).toBe('Dishes');
  });

  describe('a template that disagrees with itself is refused before the database is touched', () => {
    const refusing = async (broken: Template, message: RegExp): Promise<void> => {
      const { pool } = harness();
      await pool.query(`UPDATE collections SET label = 'Menu board' WHERE workspace_id = $1 AND key = 'dishes'`, [RESTAURANT_ID]);

      await expect(seedWorkspace(pool, broken, { reset: true })).rejects.toThrow(message);

      expect(await labelOf('dishes')).toBe('Menu board'); // the reset did not run
    };

    it('a resource in a list the template does not define', () =>
      refusing(
        { ...restaurantTemplate, collections: restaurantTemplate.collections.filter((c) => c.key !== 'dining_tables') },
        /table_1 is in the collection "dining_tables", which the template does not define/,
      ));

    it('a resource in a list that holds another kind', () =>
      refusing(
        {
          ...restaurantTemplate,
          collections: restaurantTemplate.collections.map((c) => (c.key === 'dishes' ? { ...c, kind: 'inventory_item' as const } : c)),
        },
        /dish_butter_chicken is a menu_item but its collection "dishes" holds inventory_item items/,
      ));

    it('the same list key twice', () =>
      refusing(
        { ...restaurantTemplate, collections: [...restaurantTemplate.collections, ...restaurantTemplate.collections.slice(0, 1)] },
        /lists the same collection key twice/,
      ));
  });
});

describe('a restaurant workspace end to end', () => {
  it('asks before reserving a table, then applies it, and the board counts it', async () => {
    const h = harness();

    const asked = await setStatus(h, RESTAURANT_ID, 'table five', 'reserved');
    expect(expectStatus(asked, 'confirmation_required').confirmation.readback).toBe('Mark Table 5 as reserved (currently free)?');
    const applied = expectStatus(await h.service.confirm(confirmation(RESTAURANT_ID, tokenOf(asked))), 'committed');

    expect(applied.resource).toMatchObject({ id: 'table_5', collection: 'dining_tables', attributes: { status: 'reserved', seats: 4 } });
    const board = await createReadService(h.store, h.logger).getBoard(RESTAURANT_ID);
    expect(board.metrics).toEqual([
      { label: 'Tables free', value: 3 },
      { label: 'Tables occupied', value: 1 },
      { label: 'Dishes sold out', value: 0 },
      { label: 'Low stock', value: 0 },
    ]);
    expect(board.spoken).toBe('Lakeview Restaurant: Tables free 3, Tables occupied 1, Dishes sold out 0, Low stock 0.');
  });

  it('marks a dish sold out and counts it', async () => {
    const h = harness();

    const asked = await setStatus(h, RESTAURANT_ID, 'butter chicken', 'sold out');
    expect(expectStatus(asked, 'confirmation_required').confirmation.readback).toBe('Mark Butter Chicken as sold out (currently available)?');
    await h.service.confirm(confirmation(RESTAURANT_ID, tokenOf(asked)));

    const board = await createReadService(h.store, h.logger).getBoard(RESTAURANT_ID);
    expect(board.metrics).toContainEqual({ label: 'Dishes sold out', value: 1 });
  });

  it('refuses a status the thing cannot have, and says which ones it can', async () => {
    const h = harness();

    expect(await setStatus(h, RESTAURANT_ID, 'table five', 'sold out')).toMatchObject({
      status: 'rejected',
      code: 'INVALID_STATUS',
      spoken: expect.stringContaining('free, occupied, reserved, cleaning') as unknown,
    });
    expect(await setStatus(h, RESTAURANT_ID, 'garlic naan', 'reserved')).toMatchObject({ status: 'rejected', code: 'INVALID_STATUS' });
  });

  it('keeps stock in kilograms and raises a low-stock alert below the reorder level', async () => {
    const h = harness();

    const outcome = expectStatus(
      await h.service.execute(request(RESTAURANT_ID, 'ADJUST_QUANTITY', 'paneer', { delta: -8 })),
      'committed',
    );

    expect(outcome.resource).toMatchObject({ collection: 'ingredients', attributes: { quantity: 4, unit: 'kg', reorderLevel: 5 } });
    expect(outcome.alerts.opened).toHaveLength(1);
    const board = await createReadService(h.store, h.logger).getBoard(RESTAURANT_ID);
    expect(board.metrics).toContainEqual({ label: 'Low stock', value: 1 });
  });

  it('lets "paneer" mean the ingredient for stock and the dish for a status', async () => {
    const h = harness();

    const stock = expectStatus(await h.service.execute(request(RESTAURANT_ID, 'ADJUST_QUANTITY', 'paneer', { delta: 1 })), 'committed');
    const status = await setStatus(h, RESTAURANT_ID, 'paneer', 'sold out');

    expect(stock.event.resourceName).toBe('Paneer');
    expect(expectStatus(status, 'confirmation_required').confirmation.readback).toBe(
      'Mark Paneer Tikka as sold out (currently available)?',
    );
  });

  it('lists the workspace\'s lists with how many things are in each', async () => {
    const info = await createReadService(harness().store, harness().logger).getWorkspaceInfo(RESTAURANT_ID);

    expect(info.collections.map((c) => [c.label, c.itemCount])).toEqual([
      ['Dishes', 5],
      ['Ingredients', 4],
      ['Kitchen equipment', 2],
      ['Dining tables', 6],
    ]);
    expect(info.counts).toEqual({ menu_item: 5, inventory_item: 4, equipment: 2, dining_table: 6 });
    expect(info.settings.tableStatuses).toEqual(['free', 'occupied', 'reserved', 'cleaning']);
  });
});

describe('migration 0003', () => {
  it('moves what already exists into one list per kind, in every workspace', async () => {
    await withTempDatabase(async (url) => {
      await ensureDatabase(url);
      const pool = createTestPool(url);
      try {
        await migrate(pool, [migration0001, migration0002]);
        for (const workspace of ['old-shop-a', 'old-shop-b']) {
          await pool.query(`INSERT INTO workspaces (id, name, template) VALUES ($1, 'Old shop', 'warehouse')`, [workspace]);
          for (const [id, type] of [
            ['item_nuts', 'inventory_item'],
            ['equipment_saw', 'equipment'],
            ['menu_tea', 'menu_item'],
            ['job_001', 'job'],
            ['tech_asha', 'technician'],
          ] as const) {
            await pool.query(`INSERT INTO resources (workspace_id, id, type, name, attributes) VALUES ($1, $2, $3, $2, '{}')`, [workspace, id, type]);
          }
        }
        await pool.query(`INSERT INTO workspaces (id, name, template) VALUES ('empty-shop', 'Empty', 'warehouse')`);

        expect(await migrate(pool)).toEqual(['0003_collections']);

        const lists = await pool.query<{ workspace_id: string; key: string; label: string; kind: string; position: number }>(
          `SELECT workspace_id, key, label, kind, position FROM collections ORDER BY workspace_id, position`,
        );
        const expected = [
          { key: 'stock', label: 'Stock', kind: 'inventory_item', position: 0 },
          { key: 'equipment', label: 'Equipment', kind: 'equipment', position: 1 },
          { key: 'menu', label: 'Menu', kind: 'menu_item', position: 2 },
          { key: 'jobs', label: 'Jobs', kind: 'job', position: 4 },
          { key: 'technicians', label: 'Technicians', kind: 'technician', position: 5 },
        ];
        expect(lists.rows).toEqual([
          ...expected.map((list) => ({ workspace_id: 'old-shop-a', ...list })),
          ...expected.map((list) => ({ workspace_id: 'old-shop-b', ...list })),
        ]);
        const placed = await pool.query<{ id: string; collection_key: string }>(
          `SELECT id, collection_key FROM resources WHERE workspace_id = 'old-shop-a' ORDER BY id`,
        );
        expect(placed.rows).toEqual([
          { id: 'equipment_saw', collection_key: 'equipment' },
          { id: 'item_nuts', collection_key: 'stock' },
          { id: 'job_001', collection_key: 'jobs' },
          { id: 'menu_tea', collection_key: 'menu' },
          { id: 'tech_asha', collection_key: 'technicians' },
        ]);
      } finally {
        await pool.end();
      }
    });
  });
});
