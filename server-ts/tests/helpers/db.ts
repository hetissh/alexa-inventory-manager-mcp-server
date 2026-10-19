import { randomBytes } from 'node:crypto';

import type { Pool } from 'pg';

import { dropDatabase, ensureDatabase } from '../../src/infra/db/admin.js';
import { createPool } from '../../src/infra/db/pool.js';
import { seedWorkspace } from '../../src/infra/db/seed.js';
import { cafeTemplate } from '../../src/templates/cafe.js';
import { listTemplates } from '../../src/templates/index.js';
import { repairTemplate } from '../../src/templates/repair.js';
import { restaurantTemplate } from '../../src/templates/restaurant.js';
import { warehouseTemplate } from '../../src/templates/warehouse.js';

export const DEFAULT_TEST_DATABASE_URL = 'postgresql://localhost:5432/voiceops_test';
export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'] ?? DEFAULT_TEST_DATABASE_URL;
export const WORKSPACE_ID = warehouseTemplate.workspace.id;
export const CAFE_ID = cafeTemplate.workspace.id;
export const REPAIR_ID = repairTemplate.workspace.id;
export const RESTAURANT_ID = restaurantTemplate.workspace.id;
export const ALL_WORKSPACE_IDS = listTemplates().map((template) => template.workspace.id);

export function createTestPool(url: string = TEST_DATABASE_URL): Pool {
  return createPool(url, () => undefined);
}

/** Restores every demo workspace (warehouse, cafe, repair) to its fixture and clears integrations. */
export async function resetAll(pool: Pool): Promise<void> {
  for (const template of listTemplates()) {
    await seedWorkspace(pool, template, { reset: true });
  }
  await pool.query(`UPDATE workspaces SET integrations = '{}'::jsonb`);
}

export function urlForDatabase(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Runs `work` against a brand-new, empty database that is dropped afterwards. */
export async function withTempDatabase<T>(work: (url: string) => Promise<T>): Promise<T> {
  const url = urlForDatabase(TEST_DATABASE_URL, `voiceops_test_tmp_${randomBytes(6).toString('hex')}`);
  try {
    return await work(url);
  } finally {
    await dropDatabase(url);
  }
}

/** Same as withTempDatabase, but the database already exists. */
export async function withExistingTempDatabase<T>(work: (url: string) => Promise<T>): Promise<T> {
  return withTempDatabase(async (url) => {
    await ensureDatabase(url);
    return work(url);
  });
}
