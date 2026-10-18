import {
  type Candidate,
  type MatchKind,
  rankResources,
  resolveResource,
} from '../domain/matcher.js';
import type { Resource, ResourceType } from '../domain/schemas.js';
import type { AppLogger, ListedEvent, Store } from './ports.js';
import { spokenAmbiguous, spokenEvents, spokenNotFound, spokenResource } from './spoken.js';

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

export interface ReadService {
  health(): Promise<{ readonly database: 'ok' | 'unavailable' }>;
  findResources(workspaceId: string, input: FindResourcesInput): Promise<FindResourcesResult>;
  getResource(workspaceId: string, query: string): Promise<GetResourceOutcome>;
  listEvents(workspaceId: string, input: ListEventsInput): Promise<ListEventsOutcome>;
}

function byTypeThenName(a: Resource, b: Resource): number {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
}

export function createReadService(store: Store, logger: AppLogger): ReadService {
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
  };
}
