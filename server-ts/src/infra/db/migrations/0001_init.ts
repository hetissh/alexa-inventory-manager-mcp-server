import type { Migration } from '../migrator.js';

export const migration0001: Migration = {
  id: '0001_init',
  sql: `
    CREATE TABLE workspaces (
      id             text PRIMARY KEY,
      name           text NOT NULL,
      template       text NOT NULL,
      timezone       text NOT NULL DEFAULT 'Asia/Kolkata',
      -- bumped on every committed change; boards compare it to know when to refresh
      board_version  bigint NOT NULL DEFAULT 0,
      -- e.g. {"sheets": {"spreadsheetId": "..."}}; absent key = destination not configured
      integrations   jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at     timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE resources (
      workspace_id  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      id            text NOT NULL,
      type          text NOT NULL,
      name          text NOT NULL,
      aliases       text[] NOT NULL DEFAULT '{}',
      attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
      version       integer NOT NULL DEFAULT 1 CHECK (version > 0),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, id)
    );

    -- Immutable ledger of committed changes. Corrections are new events, never updates.
    CREATE TABLE events (
      event_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      seq           bigint GENERATED ALWAYS AS IDENTITY,
      workspace_id  text NOT NULL,
      command_id    text NOT NULL,
      resource_id   text NOT NULL,
      operation     text NOT NULL,
      request_args  jsonb NOT NULL,
      before_state  jsonb NOT NULL,
      after_state   jsonb NOT NULL,
      summary       text NOT NULL,
      actor         text NOT NULL,
      source        text NOT NULL CHECK (source IN ('mcp', 'alexa', 'dashboard')),
      client_name   text,
      created_at    timestamptz NOT NULL DEFAULT now(),
      reversal_of   uuid REFERENCES events (event_id),
      -- idempotency: one command ID, one event, per workspace
      CONSTRAINT events_workspace_command_unique UNIQUE (workspace_id, command_id),
      FOREIGN KEY (workspace_id, resource_id) REFERENCES resources (workspace_id, id)
    );
    CREATE INDEX events_workspace_seq_idx ON events (workspace_id, seq DESC);
    CREATE INDEX events_resource_seq_idx ON events (workspace_id, resource_id, seq DESC);

    -- Transactional outbox: written in the same transaction as the event it describes.
    CREATE TABLE sync_jobs (
      id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      workspace_id     text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      event_id         uuid NOT NULL REFERENCES events (event_id),
      destination      text NOT NULL,
      status           text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'in_progress', 'synced', 'retrying', 'failed')),
      attempts         integer NOT NULL DEFAULT 0,
      next_attempt_at  timestamptz NOT NULL DEFAULT now(),
      last_error       text,
      updated_at       timestamptz NOT NULL DEFAULT now(),
      UNIQUE (event_id, destination)
    );
    CREATE INDEX sync_jobs_due_idx ON sync_jobs (next_attempt_at) WHERE status IN ('pending', 'retrying');
  `,
};
