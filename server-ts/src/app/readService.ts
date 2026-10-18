import { type BoardMetric, computeMetrics } from '../domain/board.js';
import {
  type Candidate,
  type MatchKind,
  rankResources,
  resolveResource,
} from '../domain/matcher.js';
import type { Resource, ResourceType } from '../domain/schemas.js';
import type { AlertRecord, AlertStatus, Workspace, WorkspaceSettings } from '../domain/types.js';
import { getTemplate } from '../templates/index.js';
import { WorkspaceNotFoundError } from './errors.js';
import type { AppLogger, ListedEvent, Store } from './ports.js';
import {
  spokenAlertList,
  spokenAmbiguous,
  spokenBoard,
  spokenEvents,
  spokenNotFound,
  spokenResource,
  spokenWorkspace,
} from './spoken.js';

export interface FindResourcesInput {
  /** Free text to match against names and aliases. Empty or missing lists everything. */
  readonly query?: string;
  readonly type?: ResourceType;
  readonly limit: number;
}

export interface FoundResource {
  readonly resource: Resource;
  /** Null when the resource was listed rather than matched by a query. */
  readonly matchedBy: MatchKind | null;
  readonly score: number | null;
}

export interface FindResourcesResult {
  /** How many resources matched before `limit` was applied. */
  readonly total: number;
  readonly items: readonly FoundResource[];
}

export type GetResourceOutcome =
  | { readonly status: 'found'; readonly resource: Resource; readonly matchedBy: MatchKind; readonly spoken: string }
  | {
      readonly status: 'ambiguous';
      readonly query: string;
      readonly candidates: readonly Candidate[];
      readonly spoken: string;
    }
  | { readonly status: 'not_found'; readonly query: string; readonly spoken: string };

export interface ListEventsInput {
  readonly limit: number;
  /** Only events for this resource (spoken name or ID). */
  readonly resource?: string;
}

export type ListEventsOutcome =
  | { readonly status: 'ok'; readonly events: readonly ListedEvent[]; readonly spoken: string }
  | {
      readonly status: 'ambiguous';
      readonly query: string;
      readonly candidates: readonly Candidate[];
      readonly spoken: string;
    }
  | { readonly status: 'not_found'; readonly query: string; readonly spoken: string };

export interface ListAlertsInput {
  readonly status: AlertStatus | 'all';
  readonly limit: number;
}

export interface Board {
  readonly workspaceId: string;
  readonly title: string;
  /** Changes whenever the board's content may have changed; a screen refreshes when it differs from the one it has. */
  readonly version: number;
  readonly generatedAt: Date;
  readonly metrics: readonly BoardMetric[];
  readonly resources: readonly { readonly resource: Resource; readonly hasAlert: boolean }[];
  readonly alerts: readonly AlertRecord[];
  readonly recentActivity: readonly ListedEvent[];
  readonly spoken: string;
}

export interface WorkspaceInfo {
  readonly workspace: Workspace;
  readonly templateLabel: string;
  readonly settings: WorkspaceSettings;
  readonly counts: Readonly<Partial<Record<ResourceType, number>>>;
  readonly spoken: string;
}

export interface ReadService {
  health(): Promise<{ readonly database: 'ok' | 'unavailable' }>;
  findResources(workspaceId: string, input: FindResourcesInput): Promise<FindResourcesResult>;
  getResource(workspaceId: string, query: string): Promise<GetResourceOutcome>;
  listEvents(workspaceId: string, input: ListEventsInput): Promise<ListEventsOutcome>;
  listAlerts(workspaceId: string, input: ListAlertsInput): Promise<{ readonly alerts: readonly AlertRecord[]; readonly spoken: string }>;
  getBoard(workspaceId: string): Promise<Board>;
  getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo>;
}

const BOARD_ACTIVITY_LIMIT = 10;

function byTypeThenName(a: Resource, b: Resource): number {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
}

export function createReadService(
  store: Store,
  logger: AppLogger,
  now: () => Date = () => new Date(),
): ReadService {
  return {
    async health() {
      try {
        await store.ping();
        return { database: 'ok' };
      } catch (error) {
        logger.warn({ err: error }, 'database health check failed');
        return { database: 'unavailable' };
      }
    },

    async findResources(workspaceId, input) {
      const resources = await store.listResources(workspaceId, input.type ? { types: [input.type] } : undefined);
      const query = input.query?.trim() ?? '';
      const matches: FoundResource[] =
        query === ''
          ? [...resources].sort(byTypeThenName).map((resource) => ({ resource, matchedBy: null, score: null }))
          : rankResources(query, resources).map(({ resource, matchedBy, score }) => ({ resource, matchedBy, score }));
      return { total: matches.length, items: matches.slice(0, input.limit) };
    },

    async getResource(workspaceId, query) {
      const resources = await store.listResources(workspaceId);
      // Reading is harmless, so a unique high-confidence typo match may resolve without asking.
      const resolution = resolveResource(query, resources, { autoResolveFuzzy: true });
      if (resolution.kind === 'not_found') {
        return { status: 'not_found', query, spoken: spokenNotFound(query) };
      }
      if (resolution.kind === 'ambiguous') {
        return {
          status: 'ambiguous',
          query,
          candidates: resolution.candidates,
          spoken: spokenAmbiguous(query, resolution.candidates),
        };
      }
      const { resource, matchedBy } = resolution.match;
      return { status: 'found', resource, matchedBy, spoken: spokenResource(resource) };
    },

    async listEvents(workspaceId, input) {
      let resourceId: string | undefined;
      if (input.resource !== undefined) {
        const resolution = resolveResource(input.resource, await store.listResources(workspaceId), {
          autoResolveFuzzy: true,
        });
        if (resolution.kind === 'not_found') {
          return { status: 'not_found', query: input.resource, spoken: spokenNotFound(input.resource) };
        }
        if (resolution.kind === 'ambiguous') {
          return {
            status: 'ambiguous',
            query: input.resource,
            candidates: resolution.candidates,
            spoken: spokenAmbiguous(input.resource, resolution.candidates),
          };
        }
        resourceId = resolution.match.resource.id;
      }
      const events = await store.listEvents(workspaceId, { limit: input.limit, resourceId });
      return { status: 'ok', events, spoken: spokenEvents(events.length) };
    },

    async listAlerts(workspaceId, input) {
      const alerts = await store.listAlerts(workspaceId, input);
      return { alerts, spoken: spokenAlertList(alerts.length, input.status) };
    },

    async getBoard(workspaceId) {
      const snapshot = await store.getBoardSnapshot(workspaceId, BOARD_ACTIVITY_LIMIT);
      if (!snapshot) {
        throw new WorkspaceNotFoundError(workspaceId);
      }
      const { board } = getTemplate(snapshot.workspace.template);
      const alerted = new Set(snapshot.openAlerts.map((alert) => alert.resourceId));
      const metrics = computeMetrics(board.metrics, snapshot.resources, snapshot.openAlerts);
      return {
        workspaceId,
        title: board.title,
        version: snapshot.workspace.boardVersion,
        generatedAt: now(),
        metrics,
        resources: snapshot.resources.map((resource) => ({ resource, hasAlert: alerted.has(resource.id) })),
        alerts: snapshot.openAlerts,
        recentActivity: snapshot.recentEvents,
        spoken: spokenBoard(board.title, metrics),
      };
    },

    async getWorkspaceInfo(workspaceId) {
      const workspace = await store.getWorkspace(workspaceId);
      if (!workspace) {
        throw new WorkspaceNotFoundError(workspaceId);
      }
      const template = getTemplate(workspace.template);
      const counts: Partial<Record<ResourceType, number>> = {};
      const resources = await store.listResources(workspaceId);
      for (const resource of resources) {
        counts[resource.type] = (counts[resource.type] ?? 0) + 1;
      }
      return {
        workspace,
        templateLabel: template.label,
        settings: template.settings,
        counts,
        spoken: spokenWorkspace(workspace.name, template.label, resources.length),
      };
    },
  };
}
