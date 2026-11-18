import { it } from 'node:test';
import assert from 'node:assert/strict';
import { devSmoke } from '../scripts/dev-smoke.js';

it('commissioning plan and incomplete, non-dev or automatic runs cannot contact a host', async () => {
  let calls = 0;
  const neverFetch: typeof fetch = async () => {
    calls++;
    throw Error('unexpected network');
  };
  const ref = 'visphgkumgwnrajatidh';
  const env = { DEV_WRITE_REF: ref, SUPABASE_URL: `https://${ref}.supabase.co` };
  await devSmoke([], {}, neverFetch, () => {});
  await devSmoke(['--plan'], {}, neverFetch, () => {});
  for (const settings of [
    {},
    env,
    { ...env, SUPABASE_URL: 'https://wrong.invalid' },
    { ...env, CI: 'true' },
    { ...env, NODE_ENV: 'production' },
    { ...env, VERCEL: '1' },
    { ...env, DEV_RECOVERY_TICKET: 'test-only' },
  ]) {
    await assert.rejects(devSmoke(['--run'], settings, neverFetch, () => {}));
  }
  await assert.rejects(devSmoke(['--force'], {}, neverFetch, () => {}));
  assert.equal(calls, 0);
});
