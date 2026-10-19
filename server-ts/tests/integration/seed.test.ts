import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedWorkspace } from '../../src/infra/db/seed.js';
import type { Template } from '../../src/templates/types.js';
import { warehouseTemplate } from '../../src/templates/warehouse.js';
import { createTestPool, resetAll, WORKSPACE_ID } from '../helpers/db.js';

let pool: Pool;

beforeAll(() => {
  pool = createTestPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool);
});

async function quantity(resourceId: string): Promise<number> {
  const result = await pool.query<{ quantity: number }>(
    `SELECT (attributes->>'quantity')::int AS quantity FROM resources WHERE workspace_id = $1 AND id = $2`,
    [WORKSPACE_ID, resourceId],
  );
  return result.rows[0]?.quantity ?? Number.NaN;
}

describe('seedWorkspace', () => {
  it('adds nothing and overwrites nothing when everything already exists', async () => {
    await pool.query(
      `UPDATE resources SET attributes = jsonb_set(attributes, '{quantity}', '99') WHERE workspace_id = $1 AND id = 'item_air_filter'`,
      [WORKSPACE_ID],
    );

    const result = await seedWorkspace(pool, warehouseTemplate, { reset: false });

    expect(result).toEqual({ workspaceId: WORKSPACE_ID, resourcesCreated: 0, reset: false });
    expect(await quantity('item_air_filter')).toBe(99);
  });

  it('restores a resource that went missing without touching the others', async () => {
    await pool.query(`DELETE FROM resources WHERE workspace_id = $1 AND id = 'item_oil_filter'`, [WORKSPACE_ID]);

    const result = await seedWorkspace(pool, warehouseTemplate, { reset: false });

    expect(result.resourcesCreated).toBe(1);
    expect(await quantity('item_oil_filter')).toBe(20);
  });

  it('creates the workspace from scratch in an empty database', async () => {
    await pool.query('DELETE FROM workspaces WHERE id = $1', [WORKSPACE_ID]);

    const result = await seedWorkspace(pool, warehouseTemplate, { reset: false });

    expect(result.resourcesCreated).toBe(warehouseTemplate.resources.length);
  });

  it('reset restores the fixture and clears events and the board version, but keeps integrations', async () => {
    await pool.query(
      `UPDATE resources SET attributes = jsonb_set(attributes, '{quantity}', '1') WHERE workspace_id = $1 AND id = 'item_air_filter'`,
      [WORKSPACE_ID],
    );
    await pool.query(
      `UPDATE workspaces SET board_version = 7, integrations = '{"sheets":{"spreadsheetId":"keep-me"}}' WHERE id = $1`,
      [WORKSPACE_ID],
    );
    await pool.query(
      `INSERT INTO events (workspace_id, command_id, resource_id, operation, request_args, before_state, after_state, summary, actor, source)
       VALUES ($1, 'old', 'item_air_filter', 'ADJUST_QUANTITY', '{}', '{}', '{}', 'old event', 'manager-1', 'mcp')`,
      [WORKSPACE_ID],
    );
    await pool.query(
      `INSERT INTO sync_jobs (workspace_id, event_id, destination) SELECT workspace_id, event_id, 'sheets' FROM events`,
    );

    const result = await seedWorkspace(pool, warehouseTemplate, { reset: true });

    expect(result).toMatchObject({ reset: true, resourcesCreated: warehouseTemplate.resources.length });
    expect(await quantity('item_air_filter')).toBe(35);
    const counts = await pool.query<{ events: string; jobs: string }>(
      `SELECT (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM sync_jobs) AS jobs`,
    );
    expect(counts.rows[0]).toEqual({ events: '0', jobs: '0' });
    const workspace = await pool.query<{ board_version: string; integrations: unknown }>(
      'SELECT board_version, integrations FROM workspaces WHERE id = $1',
      [WORKSPACE_ID],
    );
    expect(workspace.rows[0]).toEqual({
      board_version: '0',
      integrations: { sheets: { spreadsheetId: 'keep-me' } },
    });
  });

  it('refuses invalid seed data before touching the database', async () => {
    const broken: Template = {
      ...warehouseTemplate,
      resources: [
        { id: 'Bad Id', collection: 'equipment', type: 'equipment', name: 'X', aliases: [], attributes: { status: 'available' } },
      ],
    };

    await expect(seedWorkspace(pool, broken, { reset: true })).rejects.toThrow();
    expect(await quantity('item_air_filter')).toBe(35);
  });
});
