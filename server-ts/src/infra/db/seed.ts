import type { Pool } from 'pg';

import { collectionSeedSchema, resourceSeedSchema } from '../../domain/schemas.js';
import type { Template } from '../../templates/types.js';

export interface SeedResult {
  readonly workspaceId: string;
  /** Resources that did not exist before and were inserted. */
  readonly resourcesCreated: number;
  readonly reset: boolean;
}

/** A template must be internally consistent: every resource sits in a collection that exists and has its kind. */
function assertCollectionsAgree(
  templateId: string,
  collections: readonly { readonly key: string; readonly kind: string }[],
  seeds: readonly { readonly id: string; readonly type: string; readonly collection: string }[],
): void {
  const kinds = new Map(collections.map((collection) => [collection.key, collection.kind]));
  if (kinds.size !== collections.length) {
    throw new Error(`Template "${templateId}" lists the same collection key twice.`);
  }
  for (const seed of seeds) {
    const kind = kinds.get(seed.collection);
    if (kind === undefined) {
      throw new Error(`Template "${templateId}": ${seed.id} is in the collection "${seed.collection}", which the template does not define.`);
    }
    if (kind !== seed.type) {
      throw new Error(
        `Template "${templateId}": ${seed.id} is a ${seed.type} but its collection "${seed.collection}" holds ${kind} items.`,
      );
    }
  }
}

/**
 * Creates the template's workspace, collections and resources. Without `reset` it only adds what is missing and never
 * overwrites live state. With `reset` it first deletes the workspace's events, pending changes, alerts,
 * sync jobs and resources (keeping its integrations) and restores the fixture.
 */
export async function seedWorkspace(
  pool: Pool,
  template: Template,
  options: { readonly reset: boolean },
): Promise<SeedResult> {
  const seeds = template.resources.map((resource) => resourceSeedSchema.parse(resource));
  const collections = template.collections.map((collection) => collectionSeedSchema.parse(collection));
  assertCollectionsAgree(template.id, collections, seeds);
  const { workspace } = template;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (options.reset) {
      // Children first: these all reference events and/or resources.
      for (const table of ['sync_jobs', 'alerts', 'commands', 'events', 'resources', 'collections']) {
        await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspace.id]);
      }
    }
    await client.query(
      `INSERT INTO workspaces (id, name, template, timezone) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, template = EXCLUDED.template, timezone = EXCLUDED.timezone`,
      [workspace.id, workspace.name, template.id, workspace.timezone],
    );
    if (options.reset) {
      await client.query('UPDATE workspaces SET board_version = 0 WHERE id = $1', [workspace.id]);
    }
    for (const [position, collection] of collections.entries()) {
      await client.query(
        `INSERT INTO collections (workspace_id, key, label, kind, aliases, position)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (workspace_id, key) DO NOTHING`,
        [workspace.id, collection.key, collection.label, collection.kind, collection.aliases, position],
      );
    }
    let resourcesCreated = 0;
    for (const seed of seeds) {
      const inserted = await client.query(
        `INSERT INTO resources (workspace_id, id, type, name, aliases, attributes, collection_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, id) DO NOTHING
         RETURNING id`,
        [workspace.id, seed.id, seed.type, seed.name, seed.aliases, JSON.stringify(seed.attributes), seed.collection],
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
