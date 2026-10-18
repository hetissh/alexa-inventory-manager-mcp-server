import { describe, expect, it } from 'vitest';

import { DB_USAGE, runDbCli } from '../../src/cli/db.js';
import { ensureDatabase } from '../../src/infra/db/admin.js';
import { createTestPool, withTempDatabase } from '../helpers/db.js';

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = [];
  const code = await runDbCli(args, { env, write: (line) => lines.push(line) });
  return { code, lines };
}

describe('db CLI', () => {
  it('prints usage and exits 2 for a missing or unknown command', async () => {
    for (const args of [[], ['explode']]) {
      expect(await run(args, {})).toEqual({ code: 2, lines: [DB_USAGE] });
    }
  });

  it('reports an invalid configuration', async () => {
    const { code, lines } = await run(['migrate'], { LOG_LEVEL: 'loud' });
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/^db migrate failed: Invalid configuration/);
  });

  it('creates a database once, then reports that it exists', async () => {
    await withTempDatabase(async (url) => {
      const env = { DATABASE_URL: url };
      const first = await run(['create'], env);
      expect(first.code).toBe(0);
      expect(first.lines).toEqual([expect.stringMatching(/^Database localhost:5432\/voiceops_test_tmp_\w+: created\.$/)]);
      expect((await run(['create'], env)).lines).toEqual([expect.stringMatching(/: exists\.$/)]);
    });
  });

  it('migrates, then says the schema is up to date', async () => {
    await withTempDatabase(async (url) => {
      await ensureDatabase(url);
      expect((await run(['migrate'], { DATABASE_URL: url })).lines).toEqual(['Applied migrations: 0001_init, 0002_confirmations_alerts.']);
      expect((await run(['migrate'], { DATABASE_URL: url })).lines).toEqual(['Schema is up to date.']);
    });
  });

  it('refuses to seed an unmigrated database and says how to fix it', async () => {
    await withTempDatabase(async (url) => {
      await ensureDatabase(url);
      const { code, lines } = await run(['seed'], { DATABASE_URL: url });
      expect(code).toBe(1);
      expect(lines).toEqual([expect.stringMatching(/^db seed failed: The database schema is out of date/)]);
    });
  });

  it('setup creates, migrates and seeds, and is safe to repeat; reset restores the fixture', async () => {
    await withTempDatabase(async (url) => {
      const env = { DATABASE_URL: url };

      const first = await run(['setup'], env);
      expect(first.code).toBe(0);
      expect(first.lines).toEqual([
        expect.stringMatching(/: created\.$/),
        'Applied migrations: 0001_init, 0002_confirmations_alerts.',
        'Workspace northside-warehouse: 4 resource(s) added.',
        'Workspace harbor-cafe: 5 resource(s) added.',
        'Workspace eastside-repairs: 8 resource(s) added.',
      ]);

      const again = await run(['setup'], env);
      expect(again.lines).toEqual([
        expect.stringMatching(/: exists\.$/),
        'Schema is up to date.',
        'Workspace northside-warehouse: 0 resource(s) added.',
        'Workspace harbor-cafe: 0 resource(s) added.',
        'Workspace eastside-repairs: 0 resource(s) added.',
      ]);

      const pool = createTestPool(url);
      try {
        await pool.query(`UPDATE resources SET attributes = jsonb_set(attributes, '{quantity}', '1') WHERE id = 'item_air_filter'`);
        const reset = await run(['reset'], env);
        expect(reset).toEqual({
          code: 0,
          lines: [
            'Workspace northside-warehouse: reset to the fixture.',
            'Workspace harbor-cafe: reset to the fixture.',
            'Workspace eastside-repairs: reset to the fixture.',
          ],
        });
        const restored = await pool.query<{ quantity: number }>(
          `SELECT (attributes->>'quantity')::int AS quantity FROM resources WHERE id = 'item_air_filter'`,
        );
        expect(restored.rows[0]?.quantity).toBe(35);
      } finally {
        await pool.end();
      }
    });
  });

  it('refuses to reset a remote database unless explicitly allowed', async () => {
    const remote = 'postgresql://db.example.invalid:5432/voiceops';

    const refused = await run(['reset'], { DATABASE_URL: remote });
    expect(refused.code).toBe(1);
    expect(refused.lines[0]).toMatch(/Refusing to reset db\.example\.invalid:5432\/voiceops: it is not a local database/);

    const allowed = await run(['reset'], { DATABASE_URL: remote, VOICEOPS_ALLOW_REMOTE_RESET: '1' });
    expect(allowed.code).toBe(1);
    expect(allowed.lines[0]).not.toMatch(/Refusing to reset/);
  });
});
