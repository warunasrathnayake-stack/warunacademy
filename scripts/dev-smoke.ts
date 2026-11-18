// Operator-only. No listener/deployment, account creation, SQL connection or elevated key.
// The in-process HTTP handler uses the actual Supabase Auth and PostgREST transports.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { readConfig } from '../src/platform/config.js';
import { createHandler } from '../src/platform/http.js';
import { SupabaseGateway } from '../src/platform/supabase.js';

const ref = 'visphgkumgwnrajatidh';
const target = `https://${ref}.supabase.co`;
const classLabel = 'Synthetic commissioning';
const identities = {
  admissions_officer: 'DEV_ADMISSIONS_JWT',
  card_issuer: 'DEV_CARD_ISSUER_JWT',
  attendance_operator: 'DEV_SCAN_OPERATOR_JWT',
  guardian: 'DEV_OTHER_GUARDIAN_JWT',
} as const;
type Role = keyof typeof identities;
class Stop extends Error {}
function requireCheck(ok: unknown, reason: string): asserts ok {
  if (!ok) throw new Stop(reason);
}
function checked<T>(schema: z.ZodType<T>, input: unknown, step: string): T {
  const parsed = schema.safeParse(input);
  requireCheck(parsed.success, step);
  return parsed.data;
}
const id = z.uuid();
const ids = z.array(z.object({ id }));
const card = z.object({ card_id: id, qr_token: z.string().regex(/^[0-9a-f]{64}$/) });
const scanResult = z.object({ result: z.string(), attendance_id: id.nullable() });

export async function devSmoke(
  args: string[],
  env: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch,
  log = console.info,
) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--plan')) {
    log(
      'PLAN ONLY — no network or writes. After verified recovery and migrations: verify four synthetic identities and a linked control family; admit, check duplicates/guardian/enrollment, issue/scan/replay/rotate/revoke and check family isolation. See docs/development-commissioning.md.',
    );
    return;
  }
  requireCheck(args.length === 1 && args[0] === '--run', 'Expected --plan or --run.');
  requireCheck(
    !env.CI && !env.VERCEL && env.NODE_ENV !== 'production',
    'Operator development run only.',
  );
  requireCheck(
    env.DEV_WRITE_REF === ref && env.SUPABASE_URL === target,
    'Wrong or missing dedicated dev target/acknowledgement.',
  );
  requireCheck(env.DEV_RECOVERY_TICKET?.trim(), 'Verified recovery ticket required.');
  const cfg = readConfig(env);
  const run = checked(id, env.DEV_RUN_ID, 'A unique synthetic DEV_RUN_ID UUID is required.');
  const group = checked(id, env.DEV_GROUP_ID, 'Missing dev class UUID.');
  const session = checked(id, env.DEV_SESSION_ID, 'Missing dev session UUID.');
  const device = checked(id, env.DEV_DEVICE_ID, 'Missing dev device UUID.');
  const otherChild = checked(id, env.DEV_OTHER_STUDENT_ID, 'Missing linked control child UUID.');
  for (const key of Object.values(identities)) requireCheck(env[key], `Missing protected ${key}.`);
  const db = new SupabaseGateway(cfg, transport);
  const handle = createHandler(() => ({ origin: cfg.origin, db }));
  async function call(
    role: Role,
    path: string,
    status: number,
    label: string,
    body?: object,
  ): Promise<unknown> {
    const response = await handle(
      new Request(`${cfg.origin}/api/v1${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${env[identities[role]]}`,
          origin: cfg.origin,
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    // Never log bodies, identities, QR values, bearer tokens or arbitrary upstream errors.
    requireCheck(
      response.status === status,
      `${label}: expected HTTP ${status}, got ${response.status}; request ${response.headers.get('x-request-id')}.`,
    );
    return (await response.json()).data;
  }
  // Only positive controls and ordinary reads until all principals and the synthetic class are checked.
  const subjects = new Set<string>();
  for (const role of Object.keys(identities) as Role[]) {
    const me = checked(
      z.object({ id, roles: z.array(z.string()) }),
      await call(role, '/me', 200, 'Profile'),
      'Invalid profile.',
    );
    requireCheck(
      me.roles.length === 1 && me.roles[0] === role && !subjects.has(me.id),
      'Expected distinct, single-role synthetic users.',
    );
    subjects.add(me.id);
  }
  const guardianRows = async (role: Role, child: string) =>
    checked(
      ids,
      await call(role, `/students/${child}/guardians`, 200, 'Guardian read'),
      'Invalid guardian list.',
    );
  requireCheck(
    (await guardianRows('guardian', otherChild)).length === 1,
    'Control guardian must see its own verified fixture link.',
  );
  const classes = checked(
    z.array(z.object({ id, label: z.string() })),
    await call('attendance_operator', '/classes', 200, 'Class read'),
    'Invalid classes.',
  );
  requireCheck(
    classes.some((c) => c.id === group && c.label === classLabel),
    'Expected designated synthetic class on first page.',
  );
  const sessions = checked(
    z.array(z.object({ id, cancelled: z.boolean(), starts_at: z.string(), ends_at: z.string() })),
    await call('attendance_operator', `/classes/${group}/sessions`, 200, 'Schedule read'),
    'Invalid schedule.',
  );
  const now = Date.now();
  requireCheck(
    sessions.some(
      (s) =>
        s.id === session &&
        !s.cancelled &&
        Date.parse(s.starts_at) <= now &&
        now < Date.parse(s.ends_at),
    ),
    'Open the dedicated synthetic test session before running.',
  );
  log(`Read controls passed. Starting synthetic run ${run}.`);
  const admission = {
    request_id: run,
    student_name: `Synthetic Learner ${run}`,
    birth_date: '2013-01-01',
    group_id: group,
    guardian_name: `Synthetic Guardian ${run}`,
    guardian_phone: '+12025550118',
    relationship: 'guardian',
    consent: true,
    notice_version: 'fixture-only',
    evidence_ref: `synthetic-${run}`,
  };
  const admitted = checked(
    z.object({
      student_id: id,
      guardian_id: id,
      enrollment_id: id,
      student_code: z.string().min(1),
    }),
    await call('admissions_officer', '/admissions', 201, 'Admission', admission),
    'Invalid admission result.',
  );
  const child = admitted.student_id;
  await call('admissions_officer', '/admissions', 409, 'Duplicate identity', {
    ...admission,
    request_id: randomUUID(),
  });
  requireCheck(
    (await guardianRows('admissions_officer', child)).some((g) => g.id === admitted.guardian_id),
    'Missing guardian relation.',
  );
  const enrollments = checked(
    z.array(z.object({ id, group_id: id })),
    await call('admissions_officer', `/students/${child}/enrollments`, 200, 'Enrollment read'),
    'Invalid enrollments.',
  );
  requireCheck(
    enrollments.some((e) => e.id === admitted.enrollment_id && e.group_id === group),
    'Missing enrollment relation.',
  );
  requireCheck(
    (await guardianRows('guardian', child)).length === 0,
    'Unrelated family can see a guardian record.',
  );
  const issue = async (replace: boolean) =>
    checked(
      card,
      await call('card_issuer', '/cards/issue', 201, 'Card issue', {
        student_id: child,
        replace,
        expires_at: new Date(Date.now() + 600_000).toISOString(),
      }),
      'Invalid card response.',
    );
  const scan = async (qr: string, request_id = randomUUID()) =>
    checked(
      scanResult,
      await call('attendance_operator', '/attendance/scan', 200, 'Scan', {
        request_id,
        session_id: session,
        device_id: device,
        qr_token: qr,
      }),
      'Invalid scan response.',
    );
  const revoke = (card_id: string) =>
    call('card_issuer', '/cards/revoke', 200, 'Revoke run-owned card', { card_id });
  let active = await issue(false);
  let revoked = false;
  try {
    const request = randomUUID();
    const first = await scan(active.qr_token, request);
    requireCheck(
      ['present', 'late'].includes(first.result) && first.attendance_id,
      'Expected one accepted attendance.',
    );
    const replay = await scan(active.qr_token, request);
    const duplicate = await scan(active.qr_token);
    requireCheck(
      replay.result === first.result &&
        duplicate.result === 'duplicate' &&
        [replay, duplicate].every((r) => r.attendance_id === first.attendance_id),
      'Scan replay or uniqueness failed.',
    );
    const old = active;
    active = await issue(true);
    requireCheck(
      old.card_id !== active.card_id &&
        old.qr_token !== active.qr_token &&
        (await scan(old.qr_token)).result === 'invalid_card',
      'Replacement did not invalidate the old QR.',
    );
    await revoke(active.card_id);
    revoked = true;
    requireCheck((await scan(active.qr_token)).result === 'invalid_card', 'Revoked QR accepted.');
    for (const path of ['attendance', 'cards']) {
      const hidden = checked(
        ids,
        await call('guardian', `/students/${child}/${path}`, 200, 'Family isolation'),
        'Invalid scoped list.',
      );
      requireCheck(hidden.length === 0, 'Unrelated family data disclosed.');
    }
  } finally {
    if (!revoked) await revoke(active.card_id); // Only this run's issued card. Never delete evidence.
  }
  log(
    `PASS ${run}: hosted Auth/RPC + in-process API registration, guardian/enrollment, card rotation/revocation, scan replay and family isolation. No deployed HTTP or Storage download test claimed.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  devSmoke(process.argv.slice(2), process.env).catch((error) => {
    console.error(
      error instanceof Stop
        ? error.message
        : 'Dev smoke stopped: inspect configuration and sanitized platform logs privately.',
    );
    process.exitCode = 1;
  });
}
