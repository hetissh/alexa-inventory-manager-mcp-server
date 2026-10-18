import { DatabaseError, type Pool, type PoolClient, type QueryResultRow } from 'pg';

import { DuplicateCommandError, VersionConflictError, WorkspaceNotFoundError } from '../../app/errors.js';
import type { ListedEvent, NewEvent, Store, TransactionStore } from '../../app/ports.js';
import {
  eventRecordSchema,
  type Resource,
  resourceSchema,
  type ResourceType,
  workspaceSchema,
} from '../../domain/schemas.js';
import type { EventRecord, JsonObject, SyncDestination, SyncStatus, Workspace } from '../../domain/types.js';

type Queryable = Pick<Pool, 'query'>;

const UNIQUE_VIOLATION = '23505';
const COMMAND_UNIQUE_CONSTRAINT = 'events_workspace_command_unique';

interface WorkspaceRow extends QueryResultRow {
  id: string;
  name: string;
  template: string;
  timezone: string;
  board_version: string;
  integrations: unknown;
}

interface ResourceRow extends QueryResultRow {
  workspace_id: string;
  id: string;
  type: string;
  name: string;
  aliases: string[];
  attributes: unknown;
  version: number;
  updated_at: Date;
}

interface EventRow extends QueryResultRow {
  event_id: string;
  seq: string;
  workspace_id: string;
  command_id: string;
  resource_id: string;
  resource_name: string;
  operation: string;
  request_args: unknown;
  before_state: unknown;
  after_state: unknown;
  summary: string;
  actor: string;
  source: string;
  client_name: string | null;
  created_at: Date;
  reversal_of: string | null;
  sync_status?: SyncStatus | null;
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return workspaceSchema.parse({
    id: row.id,
    name: row.name,
    template: row.template,
    timezone: row.timezone,
    boardVersion: Number(row.board_version),
    integrations: row.integrations,
  });
}

function toResource(row: ResourceRow): Resource {
  return resourceSchema.parse({
    workspaceId: row.workspace_id,
    id: row.id,
    type: row.type,
    name: row.name,
    aliases: row.aliases,
    attributes: row.attributes,
    version: row.version,
    updatedAt: row.updated_at,
  });
}

function toEvent(row: EventRow): EventRecord {
  return eventRecordSchema.parse({
    eventId: row.event_id,
    seq: Number(row.seq),
    workspaceId: row.workspace_id,
    commandId: row.command_id,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    operation: row.operation,
    arguments: row.request_args,
    before: row.before_state,
    after: row.after_state,
    summary: row.summary,
    actor: row.actor,
    source: row.source,
    clientName: row.client_name,
    createdAt: row.created_at,
    reversalOf: row.reversal_of,
  });
}

// Joins the resource name onto an event row. `{events}` is the events source (a table or a CTE).
const EVENT_COLUMNS = `e.*, r.name AS resource_name`;
const EVENT_JOIN = `JOIN resources r ON r.workspace_id = e.workspace_id AND r.id = e.resource_id`;

async function getWorkspace(db: Queryable, workspaceId: string): Promise<Workspace | undefined> {
  const result = await db.query<WorkspaceRow>(
    'SELECT id, name, template, timezone, board_version, integrations FROM workspaces WHERE id = $1',
    [workspaceId],
  );
  const [row] = result.rows;
  return row ? toWorkspace(row) : undefined;
}

function createTransactionStore(client: PoolClient): TransactionStore {
  return {
    async lockResource(workspaceId, resourceId) {
      const result = await client.query<ResourceRow>(
        'SELECT * FROM resources WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
        [workspaceId, resourceId],
      );
      const [row] = result.rows;
      return row ? toResource(row) : undefined;
    },

    async findEventByCommandId(workspaceId, commandId) {
      const result = await client.query<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM events e ${EVENT_JOIN} WHERE e.workspace_id = $1 AND e.command_id = $2`,
        [workspaceId, commandId],
      );
      const [row] = result.rows;
      return row ? toEvent(row) : undefined;
    },

    async insertEvent(event: NewEvent) {
      try {
        const result = await client.query<EventRow>(
          `WITH e AS (
             INSERT INTO events
               (workspace_id, command_id, resource_id, operation, request_args, before_state, after_state,
                summary, actor, source, client_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *
           )
           SELECT ${EVENT_COLUMNS} FROM e ${EVENT_JOIN}`,
          [
            event.workspaceId,
            event.commandId,
            event.resourceId,
            event.operation,
            JSON.stringify(event.arguments),
            JSON.stringify(event.before),
            JSON.stringify(event.after),
            event.summary,
            event.actor,
            event.source,
            event.clientName,
          ],
        );
        // INSERT ... RETURNING always yields exactly one row, and the join finds the resource we hold locked.
        return toEvent(result.rows[0] as EventRow);
      } catch (error) {
        if (
          error instanceof DatabaseError &&
          error.code === UNIQUE_VIOLATION &&
          error.constraint === COMMAND_UNIQUE_CONSTRAINT
        ) {
          throw new DuplicateCommandError(event.workspaceId, event.commandId);
        }
        throw error;
      }
    },

    async updateResourceAttributes(workspaceId, resourceId, attributes: JsonObject, expectedVersion) {
      const result = await client.query<ResourceRow>(
        `UPDATE resources
            SET attributes = $3, version = version + 1, updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND version = $4
          RETURNING *`,
        [workspaceId, resourceId, JSON.stringify(attributes), expectedVersion],
      );
      const [row] = result.rows;
      if (!row) {
        throw new VersionConflictError(resourceId, expectedVersion);
      }
      return toResource(row);
    },

    async bumpBoardVersion(workspaceId) {
      const result = await client.query<{ board_version: string }>(
        'UPDATE workspaces SET board_version = board_version + 1 WHERE id = $1 RETURNING board_version',
        [workspaceId],
      );
      const [row] = result.rows;
      if (!row) {
        throw new WorkspaceNotFoundError(workspaceId);
      }
      return Number(row.board_version);
    },

    async enqueueSync(workspaceId, eventId, destination: SyncDestination) {
      await client.query('INSERT INTO sync_jobs (workspace_id, event_id, destination) VALUES ($1, $2, $3)', [
        workspaceId,
        eventId,
        destination,
      ]);
    },

    async getSyncStatus(eventId, destination: SyncDestination) {
      const result = await client.query<{ status: SyncStatus }>(
        'SELECT status FROM sync_jobs WHERE event_id = $1 AND destination = $2',
        [eventId, destination],
      );
      return result.rows[0]?.status;
    },
  };
}

export function createPgStore(pool: Pool): Store {
  return {
    getWorkspace: (workspaceId) => getWorkspace(pool, workspaceId),

    async listResources(workspaceId, filter) {
      const types: readonly ResourceType[] | null = filter?.types ?? null;
      const result = await pool.query<ResourceRow>(
        `SELECT * FROM resources
          WHERE workspace_id = $1 AND ($2::text[] IS NULL OR type = ANY($2))
          ORDER BY type, name`,
        [workspaceId, types],
      );
      return result.rows.map(toResource);
    },

    async listEvents(workspaceId, options): Promise<ListedEvent[]> {
      const result = await pool.query<EventRow>(
        `SELECT ${EVENT_COLUMNS}, sj.status AS sync_status
           FROM events e
           ${EVENT_JOIN}
           LEFT JOIN sync_jobs sj ON sj.event_id = e.event_id AND sj.destination = 'sheets'
          WHERE e.workspace_id = $1 AND ($2::text IS NULL OR e.resource_id = $2)
          ORDER BY e.seq DESC
          LIMIT $3`,
        [workspaceId, options.resourceId ?? null, options.limit],
      );
      return result.rows.map((row) => ({ ...toEvent(row), sync: row.sync_status ?? 'not_configured' }));
    },

    async ping() {
      await pool.query('SELECT 1');
    },

    async withTransaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(createTransactionStore(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
