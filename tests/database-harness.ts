import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

// No DATABASE_URL option by design: this fixture must never target an existing database.
export async function startDatabase() {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => probe.close((e) => (e ? reject(e) : resolve())));
  const directory = await mkdtemp(join(tmpdir(), 'academy-test-'));
  const db = new EmbeddedPostgres({
    databaseDir: join(directory, 'data'),
    port,
    persistent: true,
    password: randomBytes(32).toString('hex'),
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
    onLog() {},
    onError() {},
  });
  let running = false;
  const owner = db.getPgClient('postgres', '127.0.0.1');
  const stop = async () => {
    await owner.end();
    if (running) await db.stop();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await db.initialise();
    await db.start();
    running = true;
    await owner.connect();
    await owner.query(await readFile('tests/fixtures/supabase-contract.sql', 'utf8'));
    const migrations = (await readdir('supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of migrations) {
      try {
        await owner.query(await readFile(`supabase/migrations/${file}`, 'utf8'));
      } catch (cause) {
        throw new Error(`Migration failed: ${file}`, { cause });
      }
    }
    async function queryAs(
      user: string | null,
      text: string,
      values: unknown[] = [],
      aal = 'aal1',
    ) {
      const c = db.getPgClient('postgres', '127.0.0.1');
      await c.connect();
      try {
        await c.query('begin');
        await c.query(user ? 'set local role authenticated' : 'set local role anon');
        await c.query("select set_config('request.jwt.claims',$1,true)", [
          JSON.stringify({ sub: user, aal, role: user ? 'authenticated' : 'anon' }),
        ]);
        const result = await c.query(text, values);
        await c.query('commit');
        return result.rows;
      } catch (e) {
        await c.query('rollback');
        throw e;
      } finally {
        await c.end();
      }
    }
    return { owner, queryAs, migrations, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
