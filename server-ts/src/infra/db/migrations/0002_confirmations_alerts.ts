import type { Migration } from '../migrator.js';

export const migration0002: Migration = {
  id: '0002_confirmations_alerts',
  sql: `
    -- An event can be undone at most once (concurrent undos: one wins, the other violates this).
    CREATE UNIQUE INDEX events_reversal_of_unique ON events (reversal_of) WHERE reversal_of IS NOT NULL;

    -- Changes waiting for a human "yes". The confirmation token itself is never stored, only its hash.
    CREATE TABLE commands (
      id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash             text NOT NULL UNIQUE,
      workspace_id           text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      -- the idempotency key the eventual event will carry
      command_id             text NOT NULL,
      actor                  text NOT NULL,
      source                 text NOT NULL CHECK (source IN ('mcp', 'alexa', 'dashboard')),
      client_name            text,
      operation              text NOT NULL,
      resource_id            text NOT NULL,
      request_args           jsonb NOT NULL,
      secondary_resource_id  text,
      reversing_event_id     uuid REFERENCES events (event_id),
      -- the change is only applied if the resource is still at this version when confirmed
      expected_version       integer NOT NULL CHECK (expected_version > 0),
      reason                 text NOT NULL,
      readback               text NOT NULL,
      status                 text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
      event_id               uuid REFERENCES events (event_id),
      expires_at             timestamptz NOT NULL,
      created_at             timestamptz NOT NULL DEFAULT now(),
      resolved_at            timestamptz,
      FOREIGN KEY (workspace_id, resource_id) REFERENCES resources (workspace_id, id)
    );
    CREATE INDEX commands_pending_idx ON commands (expires_at) WHERE status = 'pending';

    -- Derived from committed events by rules (e.g. low stock); never created directly by a command.
    CREATE TABLE alerts (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id       text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
      resource_id        text NOT NULL,
      rule               text NOT NULL,
      status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      message            text NOT NULL,
      opened_by_event    uuid REFERENCES events (event_id),
      resolved_by_event  uuid REFERENCES events (event_id),
      created_at         timestamptz NOT NULL DEFAULT now(),
      resolved_at        timestamptz,
      FOREIGN KEY (workspace_id, resource_id) REFERENCES resources (workspace_id, id)
    );
    -- at most one open alert per resource and rule: "exactly one low-stock alert"
    CREATE UNIQUE INDEX alerts_one_open_idx ON alerts (workspace_id, resource_id, rule) WHERE status = 'open';
    CREATE INDEX alerts_workspace_idx ON alerts (workspace_id, created_at DESC);
  `,
};
