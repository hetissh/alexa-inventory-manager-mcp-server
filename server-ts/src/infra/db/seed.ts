import type { Pool } from 'pg';

import { resourceSeedSchema } from '../../domain/schemas.js';
import type { Template } from '../../templates/types.js';

export interface SeedResult {
  readonly workspaceId: string;
  /** Resources that did not exist before and were inserted. */
  readonly resourcesCreated: number;
  readonly reset: boolean;
}

/**
 * Creates the template's workspace and resources. Without `reset` it only adds what is missing and never
 * overwrites live state. With `reset` it first deletes the workspace's events, sync jobs and resources
 * (keeping its integrations) and restores the fixture.
 */
export async function seedWorkspace(
  pool: Pool,
  template: Template,
  options: { readonly reset: boolean },
): Promise<SeedResult> {
  const seeds = template.resources.map((resource) => resourceSeedSchema.parse(resource));
  const { workspace } = template;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (options.reset) {
      await client.query('DELETE FROM sync_jobs WHERE workspace_id = $1', [workspace.id]);
      await client.query('DELETE FROM events WHERE workspace_id = $1', [workspace.id]);
      await client.query('DELETE FROM resources WHERE workspace_id = $1', [workspace.id]);
    }
    await client.query(
      `INSERT INTO workspaces (id, name, template, timezone) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, template = EXCLUDED.template, timezone = EXCLUDED.timezone`,
      [workspace.id, workspace.name, template.id, workspace.timezone],
    );
    if (options.reset) {
      await client.query('UPDATE workspaces SET board_version = 0 WHERE id = $1', [workspace.id]);
    }
    let resourcesCreated = 0;
    for (const seed of seeds) {
      const inserted = await client.query(
        `INSERT INTO resources (workspace_id, id, type, name, aliases, attributes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, id) DO NOTHING
         RETURNING id`,
        [workspace.id, seed.id, seed.type, seed.name, seed.aliases, JSON.stringify(seed.attributes)],
      );
      resourcesCreated += inserted.rows.length;
    }
    await client.query('COMMIT');
    return { workspaceId: workspace.id, resourcesCreated, reset: options.reset };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
