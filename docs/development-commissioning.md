# Development commissioning · 18 November 2026 UTC

**Decision: dev writes approved; migrations on hold for recovery evidence.** Waruna Rathnayaka's development and management partner is **CEYTEQ – Ceylon Technology**. The owner confirmed `visphgkumgwnrajatidh` is the dedicated `academy-core` development target in `ap-southeast-2`, and authorized the six reviewed migrations, documented dev Auth/API settings and synthetic testing. The owner also confirmed the restorable baseline is **not yet verified**. This is not approval for production, real records, new projects, billing changes, live integrations, or public release.

## Status report

| Area | Status | Evidence / limit |
|---|---|---|
| Supabase connection | **COMPLETED** | Project ref and org (`utexlorymvedenjihkex`) match the handover. DB, Auth, REST and Storage returned `ACTIVE_HEALTHY`; PostgreSQL 17.12. Read-only SQL succeeded. Health is not a functional API test. |
| Migrations | **BLOCKED** | **0/6 applied** on hosted dev. History empty. Six files are byte-identical to commit `7cca86d40ca8697d0122411339a9f4360b0350b2`; no substitute schema, manual ledger entries or reset. |
| Database tables created | **NOT STARTED** on hosted dev | Zero `academy`/`academy_api` schemas, academy tables, RPCs, public tables, Auth users, user-defined triggers on `auth.users` or Storage buckets in preflight. The 89 application tables exist in the local migration rehearsal only. |
| Auth | **PARTIALLY COMPLETED** | Updated **only** public signup (open → closed) and access-JWT lifetime (3,600 → **900 seconds**) in hosted Auth. A separate config read confirmed both. Email confirmation required, anonymous/phone sign-in off, TOTP enrollment/verification on, refresh rotation on with 10-second reuse interval. No account creation, MFA challenge, email/SMS, or login test. Redirect defaults unchanged; approved HTTPS callback and secure password-change reauthentication still need configuration before onboarding. |
| RLS, Storage and Data API | **NOT STARTED** for academy objects | Managed `storage.objects` has RLS enabled; no academy policies, profile trigger or private buckets yet. REST currently exposes `public,graphql_public`, not `academy_api`. Do not expose the private `academy` schema. |
| Environment | **PARTIALLY COMPLETED** | The dev project URL is identified. Runtime still needs an approved origin and its publishable key in a protected runner. No service key is needed. Vercel is now connected; the CEYTEQ team search for `academy` returned no matching project. No env vars were written to an unrelated project, no project created and no deployment made. |
| Core APIs, admission and attendance | **COMPLETED** locally; **BLOCKED** on hosted dev | `npm run check`: **34 passed, 0 failed, 0 skipped**, including a new synthetic commissioning rehearsal over the existing handler and real disposable PostgreSQL. The rehearsal checked the guardian and enrollment links, duplicate rejection, card issue/rotation/revocation, scan replay and family isolation. Result: **one attendance record, zero active cards** for the run. Local Auth/REST transports are fixtures. No hosted application request, test student, guardian, card or scan is counted as passed. |
| Next action | **BLOCKED** on recovery verification | CEYTEQ records the restore result, rechecks the target, then applies the reviewed files in order. No second approval for the same scope is needed unless the target, migrations or conditions change. Frontend work waits for hosted acceptance. |

Application source, migration files, architecture, contracts, repository visibility and provider adapters were not changed. Payment, SMS, WhatsApp, social publishing and advertising remain disabled. The original [foundation report](foundation-report.md) is a historical local baseline; this report supersedes its target/connection/approval status.

## 1. Release the recovery hold

The owner or authorized DB operator should verify an existing supported backup **or** take an approved encrypted baseline using their protected tooling. Record the exact project ref, capture time, protected storage/retention, covered DB objects/roles and any separate Auth settings/Storage objects. Restore to an **isolated non-production recovery target**, never over the source project. Verify the restored contents and access, and compare aggregate inventories with [`scripts/dev-catalog.sql`](../scripts/dev-catalog.sql). Configuration readbacks and a clean catalog are **not** a backup or a restore test. Local fixture resets are not proof of hosted recovery.

Keep backups, credentials and detailed evidence outside Git/chat. Provide only the non-secret ticket reference, verification time and result. If a restore requires paid features, another cloud project or a plan change, stop for separate approval. The current connector does not provide a backup/restore-drill operation; restoring a paused project is not a backup restore.

## 2. Apply the existing migrations — **only after step 1**

Use an authenticated, network-authorized CEYTEQ operator runner and the official Supabase CLI. Preserve the existing file versions in Supabase's migration ledger; do not retype DDL, invent timestamps, or mark unexecuted versions as applied. Example pre-apply checks from this branch:

```sh
set -eu
ref=visphgkumgwnrajatidh
base=7cca86d40ca8697d0122411339a9f4360b0350b2
test "$(git branch --show-current)" = arena/ec56c36e-warunacademy
git diff --exit-code "$base" -- supabase/config.toml supabase/migrations
test -z "$(git ls-files --others -- supabase/migrations)"
supabase link --project-ref "$ref"
test "$(cat supabase/.temp/project-ref)" = "$ref"
supabase migration list --linked
supabase db push --linked --dry-run
```

Recheck database health, schema/bucket/policy collisions and Auth user/trigger counts. Compare the dry run to **exactly these six**: `20261118000100_core`, `20261118000200_learning_content_crm`, `20261118000300_provider_boundaries`, `20261118000400_access`, `20261118000500_admission_attendance`, `20261118000600_api`. **No hosted dry run or push was performed in this checkpoint.** Stop on drift or unexpected data. With target, recovery and plan verified, use `supabase db push --linked` on the same verified link; then `supabase migration list --linked`. Never pass `--include-all` to force a mismatch, run `db reset --linked`, or load the local test fixture DDL. If a migration fails, stop, record the last committed version, reconcile the ledger and review before resuming. Do not delete earlier migrations or audit evidence.

Run `scripts/dev-catalog.sql` **before** provisioning test users. Compare this evidence with the actual list of objects and [data dictionary](data-dictionary.md):

| Aggregate | Hosted now | Expected immediately after six |
|---|---:|---:|
| App schemas / app tables / RPC functions | 0 / 0 / 0 | 2 / 89 / 30 |
| App tables missing RLS / client-writable tables / anonymous executable RPCs | 0 / 0 / 0 (nothing installed) | 0 / 0 / 0 |
| Auth users / active academy profile trigger | 0 / 0 | 0 / 1 |
| Matching private buckets / policies on `storage.objects` | 0 / 0 | 2 / 1 (authorized library read only) |
| RLS on `storage.objects` | true | true |

Then expose **only `academy_api`** in dev Data API settings and verify the REST service schema readback; SQL grants and `NOTIFY` alone do not configure the exposed schema. Keep signup closed. Set the approved HTTPS dev Auth redirect(s), and enable secure password change/reauthentication (`security_update_password_require_reauthentication` currently false) in supported Auth settings. Confirm appropriate password policy before creating accounts. Do not enable OTP/SMS or weaken verification. Follow the [role and verified-link runbook](security-operations.md).

## 3. Test the hosted data plane without deploying a frontend

`npm run dev:smoke -- --plan` is offline and never writes. The separate opt-in command exercises the **existing Node handler in-process** with real user-context HTTPS calls to the pinned Supabase dev Auth and REST services. It is not a test of a Vercel deployment, real hardware, or a replacement for MFA and signed-file tests. CI only rehearses with disposable PostgreSQL and fixture transports; it never migrates or tests a hosted project.

After steps 1–2, create **synthetic confirmed identities** via approved Auth workflows, with separate roles. Set up a grade 6–11 course/group labeled `Synthetic commissioning`, a scheduled session today in Asia/Colombo with an open scan window, and an active registered device bound to the synthetic attendance operator and group. Prepare an unrelated synthetic guardian who already has a verified link to a control student; testing an unlinked account alone would give a misleading isolation result. Keep the test class/session visible on the first page. Do not assign an admin role to the smoke subjects, auto-confirm accounts, send to real recipients or fabricate user JWTs.

Inject these names through the operator's **private environment**, not command arguments, repository files, logs or chat:

| Names | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `API_ORIGIN` | Canonical `https://visphgkumgwnrajatidh.supabase.co`, project's publishable key, approved origin. `API_ORIGIN` constructs in-process requests; no listener is required. |
| `DEV_WRITE_REF`, `DEV_RECOVERY_TICKET`, `DEV_RUN_ID` | Explicit ref acknowledgement, actual verified recovery reference, operator-generated UUID for the synthetic run. A ticket string does not verify the restore by itself. |
| `DEV_GROUP_ID`, `DEV_SESSION_ID`, `DEV_DEVICE_ID`, `DEV_OTHER_STUDENT_ID` | Actual IDs from the designated synthetic class, session, registered device and unrelated verified control family. |
| `DEV_ADMISSIONS_JWT`, `DEV_CARD_ISSUER_JWT`, `DEV_SCAN_OPERATOR_JWT`, `DEV_OTHER_GUARDIAN_JWT` | Four fresh **user access tokens** from normal sign-in. Each subject has only its corresponding role. Never use management, refresh, service-role or database credentials. |

Only then run `npm run dev:smoke -- --run` from that protected operator environment. It refuses wrong refs/URLs, missing prerequisites and CI/deployment/production environments. It verifies profiles, a positive guardian link and the designated class/session before writes. Synthetic registration, a second duplicate attempt, enrollment/guardian reads, card issue, accepted scan, bound retry, duplicate scan, replacement, revocation and cross-family reads are checked. QR tokens remain in memory. Short-lived cards are revoked on the normal path; a failure attempts to revoke the last known issued card. Synthetic registration and immutable scan/audit evidence **remain**. If a response is lost, stop and reconcile the run UUID and request IDs; do not blindly retry an admission or print request.

Before accepting the hosted backend, also demonstrate AAL1 rejection/AAL2 success, same-family positive card/history after reviewed linking, two-family denial, teacher-scoped corrections/reports, refresh/logout, actual private file access and expiry, and the protected deployed HTTP origin if one is commissioned. No frontend, real data, live messaging or payment operation is needed for those checks.
