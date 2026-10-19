import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

import { WorkspaceNotFoundError } from '../app/errors.js';
import type { AppLogger } from '../app/ports.js';
import type { ReadService } from '../app/readService.js';
import { isLoopbackHost } from '../loopback.js';
import { BOARD_CSS, BOARD_JS, boardHtml } from './boardPage.js';
import { toBoardResponse } from './boardResponse.js';

export interface BoardServerDeps {
  readonly reads: ReadService;
  readonly logger: AppLogger;
  /** The only workspaces whose boards are served. */
  readonly workspaceIds: readonly string[];
  /** Where `/` sends the browser. */
  readonly defaultWorkspaceId: string;
  /** How often the page asks for updates. */
  readonly pollMs: number;
  /** When set, the board API requires `Authorization: Bearer <token>`. */
  readonly token: string | undefined;
  /**
   * When set, requests whose Host header names anything else are refused. Used when listening on a loopback
   * address, so a web page on another site cannot reach the board through a rebound DNS name.
   */
  readonly allowedHostnames: readonly string[] | undefined;
}

interface Reply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;
const BEARER = /^Bearer (.+)$/;
const HOSTNAME = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/;

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const;
const PAGE_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function json(status: number, body: unknown, extra: Record<string, string> = {}): Reply {
  return {
    status,
    headers: {
      ...BASE_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'none'",
      ...extra,
    },
    body: JSON.stringify(body),
  };
}

function asset(contentType: string, body: string): Reply {
  return {
    status: 200,
    headers: { ...BASE_HEADERS, 'Content-Type': contentType, 'Cache-Control': 'no-cache' },
    body,
  };
}

/**
 * The Host values a board bound to `host` answers to: only loopback names when it listens on a loopback address
 * (a web page on another site cannot reach it through a rebound DNS name), and anything when it listens more widely
 * (the bearer token is the protection there).
 */
export function hostAllowList(host: string): readonly string[] | undefined {
  return isLoopbackHost(host) ? ['localhost', '127.0.0.1', '[::1]'] : undefined;
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Compares in constant time, on hashes, so neither the content nor the length of the token leaks. */
function isAuthorized(header: string | undefined, token: string | undefined): boolean {
  if (token === undefined) {
    return true;
  }
  const presented = BEARER.exec(header ?? '')?.[1];
  return presented !== undefined && timingSafeEqual(digest(presented), digest(token));
}

function hostnameOf(request: IncomingMessage): string | undefined {
  return HOSTNAME.exec(request.headers.host ?? '')?.[1]?.toLowerCase();
}

export function createBoardServer(deps: BoardServerDeps): Server {
  const { reads, logger } = deps;

  async function route(request: IncomingMessage): Promise<Reply> {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      return json(405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
    }
    const hostname = hostnameOf(request);
    if (deps.allowedHostnames && (hostname === undefined || !deps.allowedHostnames.includes(hostname))) {
      return json(403, { error: 'host_not_allowed' });
    }

    let pathname: string;
    try {
      ({ pathname } = new URL(request.url ?? '/', 'http://board.invalid'));
    } catch {
      return json(400, { error: 'bad_request' });
    }
    const segments = pathname.split('/').filter((segment) => segment !== '');

    if (pathname === '/health') {
      const { database } = await reads.health();
      return json(database === 'ok' ? 200 : 503, { status: database === 'ok' ? 'ok' : 'degraded', database });
    }
    if (pathname === '/favicon.ico') {
      return { status: 204, headers: BASE_HEADERS };
    }
    if (pathname === '/') {
      return { status: 302, headers: { ...BASE_HEADERS, Location: `/board/${deps.defaultWorkspaceId}` } };
    }
    if (pathname === '/board/assets/board.js') {
      return asset('text/javascript; charset=utf-8', BOARD_JS);
    }
    if (pathname === '/board/assets/board.css') {
      return asset('text/css; charset=utf-8', BOARD_CSS);
    }

    const [first, workspaceId, third] = segments;
    if (first === 'board' && segments.length === 2) {
      if (workspaceId === undefined || !SLUG.test(workspaceId) || !deps.workspaceIds.includes(workspaceId)) {
        return json(404, { error: 'workspace_not_found' });
      }
      return {
        status: 200,
        headers: {
          ...BASE_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
          'Content-Security-Policy': PAGE_POLICY,
        },
        body: boardHtml(workspaceId, deps.pollMs),
      };
    }
    if (first === 'workspaces' && third === 'board' && segments.length === 3) {
      return boardJson(request, workspaceId);
    }
    return json(404, { error: 'not_found' });
  }

  async function boardJson(request: IncomingMessage, workspaceId: string | undefined): Promise<Reply> {
    if (!isAuthorized(request.headers.authorization, deps.token)) {
      return json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    }
    if (workspaceId === undefined || !SLUG.test(workspaceId)) {
      return json(400, { error: 'invalid_workspace_id' });
    }
    if (!deps.workspaceIds.includes(workspaceId)) {
      return json(404, { error: 'workspace_not_found' });
    }
    try {
      const board = await reads.getBoard(workspaceId);
      const etag = `"${String(board.version)}"`;
      const cached = request.headers['if-none-match'];
      if (cached === etag || cached === '*') {
        return { status: 304, headers: { ...BASE_HEADERS, ETag: etag, 'Cache-Control': 'no-cache' } };
      }
      return json(200, toBoardResponse(board), { ETag: etag });
    } catch (error) {
      if (error instanceof WorkspaceNotFoundError) {
        return json(404, { error: 'workspace_not_found' });
      }
      logger.warn({ err: error, workspaceId }, 'board request failed');
      return json(503, { error: 'unavailable' });
    }
  }

  return createServer((request, response) => {
    const started = Date.now();
    route(request)
      .catch((error: unknown): Reply => {
        logger.warn({ err: error }, 'board server error');
        return json(500, { error: 'internal_error' });
      })
      .then((reply) => {
        response.writeHead(reply.status, reply.headers);
        response.end(request.method === 'HEAD' ? undefined : reply.body);
        logger.info(
          { method: request.method, path: request.url?.split('?')[0], status: reply.status, ms: Date.now() - started },
          'board request',
        );
      })
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'could not answer a board request');
      });
  });
}
