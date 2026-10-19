import type { Migration } from '../migrator.js';

/**
 * Collections: named lists inside a workspace ("Dishes", "Ingredients", "Dining tables"). A collection's kind is a
 * resource type, and every resource belongs to exactly one collection of its own kind. Existing data is moved into
 * one collection per type so nothing changes for workspaces created before this migration.
 */
export const migration0003: Migration = {
  id: '0003_collections',
  sql: `
    CREATE TABLE collections (
      workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      key           text NOT NULL,
      label         text NOT NULL,
      -- a resource type: inventory_item, equipment, menu_item, dining_table, job or technician
      kind          text NOT NULL,
      aliases       text[] NOT NULL DEFAULT '{}',
      position      integer NOT NULL DEFAULT 0 CHECK (position >= 0),
      PRIMARY KEY (workspace_id, key),
      -- lets a resource reference its collection AND prove it has the collection's kind
      CONSTRAINT collections_key_kind_unique UNIQUE (workspace_id, key, kind)
    );

    ALTER TABLE resources ADD COLUMN collection_key text;

    INSERT INTO collections (workspace_id, key, label, kind, position)
    SELECT DISTINCT
           workspace_id,
           CASE type WHEN 'inventory_item' THEN 'stock' WHEN 'equipment' THEN 'equipment' WHEN 'menu_item' THEN 'menu'
                     WHEN 'dining_table' THEN 'tables' WHEN 'job' THEN 'jobs' WHEN 'technician' THEN 'technicians'
                     ELSE type END,
           CASE type WHEN 'inventory_item' THEN 'Stock' WHEN 'equipment' THEN 'Equipment' WHEN 'menu_item' THEN 'Menu'
                     WHEN 'dining_table' THEN 'Tables' WHEN 'job' THEN 'Jobs' WHEN 'technician' THEN 'Technicians'
                     ELSE type END,
           type,
           CASE type WHEN 'inventory_item' THEN 0 WHEN 'equipment' THEN 1 WHEN 'menu_item' THEN 2
                     WHEN 'dining_table' THEN 3 WHEN 'job' THEN 4 WHEN 'technician' THEN 5 ELSE 6 END
      FROM resources;

    UPDATE resources
       SET collection_key = CASE type WHEN 'inventory_item' THEN 'stock' WHEN 'equipment' THEN 'equipment'
                                      WHEN 'menu_item' THEN 'menu' WHEN 'dining_table' THEN 'tables'
                                      WHEN 'job' THEN 'jobs' WHEN 'technician' THEN 'technicians' ELSE type END;

    ALTER TABLE resources ALTER COLUMN collection_key SET NOT NULL;
    ALTER TABLE resources
      ADD CONSTRAINT resources_collection_fk
      FOREIGN KEY (workspace_id, collection_key, type) REFERENCES collections (workspace_id, key, kind);
    CREATE INDEX resources_collection_idx ON resources (workspace_id, collection_key);
  `,
};
