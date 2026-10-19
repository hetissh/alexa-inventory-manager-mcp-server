import { DatabaseError, type Pool, type PoolClient, type QueryResultRow } from 'pg';

import {
  AlreadyReversedError,
  DuplicateCommandError,
  VersionConflictError,
  WorkspaceNotFoundError,
} from '../../app/errors.js';
import type { ListedEvent, NewAlert, NewCommand, NewEvent, Store, TransactionStore } from '../../app/ports.js';
import {
  alertRecordSchema,
  commandRecordSchema,
  eventRecordSchema,
  type Resource,
  resourceSchema,
  type ResourceType,
  workspaceSchema,
} from '../../domain/schemas.js';
import type {
  AlertRecord,
  CommandRecord,
  EventRecord,
  JsonObject,
  SyncDestination,
  SyncStatus,
  Workspace,
} from '../../domain/types.js';

type Queryable = Pick<Pool, 'query'>;

const UNIQUE_VIOLATION = '23505';
const COMMAND_UNIQUE_CONSTRAINT = 'events_workspace_command_unique';
const REVERSAL_UNIQUE_INDEX = 'events_reversal_of_unique';

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
  sync_error?: string | null;
}

interface AlertRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  resource_id: string;
  resource_name: string;
  rule: string;
  status: string;
  message: string;
  created_at: Date;
  resolved_at: Date | null;
}

interface CommandRow extends QueryResultRow {
  id: string;
  workspace_id: string;
  command_id: string;
  actor: string;
  source: string;
  client_name: string | null;
  operation: string;
  resource_id: string;
  request_args: unknown;
  secondary_resource_id: string | null;
  reversing_event_id: string | null;
  expected_version: number;
  reason: string;
  readback: string;
  status: string;
  event_id: string | null;
  expires_at: Date;
  created_at: Date;
  resolved_at: Date | null;
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

function toAlert(row: AlertRow): AlertRecord {
  return alertRecordSchema.parse({
    alertId: row.id,
    workspaceId: row.workspace_id,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    rule: row.rule,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
}

function toCommand(row: CommandRow): CommandRecord {
  return commandRecordSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    commandId: row.command_id,
    actor: row.actor,
    source: row.source,
    clientName: row.client_name,
    operation: row.operation,
    resourceId: row.resource_id,
    arguments: row.request_args,
    secondaryResourceId: row.secondary_resource_id,
    reversingEventId: row.reversing_event_id,
    expectedVersion: row.expected_version,
    reason: row.reason,
    readback: row.readback,
    status: row.status,
    eventId: row.event_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
}

// Joins the resource name onto an event/alert row. `e` / `a` is the source (a table or a CTE).
const EVENT_COLUMNS = `e.*, r.name AS resource_name`;
const EVENT_JOIN = `JOIN resources r ON r.workspace_id = e.workspace_id AND r.id = e.resource_id`;
const ALERT_COLUMNS = `a.*, r.name AS resource_name`;
const ALERT_JOIN = `JOIN resources r ON r.workspace_id = a.workspace_id AND r.id = a.resource_id`;

/** Read queries, usable on the pool or inside a transaction/snapshot. */
function createReads(
  db: Queryable,
): Omit<Store, 'ping' | 'withTransaction' | 'getBoardSnapshot' | 'requeueSync'> {
  return {
    async getWorkspace(workspaceId) {
      const result = await db.query<WorkspaceRow>(
        'SELECT id, name, template, timezone, board_version, integrations FROM workspaces WHERE id = $1',
        [workspaceId],
      );
      const [row] = result.rows;
      return row ? toWorkspace(row) : undefined;
    },

    async listResources(workspaceId, filter) {
      const types: readonly ResourceType[] | null = filter?.types ?? null;
      const result = await db.query<ResourceRow>(
        `SELECT * FROM resources
          WHERE workspace_id = $1 AND ($2::text[] IS NULL OR type = ANY($2))
          ORDER BY type, name`,
        [workspaceId, types],
      );
      return result.rows.map(toResource);
    },

    async listEvents(workspaceId, options): Promise<ListedEvent[]> {
      const result = await db.query<EventRow>(
        `SELECT ${EVENT_COLUMNS}, sj.status AS sync_status, sj.last_error AS sync_error
           FROM events e
           ${EVENT_JOIN}
           LEFT JOIN sync_jobs sj ON sj.event_id = e.event_id AND sj.destination = 'sheets'
          WHERE e.workspace_id = $1 AND ($2::text IS NULL OR e.resource_id = $2)
          ORDER BY e.seq DESC
          LIMIT $3`,
        [workspaceId, options.resourceId ?? null, options.limit],
      );
      return result.rows.map((row) => ({
        ...toEvent(row),
        sync: row.sync_status ?? 'not_configured',
        syncError: row.sync_error ?? null,
      }));
    },

    async getEvent(workspaceId, eventId) {
      const result = await db.query<EventRow>(
        `SELECT ${EVENT_COLUMNS} FROM events e ${EVENT_JOIN} WHERE e.workspace_id = $1 AND e.event_id = $2`,
        [workspaceId, eventId],
      );
      const [row] = result.rows;
      return row ? toEvent(row) : undefined;
    },

    async findLastReversibleEvent(workspaceId, actor) {
      const result = await db.query<EventRow>(
        `SELECT ${EVENT_COLUMNS}
           FROM events e
           ${EVENT_JOIN}
          WHERE e.workspace_id = $1 AND e.actor = $2 AND e.reversal_of IS NULL
            AND NOT EXISTS (SELECT 1 FROM events undo WHERE undo.reversal_of = e.event_id)
          ORDER BY e.seq DESC
          LIMIT 1`,
        [workspaceId, actor],
      );
      const [row] = result.rows;
      return row ? toEvent(row) : undefined;
    },

    async listEventsByIds(workspaceId, eventIds) {
      const result = await db.query<EventRow>(
        `SELECT ${EVENT_COLUMNS}
           FROM events e
           ${EVENT_JOIN}
          WHERE e.workspace_id = $1 AND e.event_id = ANY($2::uuid[])
          ORDER BY e.seq`,
        [workspaceId, eventIds],
      );
      return result.rows.map(toEvent);
    },

    async getSyncBacklog(workspaceId) {
      const result = await db.query<{ pending: string; retrying: string; failed: string }>(
        `SELECT count(*) FILTER (WHERE status IN ('pending', 'in_progress')) AS pending,
                count(*) FILTER (WHERE status = 'retrying') AS retrying,
                count(*) FILTER (WHERE status = 'failed') AS failed
           FROM sync_jobs
          WHERE workspace_id = $1 AND destination = 'sheets'`,
        [workspaceId],
      );
      // An aggregate query always returns exactly one row.
      const row = result.rows[0] as { pending: string; retrying: string; failed: string };
      return { pending: Number(row.pending), retrying: Number(row.retrying), failed: Number(row.failed) };
    },

    async findCommandByTokenHash(workspaceId, tokenHash) {
      const result = await db.query<CommandRow>('SELECT * FROM commands WHERE workspace_id = $1 AND token_hash = $2', [
        workspaceId,
        tokenHash,
      ]);
      const [row] = result.rows;
      return row ? toCommand(row) : undefined;
    },

    async listAlerts(workspaceId, options) {
      const result = await db.query<AlertRow>(
        `SELECT ${ALERT_COLUMNS}
           FROM alerts a
           ${ALERT_JOIN}
          WHERE a.workspace_id = $1 AND ($2 = 'all' OR a.status = $2)
          ORDER BY a.created_at DESC, a.id
          LIMIT $3`,
        [workspaceId, options.status, options.limit],
      );
      return result.rows.map(toAlert);
    },
  };
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
                summary, actor, source, client_name, reversal_of)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
            event.reversalOf,
          ],
        );
        // INSERT ... RETURNING always yields exactly one row, and the join finds the resource we hold locked.
        return toEvent(result.rows[0] as EventRow);
      } catch (error) {
        if (error instanceof DatabaseError && error.code === UNIQUE_VIOLATION) {
          if (error.constraint === COMMAND_UNIQUE_CONSTRAINT) {
            throw new DuplicateCommandError(event.workspaceId, event.commandId);
          }
          if (error.constraint === REVERSAL_UNIQUE_INDEX) {
            throw new AlreadyReversedError(event.reversalOf);
          }
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

    async insertCommand(command: NewCommand) {
      await client.query(
        `INSERT INTO commands
           (token_hash, workspace_id, command_id, actor, source, client_name, operation, resource_id, request_args,
            secondary_resource_id, reversing_event_id, expected_version, reason, readback, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          command.tokenHash,
          command.workspaceId,
          command.commandId,
          command.actor,
          command.source,
          command.clientName,
          command.operation,
          command.resourceId,
          JSON.stringify(command.arguments),
          command.secondaryResourceId,
          command.reversingEventId,
          command.expectedVersion,
          command.reason,
          command.readback,
          command.expiresAt,
        ],
      );
    },

    async lockCommand(id) {
      const result = await client.query<CommandRow>('SELECT * FROM commands WHERE id = $1 FOR UPDATE', [id]);
      const [row] = result.rows;
      if (!row) {
        throw new Error(`Pending change "${id}" does not exist.`);
      }
      return toCommand(row);
    },

    async updateCommandStatus(id, status, eventId) {
      await client.query('UPDATE commands SET status = $2, event_id = $3, resolved_at = now() WHERE id = $1', [
        id,
        status,
        eventId,
      ]);
    },

    async openAlert(alert: NewAlert) {
      const result = await client.query<AlertRow>(
        `WITH a AS (
           INSERT INTO alerts (workspace_id, resource_id, rule, message, opened_by_event)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (workspace_id, resource_id, rule) WHERE status = 'open' DO NOTHING
           RETURNING *
         )
         SELECT ${ALERT_COLUMNS} FROM a ${ALERT_JOIN}`,
        [alert.workspaceId, alert.resourceId, alert.rule, alert.message, alert.eventId],
      );
      const [row] = result.rows;
      return row ? toAlert(row) : undefined;
    },

    async resolveAlerts(workspaceId, resourceId, rule, eventId) {
      const result = await client.query<AlertRow>(
        `WITH a AS (
           UPDATE alerts
              SET status = 'resolved', resolved_by_event = $4, resolved_at = now()
            WHERE workspace_id = $1 AND resource_id = $2 AND rule = $3 AND status = 'open'
            RETURNING *
         )
         SELECT ${ALERT_COLUMNS} FROM a ${ALERT_JOIN}`,
        [workspaceId, resourceId, rule, eventId],
      );
      return result.rows.map(toAlert);
    },
  };
}

export function createPgStore(pool: Pool): Store {
  /** Runs `work` on one connection inside BEGIN/COMMIT, rolling back if it throws. */
  async function inTransaction<T>(begin: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(begin);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    ...createReads(pool),

    async getBoardSnapshot(workspaceId, eventLimit) {
      // One snapshot, so the board's version always matches the content shown with it.
      return inTransaction('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', async (client) => {
        const reads = createReads(client);
        const workspace = await reads.getWorkspace(workspaceId);
        if (!workspace) {
          return undefined;
        }
        return {
          workspace,
          resources: await reads.listResources(workspaceId),
          openAlerts: await reads.listAlerts(workspaceId, { status: 'open', limit: 100 }),
          recentEvents: await reads.listEvents(workspaceId, { limit: eventLimit }),
        };
      });
    },

    async requeueSync(workspaceId, eventId, destination) {
      const requeued = await pool.query(
        `UPDATE sync_jobs
            SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, updated_at = now()
          WHERE workspace_id = $1 AND event_id = $2 AND destination = $3 AND status IN ('failed', 'retrying')
          RETURNING id`,
        [workspaceId, eventId, destination],
      );
      if (requeued.rows.length > 0) {
        return { result: 'requeued' };
      }
      const current = await pool.query<{ status: SyncStatus }>(
        'SELECT status FROM sync_jobs WHERE workspace_id = $1 AND event_id = $2 AND destination = $3',
        [workspaceId, eventId, destination],
      );
      const [row] = current.rows;
      return row ? { result: 'unchanged', status: row.status } : { result: 'missing' };
    },

    async ping() {
      await pool.query('SELECT 1');
    },

    withTransaction: (work) => inTransaction('BEGIN', (client) => work(createTransactionStore(client))),
  };
}
