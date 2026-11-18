import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

async function freeLoopbackPort() {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => probe.close((e) => (e ? reject(e) : resolve())));
  return port;
}

// Synthetic clusters only. No DSN or existing database is ever accepted.
export async function startDatabase() {
  const socketOnly = process.platform !== 'win32';
  // The fixture dependency creates a temporary initdb password file. Restrict this
  // dedicated test process's file modes, including during the dependency's init.
  if (socketOnly) process.umask(process.umask() | 0o077);
  const port = socketOnly ? 5432 : await freeLoopbackPort();
  const directory = await mkdtemp(join(socketOnly ? '/tmp' : tmpdir(), 'academy-test-'));
  const host = socketOnly ? directory : '127.0.0.1';
  const db = new EmbeddedPostgres({
    databaseDir: join(directory, 'data'),
    port,
    persistent: true,
    password: randomBytes(32).toString('hex'),
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: socketOnly
      ? ['-c', 'listen_addresses=', '-k', directory, '-c', 'unix_socket_permissions=0700']
      : ['-c', 'listen_addresses=127.0.0.1'],
    onLog() {},
    onError() {},
  });
  let running = false;
  const owner = db.getPgClient('postgres', host);
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
      const c = db.getPgClient('postgres', host);
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
