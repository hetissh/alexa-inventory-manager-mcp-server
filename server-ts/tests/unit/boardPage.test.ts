import { runInNewContext, Script } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { BOARD_CSS, BOARD_JS, boardHtml } from '../../src/http/boardPage.js';

/** Just enough DOM for the page script: it only builds elements and sets text. */
class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  className = '';
  hidden = false;
  private ownText = '';

  constructor(readonly tag: string) {}

  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.children.length = 0;
    this.ownText = value;
  }

  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeNode): FakeNode {
    this.children.splice(this.children.indexOf(child), 1);
    return child;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  /** Every descendant with this class, in document order. */
  all(className: string): FakeNode[] {
    return this.children.flatMap((child) => [
      ...(child.className.split(' ').includes(className) ? [child] : []),
      ...child.all(className),
    ]);
  }
}

interface FakeResponse {
  status: number;
  ok: boolean;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
}

const board = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  workspaceId: 'northside-warehouse',
  title: 'Northside Operations',
  version: 3,
  generatedAt: '2026-10-19T09:00:00.000Z',
  metrics: [
    { label: 'Low stock', value: 1 },
    { label: 'Equipment down', value: 0 },
  ],
  resources: [
    { id: 'item_brake_pads', type: 'inventory_item', name: 'Brake Pads', attributes: { quantity: 2, unit: 'pieces', reorderLevel: 5 }, hasAlert: true },
    { id: 'item_air_filter', type: 'inventory_item', name: 'Air Filter', attributes: { quantity: 35, unit: 'pieces', reorderLevel: 10 }, hasAlert: false },
    { id: 'equipment_compressor_2', type: 'equipment', name: 'Compressor 2', attributes: { status: 'available' }, hasAlert: false },
  ],
  alerts: [{ id: 'a1', resourceId: 'item_brake_pads', resourceName: 'Brake Pads', message: 'Brake Pads is low on stock: 2 pieces left (reorder level 5).', createdAt: '2026-10-19T09:00:00.000Z' }],
  recentActivity: [{ summary: 'Removed 10 pieces from Brake Pads (12 to 2)', resourceName: 'Brake Pads', createdAt: '2026-10-19T09:00:05.000Z' }],
  ...overrides,
});

const ok = (body: Record<string, unknown>, etag = '"3"'): FakeResponse => ({
  status: 200,
  ok: true,
  headers: { get: (name) => (name === 'ETag' ? etag : null) },
  json: () => Promise.resolve(body),
});
const status = (code: number): FakeResponse => ({
  status: code,
  ok: code >= 200 && code < 300,
  headers: { get: () => null },
  json: () => Promise.reject(new Error('no body')),
});

function startPage(options: { hash?: string; workspace?: string; pollMs?: string } = {}) {
  const nodes = new Map<string, FakeNode>();
  for (const id of ['board', 'title', 'status', 'metrics', 'alerts', 'resources', 'activity', 'activity-list']) {
    nodes.set(id, new FakeNode('div'));
  }
  const root = nodes.get('board');
  root?.attributes.set('data-workspace', options.workspace ?? 'northside-warehouse');
  if (options.pollMs !== undefined) {
    root?.attributes.set('data-poll-ms', options.pollMs);
  }
  const document = {
    title: '',
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElement: (tag: string) => new FakeNode(tag),
  };
  const calls: { url: string; init: { headers: Record<string, string>; cache: string } }[] = [];
  const responses: (FakeResponse | Error)[] = [];
  const timers: { callback: () => void; ms: number }[] = [];
  const sandbox = {
    document,
    location: { hash: options.hash ?? '' },
    fetch: (url: string, init: { headers: Record<string, string>; cache: string }) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (next === undefined) {
        return Promise.reject(new Error('no response scripted'));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    setTimeout: (callback: () => void, ms: number) => timers.push({ callback, ms }),
  };
  const flush = async (): Promise<void> => {
    for (let turn = 0; turn < 20; turn += 1) {
      await Promise.resolve();
    }
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    document,
    calls,
    timers,
    flush,
    node: (id: string): FakeNode => nodes.get(id) ?? new FakeNode('missing'),
    /** Queues what the next fetch will return, starts the script if it has not started, and waits for it to settle. */
    async next(response: FakeResponse | Error): Promise<void> {
      responses.push(response);
      if (calls.length === 0 && timers.length === 0) {
        runInNewContext(BOARD_JS, sandbox);
      } else {
        timers.at(-1)?.callback();
      }
      await flush();
    },
  };
}

describe('the board page script', () => {
  it('asks for this workspace\'s board and draws it', async () => {
    const page = startPage();

    await page.next(ok(board()));

    expect(page.calls).toEqual([
      { url: '/workspaces/northside-warehouse/board', init: { headers: { Accept: 'application/json' }, cache: 'no-store' } },
    ]);
    expect(page.node('title').textContent).toBe('Northside Operations');
    expect(page.document.title).toBe('Northside Operations · VoiceOps');
    expect(page.node('status').textContent).toMatch(/^Live · updated /);
    expect(page.node('status').className).toBe('status');
    expect(page.node('metrics').children.map((tile) => tile.textContent)).toEqual(['1Low stock', '0Equipment down']);
    expect(page.node('alerts').hidden).toBe(false);
    expect(page.node('alerts').textContent).toBe('Brake Pads is low on stock: 2 pieces left (reorder level 5).');
    const rows = page.node('resources').all('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Brake Pads2 pieces (reorder at 5)low stock',
      'Air Filter35 pieces (reorder at 10)in stock',
      'Compressor 2available',
    ]);
    expect(rows[0]?.className).toContain('alert');
    expect(page.node('resources').children.map((group) => group.children[0]?.textContent)).toEqual(['Stock', 'Equipment']);
    expect(page.node('activity').hidden).toBe(false);
    expect(page.node('activity-list').children[0]?.textContent).toContain('Removed 10 pieces from Brake Pads (12 to 2)');
  });

  it('polls again after the interval, asking only for what changed', async () => {
    const page = startPage({ pollMs: '4500' });
    await page.next(ok(board()));
    expect(page.timers.map((timer) => timer.ms)).toEqual([4500]);

    await page.next(status(304));

    expect(page.calls[1]?.init.headers).toEqual({ Accept: 'application/json', 'If-None-Match': '"3"' });
    expect(page.node('status').className).toBe('status');
    expect(page.node('metrics').children).toHaveLength(2); // still drawn
    expect(page.timers).toHaveLength(2);
  });

  it('redraws when the board changed, and hides sections that became empty', async () => {
    const page = startPage();
    await page.next(ok(board()));

    await page.next(ok(board({ version: 4, metrics: [{ label: 'Low stock', value: 0 }], alerts: [], recentActivity: [] }), '"4"'));

    expect(page.node('metrics').children.map((tile) => tile.textContent)).toEqual(['0Low stock']);
    expect(page.node('alerts').hidden).toBe(true);
    expect(page.node('activity').hidden).toBe(true);
    await page.next(status(304));
    expect(page.calls[2]?.init.headers['If-None-Match']).toBe('"4"');
  });

  it('keeps showing the last good board, says how old it is, and recovers', async () => {
    const page = startPage();
    await page.next(ok(board()));
    const updated = page.node('status').textContent.replace('Live · updated ', '');

    await page.next(new Error('network down'));

    expect(page.node('status').className).toBe('status stale');
    expect(page.node('status').textContent).toBe(`Offline: showing the last update from ${updated}`);
    expect(page.node('title').textContent).toBe('Northside Operations');
    expect(page.node('metrics').children).toHaveLength(2);
    expect(page.node('resources').all('row')).toHaveLength(3);
    expect(page.timers).toHaveLength(2); // still trying

    await page.next(status(500));
    expect(page.node('status').className).toBe('status stale');

    await page.next(ok(board({ version: 5 }), '"5"'));
    expect(page.node('status').className).toBe('status');
    expect(page.node('status').textContent).toMatch(/^Live · updated /);
  });

  it.each([
    [new Error('refused'), 'Cannot reach the server. Retrying…'],
    [status(401), 'This board needs an access token (add #token=... to the address). Retrying…'],
    [status(404), 'There is no board for this workspace. Retrying…'],
    [status(503), 'The server answered 503. Retrying…'],
  ])('says what is wrong, without drawing anything, when there has never been a board', async (response, message) => {
    const page = startPage();

    await page.next(response);

    expect(page.node('status').className).toBe('status error');
    expect(page.node('status').textContent).toBe(message);
    expect(page.node('metrics').children).toEqual([]);
    expect(page.timers).toHaveLength(1);
  });

  it('survives a reply it cannot read', async () => {
    const page = startPage();
    await page.next({ ...ok(board()), json: () => Promise.reject(new Error('not json')) });
    expect(page.node('status').className).toBe('status error');
    expect(page.timers).toHaveLength(1);
  });

  it('sends the access token from the address fragment, never in the URL', async () => {
    const page = startPage({ hash: '#other=1&token=abc%20def&x=2' });

    await page.next(ok(board()));

    expect(page.calls[0]?.init.headers.Authorization).toBe('Bearer abc def');
    expect(page.calls[0]?.url).not.toContain('abc');
  });

  it('sends no token when the address has none', async () => {
    for (const hash of ['', '#', '#other=1']) {
      const page = startPage({ hash });
      await page.next(ok(board()));
      expect(page.calls[0]?.init.headers).not.toHaveProperty('Authorization');
    }
  });

  it('falls back to a 3 second interval when none is given', async () => {
    const page = startPage({ pollMs: 'soon' });
    await page.next(ok(board()));
    expect(page.timers.map((timer) => timer.ms)).toEqual([3000]);
    expect(startPage().timers).toEqual([]);
  });

  it('encodes the workspace id in the URL', async () => {
    const page = startPage({ workspace: 'harbor-cafe' });
    await page.next(ok(board()));
    expect(page.calls[0]?.url).toBe('/workspaces/harbor-cafe/board');
  });

  it('draws menu items, jobs and technicians the way people read them', async () => {
    const page = startPage();
    await page.next(
      ok(
        board({
          alerts: [],
          resources: [
            { id: 'menu_a', type: 'menu_item', name: 'Chicken Biryani', attributes: { price: 260, currency: 'INR', status: 'sold_out' }, hasAlert: false },
            { id: 'menu_b', type: 'menu_item', name: 'Lime Soda', attributes: { price: 80, currency: 'INR', status: 'available' }, hasAlert: false },
            { id: 'tech_rahul', type: 'technician', name: 'Rahul', attributes: { active: true }, hasAlert: false },
            { id: 'tech_vikram', type: 'technician', name: 'Vikram', attributes: { active: false }, hasAlert: false },
            { id: 'job_108', type: 'job', name: 'Job 108', attributes: { status: 'in_progress', assigneeId: 'tech_rahul', description: 'Brake overhaul' }, hasAlert: false },
            { id: 'job_109', type: 'job', name: 'Job 109', attributes: { status: 'waiting', assigneeId: null, description: 'Clutch' }, hasAlert: false },
            { id: 'job_110', type: 'job', name: 'Job 110', attributes: { status: 'assigned', assigneeId: 'tech_gone', description: 'Oil' }, hasAlert: false },
            { id: 'equipment_lift', type: 'equipment', name: 'Lift 1', attributes: { status: 'out_of_service' }, hasAlert: false },
          ],
        }),
      ),
    );

    const rows = Object.fromEntries(page.node('resources').all('row').map((row) => [row.children[0]?.textContent ?? '', row]));
    expect(rows['Chicken Biryani']?.textContent).toBe('Chicken Biryani260 INRsold out');
    expect(rows['Chicken Biryani']?.className).toContain('soldout');
    expect(rows['Lime Soda']?.className).not.toContain('soldout');
    expect(rows['Rahul']?.textContent).toBe('Rahulon duty');
    expect(rows['Vikram']?.textContent).toBe('Vikramoff duty');
    expect(rows['Vikram']?.className).toContain('off');
    expect(rows['Job 108']?.textContent).toBe('Job 108Brake overhaul · Rahulin progress');
    expect(rows['Job 109']?.textContent).toBe('Job 109Clutch · unassignedwaiting');
    expect(rows['Job 110']?.textContent).toBe('Job 110Oil · tech_goneassigned');
    expect(rows['Lift 1']?.textContent).toBe('Lift 1out of service');
    expect(rows['Lift 1']?.className).toContain('down');
    expect(page.node('resources').children.map((group) => group.children[0]?.textContent)).toEqual([
      'Menu',
      'Jobs',
      'Technicians',
      'Equipment',
    ].sort((a, b) => ['Stock', 'Equipment', 'Menu', 'Jobs', 'Technicians'].indexOf(a) - ['Stock', 'Equipment', 'Menu', 'Jobs', 'Technicians'].indexOf(b)));
  });

  it('draws dining tables with their seats, and marks the ones that are busy or held', async () => {
    const page = startPage();
    await page.next(
      ok(
        board({
          alerts: [],
          resources: [
            { id: 'table_1', type: 'dining_table', name: 'Table 1', attributes: { status: 'free', seats: 2 }, hasAlert: false },
            { id: 'table_3', type: 'dining_table', name: 'Table 3', attributes: { status: 'occupied', seats: 4 }, hasAlert: false },
            { id: 'table_6', type: 'dining_table', name: 'Table 6', attributes: { status: 'reserved', seats: 8 }, hasAlert: false },
            { id: 'table_7', type: 'dining_table', name: 'Table 7', attributes: { status: 'cleaning', seats: 2 }, hasAlert: false },
          ],
        }),
      ),
    );

    const rows = Object.fromEntries(page.node('resources').all('row').map((row) => [row.children[0]?.textContent ?? '', row]));
    expect(rows['Table 1']?.textContent).toBe('Table 1seats 2free');
    expect(rows['Table 3']?.textContent).toBe('Table 3seats 4occupied');
    expect(rows['Table 3']?.className).toContain('busy');
    expect(rows['Table 6']?.textContent).toBe('Table 6seats 8reserved');
    expect(rows['Table 6']?.className).toContain('held');
    expect(rows['Table 7']?.className).not.toMatch(/busy|held/);
    expect(page.node('resources').children.map((group) => group.children[0]?.textContent)).toEqual(['Tables']);
  });

  it('puts server text on the page as text, never as markup', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const page = startPage();

    await page.next(ok(board({ title: hostile, resources: [{ id: 'item_x', type: 'inventory_item', name: hostile, attributes: { quantity: 1, unit: 'pieces', reorderLevel: 1 }, hasAlert: false }] })));

    expect(page.node('title').textContent).toBe(hostile);
    expect(page.node('resources').all('name')[0]?.textContent).toBe(hostile);
    for (const dangerous of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
      expect(BOARD_JS).not.toContain(dangerous);
    }
  });

  it('is plain ES2017 that parses everywhere the Fire TV browser might', () => {
    expect(() => new Script(BOARD_JS)).not.toThrow();
    for (const modern of ['?.', '??', '=>', 'replaceChildren', 'let ', 'const ', 'class ']) {
      expect(BOARD_JS).not.toContain(modern);
    }
  });
});

describe('the board page shell', () => {
  it('names the workspace and the poll interval, and loads only its own script and stylesheet', () => {
    const html = boardHtml('harbor-cafe', 4000);

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('data-workspace="harbor-cafe"');
    expect(html).toContain('data-poll-ms="4000"');
    expect(html).toContain('<script src="/board/assets/board.js" defer></script>');
    expect(html).toContain('<link rel="stylesheet" href="/board/assets/board.css">');
    expect(html).toContain('role="status"');
    expect(html.match(/<script/g)).toHaveLength(1); // no inline script: the page's policy forbids it
    expect(html).not.toMatch(/\son[a-z]+=/);
  });

  it('has a stylesheet that is large and high-contrast for a screen across the room', () => {
    expect(BOARD_CSS).toContain('clamp(18px, 2vw, 36px)');
    expect(BOARD_CSS).toContain('.status.stale');
    expect(BOARD_CSS).toContain('.row.alert');
    expect(BOARD_CSS).toContain('.row.soldout');
  });
});
