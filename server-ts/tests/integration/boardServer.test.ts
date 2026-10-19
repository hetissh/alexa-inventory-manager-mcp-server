import { get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppLogger } from '../../src/app/ports.js';
import { createReadService, type ReadService } from '../../src/app/readService.js';
import { type BoardServerDeps, createBoardServer, hostAllowList } from '../../src/http/boardServer.js';
import { ALL_WORKSPACE_IDS, CAFE_ID, WORKSPACE_ID } from '../helpers/db.js';
import { httpRequest, jsonBody } from '../helpers/http.js';
import { adjust, useCommandHarness } from '../helpers/service.js';

const harness = useCommandHarness();
const info = vi.fn<AppLogger['info']>();
const warn = vi.fn<AppLogger['warn']>();
const logger: AppLogger = { info, warn };
const BOARD = `/workspaces/${WORKSPACE_ID}/board`;
const TOKEN = 'a-long-enough-board-token-1234';

const running: Server[] = [];
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(async () => {
  for (const server of running.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
});

/** Starts a board server over the test database and returns its port. */
async function serve(overrides: Partial<BoardServerDeps> = {}): Promise<number> {
  const h = harness();
  const server = createBoardServer({
    reads: createReadService(h.store, logger),
    logger,
    workspaceIds: ALL_WORKSPACE_IDS,
    defaultWorkspaceId: WORKSPACE_ID,
    pollMs: 3000,
    token: undefined,
    allowedHostnames: undefined,
    ...overrides,
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  running.push(server);
  return (server.address() as AddressInfo).port;
}

const readsWith = (override: Partial<ReadService>): ReadService => ({
  ...createReadService(harness().store, logger),
  ...override,
});

describe('GET /health', () => {
  it('says the database is fine', async () => {
    const reply = await httpRequest(await serve(), '/health');

    expect(reply.status).toBe(200);
    expect(jsonBody(reply)).toEqual({ status: 'ok', database: 'ok' });
  });

  it('says it is degraded, with a 503, when the database is down', async () => {
    const reads = readsWith({ health: () => Promise.resolve({ database: 'unavailable' }) });

    const reply = await httpRequest(await serve({ reads }), '/health');

    expect(reply.status).toBe(503);
    expect(jsonBody(reply)).toEqual({ status: 'degraded', database: 'unavailable' });
  });

  it('answers without a token, so a monitor does not need one', async () => {
    expect((await httpRequest(await serve({ token: TOKEN }), '/health')).status).toBe(200);
  });
});

describe('GET /workspaces/:id/board', () => {
  it('returns the board a screen draws, as JSON that must not be cached blindly', async () => {
    const reply = await httpRequest(await serve(), BOARD);

    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(reply.headers['cache-control']).toBe('no-cache');
    const body = jsonBody(reply);
    expect(body).toMatchObject({ workspaceId: WORKSPACE_ID, title: 'Northside Operations' });
    expect(body['resources']).toHaveLength(4);
    expect(reply.headers['etag']).toBe(`"${String(body['version'])}"`);
  });

  it('serves each allowed workspace its own board', async () => {
    const reply = await httpRequest(await serve(), `/workspaces/${CAFE_ID}/board`);

    expect(jsonBody(reply)).toMatchObject({ workspaceId: CAFE_ID, title: 'Harbor Cafe Menu' });
  });

  it('answers 304 while nothing changed, and sends the new board when something did', async () => {
    const h = harness();
    const port = await serve();
    const first = await httpRequest(port, BOARD);
    const etag = String(first.headers['etag']);

    const unchanged = await httpRequest(port, BOARD, { headers: { 'If-None-Match': etag } });
    expect(unchanged.status).toBe(304);
    expect(unchanged.body).toBe('');
    expect(unchanged.headers['etag']).toBe(etag);

    await adjust(h, 'Air Filter', 5);
    const changed = await httpRequest(port, BOARD, { headers: { 'If-None-Match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers['etag']).not.toBe(etag);
    expect(jsonBody(changed)['recentActivity']).toEqual([
      expect.objectContaining({ resourceName: 'Air Filter', summary: expect.stringContaining('Air Filter') as unknown }),
    ]);
  });

  it('treats If-None-Match: * as "I have some version"', async () => {
    expect((await httpRequest(await serve(), BOARD, { headers: { 'If-None-Match': '*' } })).status).toBe(304);
  });

  it('does not send who made a change or how', async () => {
    const h = harness();
    await adjust(h, 'Air Filter', 5);

    const text = (await httpRequest(await serve(), BOARD)).body;

    expect(text).not.toContain('manager-1');
    expect(text).not.toContain('test-client');
    expect(text).not.toContain('cmd-');
  });

  it('answers HEAD with the headers only', async () => {
    const reply = await httpRequest(await serve(), BOARD, { method: 'HEAD' });

    expect(reply.status).toBe(200);
    expect(reply.headers['etag']).toBeDefined();
    expect(reply.body).toBe('');
  });

  it('is read-only: every other method is refused', async () => {
    const port = await serve();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const reply = await httpRequest(port, BOARD, { method });
      expect(reply.status).toBe(405);
      expect(reply.headers['allow']).toBe('GET, HEAD');
      expect(jsonBody(reply)).toEqual({ error: 'method_not_allowed' });
    }
  });

  it('refuses a workspace that is not on the allow-list, even if it exists', async () => {
    const reply = await httpRequest(await serve({ workspaceIds: [WORKSPACE_ID] }), `/workspaces/${CAFE_ID}/board`);

    expect(reply.status).toBe(404);
    expect(jsonBody(reply)).toEqual({ error: 'workspace_not_found' });
  });

  it('says 404 for an allowed workspace that is not in the database', async () => {
    const port = await serve({ workspaceIds: [...ALL_WORKSPACE_IDS, 'ghost-workspace'] });

    const reply = await httpRequest(port, '/workspaces/ghost-workspace/board');

    expect(reply.status).toBe(404);
    expect(jsonBody(reply)).toEqual({ error: 'workspace_not_found' });
  });

  it('says 400 for something that cannot be a workspace id', async () => {
    const port = await serve();
    for (const id of ['Bad_ID', 'x', '..%2Fetc', 'a b']) {
      const reply = await httpRequest(port, `/workspaces/${id.replace(' ', '%20')}/board`);
      expect(reply.status, id).toBe(400);
      expect(jsonBody(reply)).toEqual({ error: 'invalid_workspace_id' });
    }
  });

  it('hides the cause of a failure from the screen and logs it', async () => {
    const reads = readsWith({ getBoard: () => Promise.reject(new Error('password authentication failed for user "voiceops"')) });

    const reply = await httpRequest(await serve({ reads }), BOARD);

    expect(reply.status).toBe(503);
    expect(jsonBody(reply)).toEqual({ error: 'unavailable' });
    expect(reply.body).not.toContain('password');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: WORKSPACE_ID }), 'board request failed');
  });
});

describe('the access token', () => {
  const board = (headers?: Record<string, string>) => async (): Promise<number> =>
    (await httpRequest(await serve({ token: TOKEN }), BOARD, headers ? { headers } : {})).status;

  it('lets a request through with the right bearer token', async () => {
    expect(await board({ Authorization: `Bearer ${TOKEN}` })()).toBe(200);
  });

  it.each([
    ['no Authorization header', undefined],
    ['the wrong token', { Authorization: 'Bearer not-the-board-token-at-all-0000' }],
    ['a token of the wrong length', { Authorization: 'Bearer x' }],
    ['the right token under another scheme', { Authorization: `Basic ${TOKEN}` }],
    ['the bare token', { Authorization: TOKEN }],
    ['an empty bearer', { Authorization: 'Bearer ' }],
  ])('refuses %s with 401', async (_label, headers) => {
    const reply = await httpRequest(await serve({ token: TOKEN }), BOARD, headers ? { headers } : {});

    expect(reply.status).toBe(401);
    expect(reply.headers['www-authenticate']).toBe('Bearer');
    expect(jsonBody(reply)).toEqual({ error: 'unauthorized' });
  });

  it('asks for the token before it says whether the workspace exists', async () => {
    const reply = await httpRequest(await serve({ token: TOKEN }), '/workspaces/no-such-workspace/board');

    expect(reply.status).toBe(401);
  });

  it('is not needed for the page, its script or its stylesheet: they hold no data', async () => {
    const port = await serve({ token: TOKEN });
    for (const path of [`/board/${WORKSPACE_ID}`, '/board/assets/board.js', '/board/assets/board.css']) {
      expect((await httpRequest(port, path)).status, path).toBe(200);
    }
  });
});

describe('the Host check', () => {
  const allowed = hostAllowList('127.0.0.1');

  it.each(['localhost', 'localhost:8787', '127.0.0.1:1234', '127.0.0.1', '[::1]:8787', 'LOCALHOST'])('answers a request for %s', async (host) => {
    expect((await httpRequest(await serve({ allowedHostnames: allowed }), '/health', { headers: { Host: host } })).status).toBe(200);
  });

  it.each(['evil.example.com', 'evil.example.com:8787', '192.168.1.20:8787', 'localhost.evil.example.com', ':80', '[::2]'])(
    'refuses a request for %s, as a rebound DNS name would send',
    async (host) => {
      const port = await serve({ allowedHostnames: allowed });
      for (const path of ['/health', BOARD, `/board/${WORKSPACE_ID}`]) {
        const reply = await httpRequest(port, path, { headers: { Host: host } });
        expect(reply.status, `${host} ${path}`).toBe(403);
        expect(jsonBody(reply)).toEqual({ error: 'host_not_allowed' });
      }
    },
  );

  it('does not apply when the board is meant to be reached over the network', async () => {
    const reply = await httpRequest(await serve({ allowedHostnames: undefined }), '/health', { headers: { Host: 'board.example.com' } });

    expect(reply.status).toBe(200);
  });

  it('allows loopback names only when listening on a loopback address', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
      expect(hostAllowList(host)).toEqual(['localhost', '127.0.0.1', '[::1]']);
    }
    for (const host of ['0.0.0.0', '192.168.1.20', 'board.example.com']) {
      expect(hostAllowList(host)).toBeUndefined();
    }
  });
});

describe('the page and everything around it', () => {
  it('sends / to the default workspace\'s board', async () => {
    const reply = await httpRequest(await serve({ defaultWorkspaceId: CAFE_ID }), '/');

    expect(reply.status).toBe(302);
    expect(reply.headers['location']).toBe(`/board/${CAFE_ID}`);
  });

  it('serves the page with a policy that allows only its own script and stylesheet', async () => {
    const reply = await httpRequest(await serve({ pollMs: 7000 }), `/board/${WORKSPACE_ID}`);

    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(reply.headers['content-security-policy']).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    expect(reply.body).toContain(`data-workspace="${WORKSPACE_ID}"`);
    expect(reply.body).toContain('data-poll-ms="7000"');
  });

  it('serves the script and stylesheet with the right types', async () => {
    const port = await serve();

    const script = await httpRequest(port, '/board/assets/board.js');
    const style = await httpRequest(port, '/board/assets/board.css');

    expect(script.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(script.body).toContain('/workspaces/');
    expect(style.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(style.body).toContain('.status.stale');
  });

  it('sends the same safety headers on everything', async () => {
    const port = await serve();
    for (const path of ['/health', BOARD, `/board/${WORKSPACE_ID}`, '/board/assets/board.js', '/nowhere', '/']) {
      const reply = await httpRequest(port, path);
      expect(reply.headers['x-content-type-options'], path).toBe('nosniff');
      expect(reply.headers['referrer-policy'], path).toBe('no-referrer');
      expect(reply.headers['cross-origin-resource-policy'], path).toBe('same-origin');
    }
  });

  it('gives a JSON error a policy that forbids everything', async () => {
    expect((await httpRequest(await serve(), '/nowhere')).headers['content-security-policy']).toBe("default-src 'none'");
  });

  it('says 404 for a workspace it does not serve, and for pages that do not exist', async () => {
    const port = await serve({ workspaceIds: [WORKSPACE_ID] });

    expect(jsonBody(await httpRequest(port, `/board/${CAFE_ID}`))).toEqual({ error: 'workspace_not_found' });
    expect(jsonBody(await httpRequest(port, '/board/Bad_ID'))).toEqual({ error: 'workspace_not_found' });
    for (const path of ['/nowhere', '/board', `/board/${WORKSPACE_ID}/extra`, '/workspaces', `/workspaces/${WORKSPACE_ID}`, '/board/assets/other.js']) {
      const reply = await httpRequest(port, path);
      expect(reply.status, path).toBe(404);
      expect(jsonBody(reply)).toEqual({ error: 'not_found' });
    }
  });

  it('answers a browser\'s favicon request quietly', async () => {
    const reply = await httpRequest(await serve(), '/favicon.ico');

    expect(reply.status).toBe(204);
    expect(reply.body).toBe('');
  });

  it('says 400 to a request target it cannot parse', async () => {
    const reply = await httpRequest(await serve(), '//');

    expect(reply.status).toBe(400);
    expect(jsonBody(reply)).toEqual({ error: 'bad_request' });
  });
});

describe('failures and logging', () => {
  it('answers 500, without details, when something unexpected goes wrong, and carries on', async () => {
    let broken = true;
    const reads = readsWith({
      health: () => (broken ? Promise.reject(new Error('internal secret detail')) : Promise.resolve({ database: 'ok' })),
    });
    const port = await serve({ reads });

    const failed = await httpRequest(port, '/health');
    expect(failed.status).toBe(500);
    expect(jsonBody(failed)).toEqual({ error: 'internal_error' });
    expect(failed.body).not.toContain('secret');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) as unknown }), 'board server error');

    broken = false;
    expect((await httpRequest(port, '/health')).status).toBe(200);
  });

  it('logs each request without its query string, which could hold a token', async () => {
    const port = await serve();

    await httpRequest(port, `${BOARD}?token=super-secret-value`);

    expect(info).toHaveBeenCalledWith(
      { method: 'GET', path: BOARD, status: 200, ms: expect.any(Number) as unknown },
      'board request',
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain('super-secret-value');
  });

  it('logs and survives a reply it cannot send', async () => {
    // A header value with a line break cannot be sent; the server must note it and stay up.
    const port = await serve({ defaultWorkspaceId: 'bad\nid' });
    const hung = get({ host: '127.0.0.1', port, path: '/', agent: false });
    hung.on('error', () => undefined);

    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) as unknown }), 'could not answer a board request');
    });
    hung.destroy();

    expect((await httpRequest(port, '/health')).status).toBe(200);
  });
});
