import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createHandler } from '../src/platform/http.js';
import { SupabaseGateway, type Gateway } from '../src/platform/supabase.js';
import { MinuteLimiter } from '../src/platform/limiter.js';
import { ApiError } from '../src/platform/errors.js';
import { readConfig } from '../src/platform/config.js';
import {
  adapterFor,
  capabilities,
  webhookProviders,
  type Provider,
} from '../src/integrations/registry.js';

// Deliberately non-signing transport doubles; these strings are NOT usable credentials.
const id = randomUUID(),
  bearer = Array.from({ length: 3 }, () => randomBytes(8).toString('hex')).join('.');
const origin = 'https://fixture.invalid';
const config = {
  origin,
  supabase: 'https://storage.invalid',
  key: `sb_publishable_${randomUUID()}`,
};
const base: Gateway = {
  verify: async () => id,
  rpc: async () => ({ id, locale: 'si', display_name: null, roles: [] }),
  sign: async () => {
    throw Error('unexpected');
  },
  logout: async () => {},
};
const build = (db: Gateway = base) => createHandler(() => ({ origin, db }));
const req = (path: string, method = 'GET', body?: string, headers: Record<string, string> = {}) =>
  new Request(`${origin}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', ...headers },
    body,
  });
const admission = () => ({
  request_id: randomUUID(),
  student_name: 'Synthetic Learner',
  birth_date: '2013-01-01',
  group_id: randomUUID(),
  guardian_name: 'Synthetic Guardian',
  guardian_phone: '+12025550111',
  relationship: 'guardian',
  consent: true,
  notice_version: 'fixture-v1',
  evidence_ref: 'fixture-evidence',
});

describe('Versioned HTTP boundary', () => {
  it('requires explicit verified bearer auth; ignores cookies and does not trust a decoded token', async () => {
    let calls = 0;
    const h = build({
      ...base,
      verify: async () => {
        calls++;
        throw new ApiError(401, 'authentication_required');
      },
      rpc: async () => assert.fail(),
    });
    assert.equal(
      (await h(new Request(origin + '/api/v1/me', { headers: { cookie: 'session=fixture' } })))
        .status,
      401,
    );
    assert.equal(calls, 0);
    const r = await h(req('/me'));
    assert.equal(r.status, 401);
    assert.equal(calls, 1);
    assert.equal(r.headers.get('www-authenticate'), 'Bearer');
  });
  it('validates a complete admission and passes named arguments under the same user JWT', async () => {
    const input = admission();
    let calls = 0;
    const h = build({
      ...base,
      rpc: async (name, args, token) => {
        calls++;
        assert.equal(token, bearer);
        assert.equal(name, 'admit');
        assert.equal(args.p_student_name, input.student_name);
        assert.equal(args.p_guardian_id, null);
        return {
          registration_id: id,
          student_id: id,
          student_code: 'S-1',
          enrollment_id: id,
          guardian_id: id,
          private_field: 'not exposed',
        };
      },
    });
    const r = await h(req('/admissions', 'POST', JSON.stringify(input)));
    assert.equal(r.status, 201);
    const json = await r.json();
    assert.equal(json.request_id, r.headers.get('x-request-id'));
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(!('private_field' in json.data));
    for (const patch of [
      { consent: false },
      { guardian_name: null },
      { guardian_id: id },
      { birth_date: '2013-02-31' },
      { role: 'admin' },
      { guardian_phone: 'local number' },
    ]) {
      assert.equal(
        (await h(req('/admissions', 'POST', JSON.stringify({ ...input, ...patch })))).status,
        422,
      );
    }
    assert.equal(calls, 1);
  });
  it('rejects malformed JSON, unsupported media, untrusted origins and oversized streamed bodies', async () => {
    const h = build({ ...base, rpc: async () => assert.fail() });
    assert.equal((await h(req('/admissions', 'POST', '{'))).status, 400);
    assert.equal(
      (await h(req('/admissions', 'POST', '{}', { 'content-type': 'text/plain' }))).status,
      415,
    );
    assert.equal(
      (await h(req('/admissions', 'POST', '{}', { origin: 'https://other.invalid' }))).status,
      403,
    );
    assert.equal((await h(req('/admissions', 'POST', 'x'.repeat(65537)))).status, 413);
    assert.equal(
      (await h(req('/admissions', 'POST', '{}', { 'content-length': '65537' }))).status,
      413,
    );
  });
  it('strictly checks paths, query duplicates, pagination, method and route version', async () => {
    const h = build({
      ...base,
      rpc: async (name, args) => {
        assert.equal(name, 'classes');
        assert.deepEqual(args, { p_offset: 10 });
        return [];
      },
    });
    for (const p of [
      '/classes?offset=1&offset=2',
      '/classes?offset=-1',
      '/classes?full=true',
      '/students/invalid/cards',
      '/attendance/reports',
    ])
      assert.equal((await h(req(p))).status, 422);
    assert.equal((await h(req('/classes?offset=10'))).status, 200);
    const wrong = await h(req('/classes', 'PATCH'));
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'GET');
    assert.equal((await h(new Request(origin + '/api/v2/classes'))).status, 404);
  });
  it('rate limits before upstream work, resets after the window and does not trust forwarded-for', async () => {
    let now = 0,
      verifies = 0;
    const db = {
      ...base,
      verify: async () => {
        verifies++;
        return id;
      },
    };
    const h = createHandler(() => ({ origin, db }), new MinuteLimiter(1, () => now));
    assert.equal((await h(req('/me'), 'edge')).status, 200);
    const limited = await h(req('/me', 'GET', undefined, { 'x-forwarded-for': 'other' }), 'edge');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
    assert.equal(verifies, 1);
    now = 60000;
    assert.equal((await h(req('/me'), 'edge')).status, 200);
  });
  it('refuses all reserved provider callbacks without reading payloads or consulting credentials', async () => {
    const h = createHandler(() => assert.fail());
    for (const p of webhookProviders) {
      const r = await h(req(`/webhooks/${p}`, 'POST', 'not an event'));
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error.code, 'integration_disabled');
    }
    assert.equal((await h(req('/webhooks/unknown', 'POST', '{}'))).status, 404);
    for (const p of Object.keys(capabilities) as Provider[]) {
      const a = adapterFor(p);
      assert.equal(a.status, 'disabled');
      await assert.rejects(a.verifyWebhook(new Uint8Array(), new Headers()), {
        code: 'integration_disabled',
      });
      await assert.rejects(a.refresh(), { code: 'integration_disabled' });
      await assert.rejects(a.execute(capabilities[p][0], {}), { code: 'integration_disabled' });
    }
  });
  it('fails closed on a missing profile and malformed upstream data; logout requires user verification', async () => {
    assert.equal((await build({ ...base, rpc: async () => null })(req('/me'))).status, 403);
    assert.equal((await build({ ...base, rpc: async () => ({}) })(req('/me'))).status, 502);
    let loggedOut = false;
    const h = build({
      ...base,
      logout: async (t) => {
        assert.equal(t, bearer);
        loggedOut = true;
      },
    });
    assert.deepEqual((await (await h(req('/auth/logout', 'POST'))).json()).data, {
      signed_out: true,
    });
    assert.ok(loggedOut);
  });
});

describe('Supabase HTTP adapter with synthetic transports (no hosted calls)', () => {
  it('checks Auth current user before RPC and forwards the publishable key, user JWT and custom schema', async () => {
    const calls: string[] = [];
    const g = new SupabaseGateway(config, async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      assert.equal(url.origin, config.supabase);
      const h = new Headers(init?.headers);
      assert.equal(h.get('authorization'), `Bearer ${bearer}`);
      assert.equal(h.get('apikey'), config.key);
      assert.equal(init?.redirect, 'error');
      if (url.pathname === '/auth/v1/user')
        return Response.json({ id, email_confirmed_at: 'fixture-confirmed' });
      assert.equal(h.get('content-profile'), 'academy_api');
      assert.equal(init?.body, '{}');
      return Response.json({ id, locale: 'si', display_name: null, roles: ['student'] });
    });
    assert.equal((await build(g)(req('/me'))).status, 200);
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/rpc/me']);
  });
  it('rejects expired, unverified and anonymous sessions; unavailable Auth fails closed', async () => {
    for (const response of [
      Response.json({}, { status: 401 }),
      Response.json({ id, email_confirmed_at: null }),
      Response.json({ id, is_anonymous: true, email_confirmed_at: 'fixture' }),
    ]) {
      const r = await build(new SupabaseGateway(config, async () => response))(req('/me'));
      assert.equal(r.status, 401);
    }
    assert.equal(
      (
        await build(
          new SupabaseGateway(config, async () => {
            throw Error('network');
          }),
        )(req('/me'))
      ).status,
      503,
    );
  });
  it('maps SQL conflicts, permission failures, constraints and rate limits without leaking detail', async () => {
    for (const [code, expected] of [
      ['23505', 409],
      ['42501', 403],
      ['P0002', 404],
      ['23514', 422],
      ['PT429', 429],
      ['unknown', 502],
    ] as const) {
      const g = new SupabaseGateway(config, async (url) =>
        String(url).endsWith('/user')
          ? Response.json({ id, email_confirmed_at: 'fixture' })
          : Response.json({ code, details: 'sensitive-fixture-detail' }, { status: 400 }),
      );
      const r = await build(g)(req('/cards/revoke', 'POST', JSON.stringify({ card_id: id })));
      assert.equal(r.status, expected);
      assert.ok(!(await r.text()).includes('sensitive-fixture-detail'));
    }
  });
  it('signs only an entitled internal object, with the caller identity and a short expiry', async () => {
    const object = 'fixture/test.pdf';
    let signed = 0;
    const g = new SupabaseGateway(config, async (url, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), `Bearer ${bearer}`);
      if (String(url).endsWith('/user'))
        return Response.json({ id, email_confirmed_at: 'fixture' });
      if (String(url).endsWith('/resource_access')) return Response.json({ object_path: object });
      signed++;
      assert.ok(String(url).endsWith(`/storage/v1/object/sign/academy-library/${object}`));
      assert.deepEqual(JSON.parse(String(init?.body)), { expiresIn: 60 });
      return Response.json({ signedURL: `/object/sign/academy-library/${object}?token=fixture` });
    });
    const r = await build(g)(req(`/resources/${id}/access`));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).data.expires_in, 60);
    assert.equal(signed, 1);
    await assert.rejects(g.sign('../other', bearer), { code: 'upstream_error' });
    await assert.rejects(
      new SupabaseGateway(config, async () =>
        Response.json({ signedURL: 'https://other.invalid/file' }),
      ).sign(object, bearer),
      { code: 'upstream_error' },
    );
  });
});

describe('Server-only environment validation', () => {
  const env = {
    SUPABASE_URL: config.supabase,
    API_ORIGIN: config.origin,
    SUPABASE_PUBLISHABLE_KEY: config.key,
  };
  it('requires a valid origin and publishable key; no secret/service key fallback', () => {
    assert.deepEqual(readConfig(env), config);
    for (const e of [
      {},
      { ...env, SUPABASE_PUBLISHABLE_KEY: '' },
      { ...env, SUPABASE_PUBLISHABLE_KEY: `sb_secret_${randomUUID()}` },
      { ...env, SUPABASE_URL: 'https://fixture.invalid/private' },
      { ...env, API_ORIGIN: 'http://example.invalid' },
      { ...env, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'fixture' },
    ])
      assert.throws(() => readConfig(e), { code: 'configuration_unavailable' });
  });
  it('permits local HTTP only in development; rejects a legacy service-role key', () => {
    assert.equal(
      readConfig({ ...env, SUPABASE_URL: 'http://127.0.0.1:54321' }).supabase,
      'http://127.0.0.1:54321',
    );
    assert.throws(() =>
      readConfig({ ...env, NODE_ENV: 'production', SUPABASE_URL: 'http://127.0.0.1:54321' }),
    );
    const legacy = (role: string) =>
      `fixture.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.fixture`;
    assert.throws(() => readConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: legacy('service_role') }));
    assert.equal(
      readConfig({ ...env, SUPABASE_PUBLISHABLE_KEY: legacy('anon') }).key,
      legacy('anon'),
    );
  });
});
