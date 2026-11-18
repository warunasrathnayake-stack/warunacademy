import { readFile } from 'node:fs/promises';
import { devSmoke } from '../scripts/dev-smoke.js';
import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startDatabase } from './database-harness.js';
import { routes } from '../src/routes.js';
import { z } from 'zod';
import { createHandler } from '../src/platform/http.js';

type Db = Awaited<ReturnType<typeof startDatabase>>;
const uuid = () => randomUUID();
const u = {
  admin: uuid(),
  super: uuid(),
  teachA: uuid(),
  teachB: uuid(),
  admit: uuid(),
  issuer: uuid(),
  op: uuid(),
  op2: uuid(),
  guardian: uuid(),
  guardianB: uuid(),
  unverified: uuid(),
  student: uuid(),
  studentB: uuid(),
  marketing: uuid(),
  none: uuid(),
};
const g1 = uuid(),
  g2 = uuid(),
  g3 = uuid(),
  ses = uuid(),
  other = uuid(),
  future = uuid(),
  d1 = uuid(),
  d2 = uuid(),
  d3 = uuid();
let db: Db;
const owner = async (sql: string, values: unknown[] = []) =>
  (await db.owner.query(sql, values)).rows;
// SQL identifiers come only from the static routes under test. Never a client-controlled query.
async function call(user: string | null, name: string, values: unknown[] = [], aal = 'aal1') {
  assert.match(name, /^[a-z_]+$/);
  return (
    await db.queryAs(
      user,
      `select academy_api.${name}(${values.map((_, i) => `$${i + 1}`).join(',')}) as v`,
      values,
      aal,
    )
  )[0]!.v;
}
async function list(user: string, name: string, values: unknown[] = [], aal = 'aal1') {
  assert.match(name, /^[a-z_]+$/);
  return db.queryAs(
    user,
    `select * from academy_api.${name}(${values.map((_, i) => `$${i + 1}`).join(',')})`,
    values,
    aal,
  );
}
function admission(
  name: string,
  group = g1,
  phone = '+12025550101',
  request = uuid() as string,
): unknown[] {
  return [
    request,
    name,
    '2013-01-01',
    group,
    null,
    'Fixture Guardian',
    phone,
    'guardian',
    true,
    'synthetic-v1',
    'fixture-consent-ref',
  ];
}
const denied = (p: Promise<unknown>) => assert.rejects(p, { code: '42501' });
const expiry = () => new Date(Date.now() + 86400000).toISOString();
let a: { student_id: string; guardian_id: string; student_code: string };
let b: typeof a;
const resource = uuid(),
  classResource = uuid(),
  dirtyResource = uuid();

describe('Disposable PostgreSQL 17 · synthetic records, Supabase schema fixtures', () => {
  before(async () => {
    db = await startDatabase();
    await owner('insert into auth.users select unnest($1::uuid[])', [Object.values(u)]);
    const roles = {
      admin: 'admin',
      super: 'super_admin',
      teachA: 'teacher',
      teachB: 'teacher',
      admit: 'admissions_officer',
      issuer: 'card_issuer',
      op: 'attendance_operator',
      op2: 'attendance_operator',
      guardian: 'guardian',
      guardianB: 'guardian',
      unverified: 'guardian',
      student: 'student',
      studentB: 'student',
      marketing: 'marketing',
    };
    for (const [key, role] of Object.entries(roles))
      await owner(
        'insert into academy.user_roles select $1,id,now() from academy.roles where code=$2',
        [u[key as keyof typeof u], role],
      );
    const course = (
      await owner(
        "insert into academy.courses(grade_id,title) select id,'Fixture Science' from academy.grades where level=7 returning id",
      )
    )[0]!.id;
    await owner(
      "insert into academy.class_groups(id,course_id,label,teacher_id) values($1,$4,'Group A',$5),($2,$4,'Group B',$6),($3,$4,'Group C',$6)",
      [g1, g2, g3, course, u.teachA, u.teachB],
    );
    await owner(
      `insert into academy.class_sessions(id,group_id,starts_at,ends_at,scan_opens_at,scan_closes_at,late_after)
      select sid,gid,t,t+interval '2h',t-interval '10m',t+interval '2h',t+interval '30m' from
      (values ($1::uuid,$4::uuid,now()),($2,$5,now()),($3,$4,now()+interval '2 days')) v(sid,gid,t)`,
      [ses, other, future, g1, g2],
    );
    await owner(
      `insert into academy.attendance_devices(id,label,assigned_location,operator_id,group_id,active) values
      ($1,'A','test',$4,$6,true),($2,'B','test',$5,$6,true),($3,'C','test',$4,$7,true)`,
      [d1, d2, d3, u.op, u.op2, g1, g2],
    );
    a = await call(u.admit, 'admit', admission('Fixture Learner A'));
    b = await call(u.admit, 'admit', admission('Fixture Learner B', g2, '+12025550102'));
    for (const [student, studentUser, guardianUser] of [
      [a, u.student, u.guardian],
      [b, u.studentB, u.guardianB],
    ] as const) {
      await owner('update academy.students set profile_id=$1 where id=$2', [
        studentUser,
        student.student_id,
      ]);
      await owner('update academy.guardians set profile_id=$1,verified_at=now() where id=$2', [
        guardianUser,
        student.guardian_id,
      ]);
      await owner(
        'update academy.student_guardians set access_verified_at=now() where guardian_id=$1',
        [student.guardian_id],
      );
    }
    const unverified = (
      await owner(
        "insert into academy.guardians(name,phone,profile_id,verified_at) values('Unverified link','+12025550103',$1,now()) returning id",
        [u.unverified],
      )
    )[0]!.id;
    await owner("insert into academy.student_guardians values($1,$2,'guardian',null)", [
      a.student_id,
      unverified,
    ]);
    for (const [rid, file, verdict] of [
      [resource, 'fixtures/one.pdf', 'clean'],
      [classResource, 'fixtures/class.pdf', 'clean'],
      [dirtyResource, 'fixtures/quarantine.pdf', 'quarantined'],
    ] as const) {
      const asset = (
        await owner(
          "insert into academy.media_assets(bucket,object_path,mime_type,byte_size,scan_status,uploaded_by) values('academy-library',$1,'application/pdf',10,$2,$3) returning id",
          [file, verdict, u.admin],
        )
      )[0]!.id;
      await owner(
        "insert into academy.library_resources(id,title,asset_id,published) values($1,'Fixture Resource',$2,true)",
        [rid, asset],
      );
      await owner("insert into storage.objects(bucket_id,name) values('academy-library',$1)", [
        file,
      ]);
      if (rid === classResource)
        await owner(
          'insert into academy.resource_access_rules(resource_id,group_id) values($1,$2)',
          [rid, g1],
        );
      else
        await owner(
          'insert into academy.resource_entitlements(resource_id,student_id) values($1,$2)',
          [rid, a.student_id],
        );
    }
    await owner(
      "insert into storage.objects(bucket_id,name) values('academy-imports','fixtures/test.csv')",
    );
  });
  after(async () => {
    if (db) await db.stop();
  });

  it('all migrations apply; every private table uses RLS; RPC catalog matches versioned contracts', async () => {
    assert.equal(db.migrations.length, 6);
    assert.deepEqual(
      await owner("select tablename from pg_tables where schemaname='academy' and not rowsecurity"),
      [],
    );
    assert.deepEqual(
      await owner("select tablename from pg_tables where schemaname='academy_api'"),
      [],
    );
    const funcs = await owner(
      "select proname from pg_proc where pronamespace='academy_api'::regnamespace order by proname",
    );
    assert.deepEqual(
      funcs.map((r) => r.proname),
      routes.flatMap((r) => (r.rpc ? [r.rpc] : [])).sort(),
    );
    for (const route of routes.filter((r) => r.rpc)) {
      const props = route.body ? z.toJSONSchema(route.body, { io: 'input' }).properties : {};
      const args = Object.keys({ ...route.params, ...route.query, ...props })
        .map((s) => 'p_' + s)
        .sort();
      const [signature] = await owner(
        "select proargnames[1:pronargs] as args from pg_proc where pronamespace='academy_api'::regnamespace and proname=$1",
        [route.rpc],
      );
      assert.deepEqual((signature!.args ?? []).sort(), args, route.rpc);
    }
    assert.deepEqual(
      await owner(
        "select proname from pg_proc where pronamespace in ('academy'::regnamespace,'academy_api'::regnamespace) and prosecdef and not coalesce(proconfig @> array['search_path=\"\"'],false)",
      ),
      [],
    );
    assert.deepEqual(
      await owner(
        "select proname from pg_proc where pronamespace in ('academy'::regnamespace,'academy_api'::regnamespace) and has_function_privilege('anon',oid,'execute')",
      ),
      [],
    );
  });
  it('profile provisioning assigns no roles; anonymous callers and role self-grants are denied', async () => {
    assert.deepEqual((await call(u.none, 'me')).roles, []);
    assert.deepEqual((await call(u.teachA, 'me')).roles, ['teacher']);
    await denied(call(null, 'me'));
    await denied(call(u.none, 'admit', admission('No Privilege')));
    await denied(
      db.queryAs(
        u.student,
        "insert into academy.user_roles(user_id,role_id) select $1,id from academy.roles where code='admin'",
        [u.student],
      ),
    );
    await denied(db.queryAs(u.student, 'update academy.profiles set id=$1', [u.student]));
    await denied(db.queryAs(u.student, "select academy.audit('X','Y',$1)", [u.student]));
  });
  it('admin and super admin privileges require verified AAL2, even with a second role', async () => {
    await owner(
      "insert into academy.user_roles(user_id,role_id) select $1,id from academy.roles where code='card_issuer'",
      [u.admin],
    );
    for (const user of [u.admin, u.super]) {
      assert.equal((await list(user, 'students', [0])).length, 0);
      await denied(call(user, 'issue_card', [a.student_id, expiry(), false]));
      assert.ok((await list(user, 'students', [0], 'aal2')).length >= 2);
    }
  });
  it('admission atomically links guardians, consent and class; request and natural duplicates roll back', async () => {
    assert.notEqual(a.student_code, b.student_code);
    const r = uuid();
    const args = admission('Fixture   Duplicate', g1, '+12025550104', r);
    const admitted = await call(u.admit, 'admit', args);
    const counts = async () =>
      (
        await owner(
          'select (select count(*) from academy.guardians) g,(select count(*) from academy.students) s,(select count(*) from academy.registrations) r',
        )
      )[0];
    const before = await counts();
    await assert.rejects(
      call(u.admit, 'admit', admission('fixture duplicate', g1, '+12025550104')),
      { code: '23505' },
    );
    await assert.rejects(
      call(u.admit, 'admit', admission('Different Name', g1, '+12025550105', r)),
      { code: '23505' },
    );
    const missing = admission('No Consent');
    missing[8] = false;
    await assert.rejects(call(u.admit, 'admit', missing), { code: '22023' });
    assert.deepEqual(await counts(), before);
    const linked = await owner(
      'select from academy.consent_records c join academy.registrations r using(student_id) join academy.enrollments e on e.id=r.enrollment_id where c.granted and c.student_id=$1 and c.guardian_id=$2',
      [admitted.student_id, admitted.guardian_id],
    );
    assert.equal(linked.length, 1);
    const sibling = admission('Fixture Sibling');
    sibling.splice(4, 3, admitted.guardian_id, null, null);
    assert.equal((await call(u.admit, 'admit', sibling)).guardian_id, admitted.guardian_id);
    await assert.rejects(call(u.admit, 'enroll', [admitted.student_id, g1]), { code: '23505' });
    assert.ok((await call(u.admit, 'enroll', [admitted.student_id, g3])).id);
    await assert.rejects(
      owner('insert into academy.enrollments(student_id,group_id) values($1,$2)', [uuid(), g1]),
      { code: '23503' },
    );
  });
  it('RLS isolates students, verified families, unverified links, teachers and marketing', async () => {
    for (const user of [u.student, u.guardian]) {
      assert.deepEqual(
        (await list(user, 'students', [0])).map((s) => s.id),
        [a.student_id],
      );
      assert.deepEqual(
        (await list(user, 'classes', [0])).map((g) => g.id),
        [g1],
      );
      assert.deepEqual(await list(user, 'guardians', [b.student_id]), []);
    }
    assert.deepEqual(
      (await list(u.guardian, 'guardians', [a.student_id])).map((g) => g.id),
      [a.guardian_id],
    );
    assert.deepEqual(await list(u.unverified, 'students', [0]), []);
    assert.deepEqual(await list(u.unverified, 'history', [a.student_id, 0]), []);
    assert.deepEqual(await list(u.marketing, 'students', [0]), []);
    assert.deepEqual(await list(u.teachA, 'guardians', [a.student_id]), []);
    assert.ok(!(await list(u.teachB, 'students', [0])).some((r) => r.id === a.student_id));
    await denied(db.queryAs(u.teachA, 'select birth_date from academy.students'));
    await denied(db.queryAs(u.student, 'select token_hash from academy.student_cards'));
    await denied(db.queryAs(u.guardian, 'select * from academy.scan_events'));
    await denied(db.queryAs(u.none, 'select * from academy.integration_connections'));
  });
  it('QR issuance rotates, refuses duplicate active cards and never returns secrets on read', async () => {
    const c = await call(u.issuer, 'issue_card', [a.student_id, expiry(), false]);
    assert.match(c.qr_token, /^[0-9a-f]{64}$/);
    assert.equal(
      (
        await owner(
          "select token_hash=sha256(convert_to($1,'UTF8')) as match from academy.student_cards where id=$2",
          [c.qr_token, c.card_id],
        )
      )[0]!.match,
      true,
    );
    await assert.rejects(call(u.issuer, 'issue_card', [a.student_id, expiry(), false]), {
      code: '23505',
    });
    const next = await call(u.issuer, 'issue_card', [a.student_id, expiry(), true]);
    assert.notEqual(c.qr_token, next.qr_token);
    assert.equal((await call(u.op, 'scan', [d1, ses, uuid(), c.qr_token])).result, 'invalid_card');
    assert.ok(!('qr_token' in (await call(u.issuer, 'print_metadata', [next.card_id]))));
    assert.ok(!(await list(u.guardian, 'cards', [a.student_id])).some((c) => 'token_hash' in c));
    assert.deepEqual(await list(u.guardianB, 'cards', [a.student_id]), []);
    await denied(call(u.student, 'print_metadata', [next.card_id]));
    await call(u.issuer, 'revoke_card', [next.card_id]);
    assert.equal(
      (await call(u.op, 'scan', [d1, ses, uuid(), next.qr_token])).result,
      'invalid_card',
    );
  });
  it('scans bind device, operator, class, server time, card expiry, active student and enrollment', async () => {
    const c = await call(u.issuer, 'issue_card', [a.student_id, expiry(), true]);
    await denied(call(u.op2, 'scan', [d1, ses, uuid(), c.qr_token]));
    await denied(call(u.student, 'scan', [d1, ses, uuid(), c.qr_token]));
    await denied(call(u.op, 'scan', [d1, other, uuid(), c.qr_token]));
    await denied(call(u.op, 'scan', [uuid(), ses, uuid(), c.qr_token]));
    assert.equal(
      (await call(u.op, 'scan', [d3, other, uuid(), c.qr_token])).result,
      'not_enrolled',
    );
    assert.equal(
      (await call(u.op, 'scan', [d1, future, uuid(), c.qr_token])).result,
      'outside_window',
    );
    await owner('update academy.attendance_devices set active=false where id=$1', [d1]);
    await denied(call(u.op, 'scan', [d1, ses, uuid(), c.qr_token]));
    await owner('update academy.attendance_devices set active=true where id=$1', [d1]);
    await owner('update academy.students set active=false where id=$1', [a.student_id]);
    assert.equal((await call(u.op, 'scan', [d1, ses, uuid(), c.qr_token])).result, 'invalid_card');
    await owner('update academy.students set active=true where id=$1', [a.student_id]);
    await owner(
      "update academy.student_cards set issued_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",
      [c.card_id],
    );
    assert.equal((await call(u.op, 'scan', [d1, ses, uuid(), c.qr_token])).result, 'invalid_card');
  });
  it('concurrent scanners produce one attendance; bound request replay does not create another event', async () => {
    const c = await call(u.issuer, 'issue_card', [a.student_id, expiry(), true]);
    const req = uuid();
    const args = [d1, ses, req, c.qr_token];
    const [one, two] = await Promise.all([
      call(u.op, 'scan', args),
      call(u.op2, 'scan', [d2, ses, uuid(), c.qr_token]),
    ]);
    assert.deepEqual([one.result, two.result].sort(), ['duplicate', 'present']);
    assert.equal(one.attendance_id, two.attendance_id);
    assert.deepEqual(await call(u.op, 'scan', args), one);
    assert.equal(
      (await owner('select from academy.scan_events where request_id=$1', [req])).length,
      1,
    );
    await assert.rejects(call(u.op, 'scan', [d1, ses, req, '0'.repeat(64)]), { code: '23505' });
    assert.equal(
      (
        await owner(
          'select from academy.attendance_records where student_id=$1 and session_id=$2',
          [a.student_id, ses],
        )
      ).length,
      1,
    );
    await assert.rejects(
      owner("update academy.scan_events set result='late' where request_id=$1", [req]),
      { code: '55000' },
    );
  });
  it('late scans are explicit; manual corrections preserve reason, actor, before/after; daily report does not invent absences', async () => {
    const learner = await call(u.admit, 'admit', admission('Fixture Late'));
    const c = await call(u.issuer, 'issue_card', [learner.student_id, expiry(), false]);
    await owner('update academy.class_sessions set late_after=starts_at where id=$1', [ses]);
    const late = await call(u.op, 'scan', [d1, ses, uuid(), c.qr_token]);
    assert.equal(late.result, 'late');
    const args = [ses, learner.student_id, 'excused', 'Fixture correction'];
    await denied(call(u.teachB, 'correct_attendance', args));
    await denied(call(u.op, 'correct_attendance', args));
    await assert.rejects(call(u.teachA, 'correct_attendance', [...args.slice(0, 3), ' ']), {
      code: '22023',
    });
    await call(u.teachA, 'correct_attendance', args);
    assert.deepEqual(
      (
        await owner(
          'select before_status,after_status,actor_id,reason from academy.attendance_adjustments where attendance_id=$1',
          [late.attendance_id],
        )
      )[0],
      {
        before_status: 'late',
        after_status: 'excused',
        actor_id: u.teachA,
        reason: 'Fixture correction',
      },
    );
    assert.equal((await call(u.op, 'scan', [d1, ses, uuid(), c.qr_token])).result, 'duplicate');
    const today = (
      await owner(
        "select (starts_at at time zone 'Asia/Colombo')::date::text as day from academy.class_sessions where id=$1",
        [ses],
      )
    )[0]!.day;
    const report = await list(u.teachA, 'report', [today, g1, 0]);
    assert.ok(report.some((r) => r.status === 'unmarked'));
    assert.ok(report.some((r) => r.status === 'excused'));
    assert.ok((await list(u.teachA, 'report', [today, null, 0])).every((r) => r.group_id === g1));
    await denied(list(u.teachA, 'report', [today, g2, 0]));
    assert.deepEqual(await list(u.studentB, 'history', [a.student_id, 0]), []);
    assert.ok((await list(u.guardian, 'history', [a.student_id, 0])).length);
    await assert.rejects(owner('delete from academy.attendance_adjustments'), { code: '55000' });
    await assert.rejects(owner('truncate academy.audit_logs'), { code: '55000' });
  });
  it('verified guardian consent withdrawal blocks new card issue and scans; other families cannot consent', async () => {
    const args = [a.student_id, 'admission', false, 'fixture-v2', 'fixture-withdrawal'];
    const c = await call(u.issuer, 'issue_card', [a.student_id, expiry(), true]);
    await denied(call(u.guardianB, 'record_consent', args));
    await denied(call(u.unverified, 'record_consent', args));
    await call(u.guardian, 'record_consent', args);
    await assert.rejects(call(u.issuer, 'issue_card', [a.student_id, expiry(), true]), {
      code: '22023',
    });
    assert.equal((await call(u.op, 'scan', [d1, ses, uuid(), c.qr_token])).result, 'invalid_card');
    assert.ok(
      (await owner('select from academy.consent_records where student_id=$1', [a.student_id]))
        .length >= 2,
    );
    await assert.rejects(owner('delete from academy.consent_records'), { code: '55000' });
  });
  it('Storage policies allow only clean, entitled objects; quarantine, staging and writes remain closed', async () => {
    assert.ok((await owner('select * from storage.buckets')).every((b) => b.public === false));
    for (const user of [u.student, u.guardian]) {
      assert.deepEqual(
        (await db.queryAs(user, 'select name from storage.objects order by name')).map(
          (r) => r.name,
        ),
        ['fixtures/class.pdf', 'fixtures/one.pdf'],
      );
      assert.deepEqual(await call(user, 'resource_access', [resource]), {
        object_path: 'fixtures/one.pdf',
      });
    }
    for (const user of [null, u.studentB, u.unverified])
      assert.deepEqual(await db.queryAs(user, 'select * from storage.objects'), []);
    await assert.rejects(call(u.studentB, 'resource_access', [resource]), { code: 'P0002' });
    await assert.rejects(call(u.admin, 'resource_access', [dirtyResource], 'aal2'), {
      code: 'P0002',
    });
    await denied(
      db.queryAs(
        u.student,
        "insert into storage.objects(bucket_id,name) values('academy-imports','wrong.csv')",
      ),
    );
    await owner('update academy.resource_entitlements set revoked_at=now() where resource_id=$1', [
      resource,
    ]);
    assert.ok(
      !(await db.queryAs(u.student, 'select name from storage.objects')).some(
        (r) => r.name === 'fixtures/one.pdf',
      ),
    );
  });
  it('CRM and draft CMS are role-controlled; no external worker, message or webhook is triggered', async () => {
    const post = await call(u.marketing, 'draft_post', ['fixture-post', 'Fixture', 'Unpublished']);
    assert.equal((await list(u.student, 'posts', [0])).length, 0);
    assert.equal((await list(u.marketing, 'posts', [0]))[0]!.id, post.id);
    await denied(call(u.student, 'draft_post', ['other', 'No', 'Denied']));
    const l = await call(u.marketing, 'create_lead', [
      'Fixture Contact',
      '+12025550109',
      'synthetic-evidence',
      'fixture',
    ]);
    await call(u.marketing, 'update_lead', [l.id, 'review', 'Fixture follow up', null]);
    assert.equal((await list(u.marketing, 'leads', [0]))[0]!.stage, 'review');
    await denied(list(u.student, 'leads', [0]));
    assert.equal(
      (await owner('select from academy.lead_activities where lead_id=$1', [l.id])).length,
      1,
    );
    await owner("insert into academy.notifications(recipient_id,title) values($1,'Fixture')", [
      u.student,
    ]);
    assert.equal((await list(u.student, 'notifications', [0])).length, 1);
    assert.deepEqual(await list(u.studentB, 'notifications', [0]), []);
    assert.deepEqual(await owner('select from academy.integration_sync_jobs'), []);
    assert.deepEqual(await owner('select from academy.outbound_messages'), []);
    await assert.rejects(owner('delete from academy.payment_webhook_events'), { code: '55000' });
  });
  it('MFA administrators can provision courses, teacher classes, session rules and operator-bound devices', async () => {
    const admin = (name: string, args: unknown[]) => call(u.admin, name, args, 'aal2');
    await denied(call(u.admin, 'create_course', [8, 'Fixture Foundation']));
    await denied(call(u.teachA, 'create_course', [8, 'Fixture Foundation']));
    const c = await admin('create_course', [8, 'Fixture Foundation']);
    await assert.rejects(admin('create_class', [c.id, 'Invalid teacher', u.student]), {
      code: '22023',
    });
    const grp = await admin('create_class', [c.id, 'New class', u.teachA]);
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    await assert.rejects(
      admin('schedule', [grp.id, at(0), at(3600000), at(-60000), at(86400000), at(60000)]),
      { code: '23514' },
    );
    const s = await admin('schedule', [
      grp.id,
      at(0),
      at(3600000),
      at(-60000),
      at(3600000),
      at(60000),
    ]);
    await assert.rejects(admin('register_device', ['Bad', 'Fixture', u.student, grp.id]), {
      code: '22023',
    });
    const dev = await admin('register_device', ['Fixture Device', 'Fixture', u.op, grp.id]);
    assert.equal(
      (await call(u.op, 'scan', [dev.id, s.id, uuid(), '0'.repeat(64)])).result,
      'invalid_card',
    );
    await admin('disable_device', [dev.id]);
    await denied(call(u.op, 'scan', [dev.id, s.id, uuid(), '0'.repeat(64)]));
  });
  it('import crosswalk preserves vendor, external ID, batch row and mapped student as one binding', async () => {
    await denied(db.queryAs(u.super, 'select * from academy.student_import_rows', [], 'aal2'));
    const batch = (
      await owner(
        "insert into academy.student_import_batches(source_vendor,imported_by,file_hash,status) values('fixture-source',$1,sha256('fixture'::bytea),'staged') returning id",
        [u.super],
      )
    )[0]!.id;
    const row = (
      await owner(
        "insert into academy.student_import_rows(batch_id,external_id,mapped_student_id,validation_status) values($1,'external-fixture',$2,'valid') returning id",
        [batch, a.student_id],
      )
    )[0]!.id;
    const insert =
      "insert into academy.student_crosswalk(source_vendor,external_id,student_id,import_row_id,batch_id) values($1,'external-fixture',$2,$3,$4)";
    await assert.rejects(owner(insert, ['wrong-source', a.student_id, row, batch]), {
      code: '23503',
    });
    await assert.rejects(owner(insert, ['fixture-source', b.student_id, row, batch]), {
      code: '23503',
    });
    await owner(insert, ['fixture-source', a.student_id, row, batch]);
    await assert.rejects(owner(insert, ['fixture-source', a.student_id, row, batch]), {
      code: '23505',
    });
  });
  it('HTTP to database vertical slice: validated admission, one-time issue and scoped scan', async () => {
    // Replace Auth and PostgREST transport ONLY. Real RPC code, privileges, JWT subject and transactions run in PostgreSQL.
    const post = async (user: string, path: string, body: unknown) => {
      const handler = createHandler(() => ({
        origin: 'https://fixture.invalid',
        db: {
          verify: async () => user,
          logout: async () => assert.fail(),
          sign: async () => assert.fail(),
          rpc: async (name, args) => {
            assert.ok(['admit', 'issue_card', 'scan'].includes(name));
            const names = Object.keys(args);
            assert.ok(names.every((k) => /^p_[a-z_]+$/.test(k)));
            return (
              await db.queryAs(
                user,
                `select academy_api.${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(',')}) as data`,
                Object.values(args),
              )
            )[0]!.data;
          },
        },
      }));
      const response = await handler(
        new Request('https://fixture.invalid/api/v1' + path, {
          method: 'POST',
          headers: {
            authorization: 'Bearer fixture.not.signed',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        }),
      );
      assert.ok(response.ok, `unexpected HTTP status ${response.status} for ${path}`);
      return (await response.json()).data;
    };
    const learner = await post(u.admit, '/admissions', {
      request_id: uuid(),
      student_name: 'Fixture API',
      birth_date: '2013-01-02',
      group_id: g1,
      guardian_name: 'Fixture Adult',
      guardian_phone: '+12025550115',
      relationship: 'guardian',
      consent: true,
      notice_version: 'fixture',
      evidence_ref: 'fixture',
    });
    const card = await post(u.issuer, '/cards/issue', {
      student_id: learner.student_id,
      expires_at: expiry(),
    });
    const scan = await post(u.op, '/attendance/scan', {
      device_id: d1,
      session_id: ses,
      request_id: uuid(),
      qr_token: card.qr_token,
    });
    assert.ok(['present', 'late'].includes(scan.result));
    assert.ok(scan.attendance_id);
  });
  it('provider event deduplication is per account; job links cannot cross account boundaries', async () => {
    const refs = await owner(
      "insert into academy.integration_connections(provider,account_ref) values('fixture','one'),('fixture','two') returning id",
    );
    const add =
      "insert into academy.webhook_events(connection_id,event_ref,event_kind,body_sha256,verified_at) values($1,'fixture-event','fixture',sha256('fixture'::bytea),now()) returning id";
    const event = (await owner(add, [refs[0]!.id]))[0]!.id;
    await assert.rejects(owner(add, [refs[0]!.id]), { code: '23505' });
    await owner(add, [refs[1]!.id]);
    await assert.rejects(
      owner(
        "insert into academy.integration_sync_jobs(connection_id,webhook_id,operation,dedupe_key) values($1,$2,'fixture','fixture')",
        [refs[1]!.id, event],
      ),
      { code: '23503' },
    );
    await assert.rejects(owner('delete from academy.webhook_events'), { code: '55000' });
  });
  it('rehearses the commissioning catalog and smoke flow on disposable PostgreSQL; no network', async () => {
    const inventory = (await owner(await readFile('scripts/dev-catalog.sql', 'utf8')))[0];
    assert.deepEqual(inventory, {
      app_schemas: 2,
      app_tables: 89,
      tables_missing_rls: 0,
      client_writable_tables: 0,
      rpc_functions: 30,
      anon_executable_rpcs: 0,
      auth_users: Object.keys(u).length,
      active_profile_triggers: 1,
      matching_private_buckets: 2,
      storage_objects_rls: true,
      storage_object_policies: 1,
    });
    await owner("update academy.class_groups set label='Synthetic commissioning' where id=$1", [
      g1,
    ]);
    // Non-signing fixture identities only. Never provide a hosted token to this test.
    const token = (subject: string) => `fixture.${subject}.unsigned`;
    const env = {
      SUPABASE_URL: 'https://visphgkumgwnrajatidh.supabase.co',
      API_ORIGIN: 'https://runner.invalid',
      SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${uuid()}`,
      DEV_RECOVERY_TICKET: 'disposable-fixture',
      DEV_WRITE_REF: 'visphgkumgwnrajatidh',
      DEV_RUN_ID: uuid(),
      DEV_GROUP_ID: g1,
      DEV_DEVICE_ID: d1,
      DEV_SESSION_ID: ses,
      DEV_OTHER_STUDENT_ID: b.student_id,
      DEV_ADMISSIONS_JWT: token(u.admit),
      DEV_CARD_ISSUER_JWT: token(u.issuer),
      DEV_SCAN_OPERATOR_JWT: token(u.op),
      DEV_OTHER_GUARDIAN_JWT: token(u.guardianB),
    };
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, env.SUPABASE_URL);
      const headers = new Headers(init?.headers);
      const user = [u.admit, u.issuer, u.op, u.guardianB].find(
        (user) => 'Bearer ' + token(user) === headers.get('authorization'),
      );
      assert.ok(user);
      if (url.pathname === '/auth/v1/user')
        return Response.json({ id: user, email_confirmed_at: 'fixture' });
      const rpc = url.pathname.split('/').at(-1)!;
      assert.ok(routes.some((r) => r.rpc === rpc));
      assert.equal(headers.get('content-profile'), 'academy_api');
      const args = JSON.parse(String(init?.body));
      const keys = Object.keys(args);
      assert.ok(keys.every((k) => /^p_[a-z_]+$/.test(k)));
      const invocation = `academy_api.${rpc}(${keys.map((k, i) => `${k} => $${i + 1}`).join(',')})`;
      const isList = [
        'guardians',
        'classes',
        'sessions',
        'enrollments',
        'history',
        'cards',
      ].includes(rpc);
      try {
        const rows = await db.queryAs(
          user,
          isList
            ? `select to_jsonb(r) as value from ${invocation} r`
            : `select ${invocation} as value`,
          Object.values(args),
        );
        return Response.json(isList ? rows.map((r) => r.value) : rows[0]!.value);
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          return Response.json({ code: '23505' }, { status: 409 });
        throw error;
      }
    };
    await devSmoke(['--run'], env, transport, () => {});
    const [result] = await owner(
      `select (select count(*)::int from academy.attendance_records a where a.student_id=r.student_id) marks,
      (select count(*)::int from academy.student_cards c where c.student_id=r.student_id and c.status='active') active_cards
      from academy.registrations r where r.request_id=$1`,
      [env.DEV_RUN_ID],
    );
    assert.deepEqual(result, { marks: 1, active_cards: 0 });
  });
  it('privileged write quota applies inside Postgres, not just in the HTTP handler', async () => {
    await owner(
      "update academy.write_quotas set minute=date_trunc('minute',now()),hits=20 where user_id=$1 and operation='admit'",
      [u.admit],
    );
    await assert.rejects(call(u.admit, 'admit', admission('Over Quota')), { code: 'PT429' });
  });
});
