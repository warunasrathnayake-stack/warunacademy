import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';

it('keeps the supplied primary specification unchanged and all environment placeholders empty', async () => {
  const spec = await readFile('docs/spec/master-architecture-v2.txt');
  assert.equal(
    createHash('sha256').update(spec).digest('hex'),
    'd749d4071669340301400d1a43c1e0a2948773e4645a6857ce77c6091909fc47',
  );
  const template = parseEnv(await readFile('.env.example', 'utf8'));
  for (const key of [
    'API_ORIGIN',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'META_APP_SECRET',
    'TIKTOK_TOKEN_REF',
    'PAYMENT_WEBHOOK_SIGNING_SECRET',
    'WHATSAPP_VERIFY_TOKEN',
    'SMTP_PASSWORD',
    'OPENAI_PROJECT_API_KEY',
  ])
    assert.ok(Object.hasOwn(template, key));
  assert.ok(Object.values(template).every((value) => value === ''));
  assert.ok(Object.keys(template).every((name) => !name.startsWith('NEXT_PUBLIC_')));
});
