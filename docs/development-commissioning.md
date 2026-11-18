# Waruna Academy · development commissioning · 18 November 2026 UTC

**Decision: dev writes approved; migrations on hold for recovery evidence.** The owner confirmed `visphgkumgwnrajatidh` is the dedicated `academy-core` development target in `ap-southeast-2`, and authorized the six reviewed migrations, documented dev Auth/API settings and synthetic testing. The owner also confirmed the restorable baseline is **not yet verified**. This is not approval for production, real records, new projects, billing changes, live integrations, or public release.

## Recovery checkpoint — BLOCKED

| Evidence | Result |
|---|---|
| Source inspection (not a restore verification time) | At `2026-11-18T23:12:59Z` the dev catalog still had zero academy tables, Auth users, user-defined `auth.users` triggers, buckets, object rows or object policies. Storage object RLS is on and the migration ledger is empty. The earlier four-service health check was healthy. |
| Backup access | No source archive was made available to this workspace. The repository had zero Actions artifacts; a project-scoped Drive filename search returned no recovery file. The authorized Supabase connector cannot list/export a backup or restore it to a separate target. This does **not** establish whether a backup exists in the provider dashboard. |
| Isolated destination | No existing database branch was returned. The owner confirmed that protected backup/runner access is not available yet. No branch, project or subscription change was requested. |
| Actual restore | **Not started.** No backup captured here, no archive restored, no restore completion time, and no verified recovery ticket. The read-only inventory below must not be used as `DEV_RECOVERY_TICKET`. |

**Next action:** provide access on a protected operator runner to a backup of this exact project (or a read-only backup connection to it) and a separate, compatible, isolated PostgreSQL 17 recovery target. Use an existing, no-additional-cost environment; never restore over the source. Only the completed drill in step 1 releases the migration hold. The existing dev-write approval is unchanged.

## Status report

| Area | Status | Evidence / limit |
|---|---|---|
| Supabase connection | **COMPLETED** | Project ref and org (`utexlorymvedenjihkex`) match the handover. DB, Auth, REST and Storage returned `ACTIVE_HEALTHY`; PostgreSQL 17.12. Read-only SQL succeeded. Health is not a functional API test. |
| Migrations | **BLOCKED** | **0/6 applied** on hosted dev. History empty. Six files are byte-identical to commit `7cca86d40ca8697d0122411339a9f4360b0350b2`; no substitute schema, manual ledger entries or reset. |
| Database tables created | **NOT STARTED** on hosted dev | The source inspection found **0/89 academy tables**, zero academy schemas/RPCs and zero Auth users. The earlier preflight also found zero public tables or user-defined triggers on `auth.users`. The 89 application tables exist in the local migration rehearsal only. |
| Auth | **PARTIALLY COMPLETED** | Previously updated and read back public signup (closed) and access-JWT lifetime (**900 seconds**). No Auth change in the recovery check. Email confirmation required, anonymous/phone sign-in off, TOTP enrollment/verification on, refresh rotation on with 10-second reuse interval. No account creation, MFA challenge, email/SMS, or login test. Redirect defaults unchanged; approved HTTPS callback and secure password-change reauthentication still need configuration before onboarding. |
| RLS, Storage and Data API | **NOT STARTED** for academy objects | Managed `storage.objects` has RLS enabled; **zero buckets, object rows and object policies**. Academy table RLS and the two private buckets are not installed. REST currently exposes `public,graphql_public`, not `academy_api`. Do not expose the private `academy` schema. |
| Environment | **PARTIALLY COMPLETED** | The dev project URL is identified. Runtime still needs an approved origin and its publishable key in a protected runner. No service key is needed. The earlier Vercel team search for `academy` returned no matching project. No env vars were written to an unrelated project, no project created and no deployment made. |
| Core APIs, admission and attendance | **COMPLETED** locally; **BLOCKED** on hosted dev | Previous `npm run check`: **34 passed, 0 failed, 0 skipped**, including a synthetic commissioning rehearsal over the existing handler and real disposable PostgreSQL. The rehearsal checked the guardian and enrollment links, duplicate rejection, card issue/rotation/revocation, scan replay and family isolation. Result: **one attendance record, zero active cards** for the run. Local Auth/REST transports are fixtures. No hosted registration, guardian, card issue/revocation or attendance test ran. The completed local suite was not repeated in the recovery check. |
| Next action | **BLOCKED** on recovery verification | The authorized operator records the restore result, rechecks the target, then applies the reviewed files in order. No second approval for the same scope is needed unless the target, migrations or conditions change. Frontend work waits for hosted acceptance. |

The recovery check made no hosted writes. The subsequent PR review tightened the runtime’s allowed Supabase destination and credential checks, isolated the POSIX test database socket, and added Git exclusions for recovery exports. The six migration files, original architecture specification, endpoint contracts, repository visibility and provider adapters were not changed. Payment, SMS, WhatsApp, social publishing and advertising remain disabled. The original [foundation report](foundation-report.md) is a historical local baseline; this report supersedes its target/connection/approval status.

## 1. Release the recovery hold

Use Supabase’s [platform-to-self-hosted restore procedure](https://supabase.com/docs/guides/self-hosting/restore-from-platform) on **existing operator hardware**. A downloadable logical backup of this ref may be used if already available and its coverage and integrity are known. If the Dashboard offers only an in-place restore or a non-downloadable physical backup, leave it alone and use the logical export below. Do not pause the project, buy PITR, create a cloud project or use repository migrations as the backup.

1. **Capture on the protected source runner.** In the **Connect** panel of `visphgkumgwnrajatidh`, confirm the direct or session-pooler endpoint. Use an existing DB login authorized to read the full required baseline, verified TLS and a mode-0600 password file. `SOURCE_DSN` below is the **password-free** database URI; `BACKUP_ROOT` is an approved encrypted volume outside Git. Use the official CLI **3.2.0** with its supported dump runtime. Keep writes quiescent across the three exports. Save the capture UTC, source ref, PG/extension versions, current roles/grants, ledger and [catalog](../scripts/dev-catalog.sql) in the restricted ticket. Stop on unexpected users, objects or permission errors.

   ```sh
   set +x; set -eu; umask 077
   dir=$(mktemp -d "${BACKUP_ROOT:?}/waruna-baseline.XXXXXXXX")
   supabase db dump --remote="${SOURCE_DSN:?}" --role-only -f "$dir/roles.sql"
   supabase db dump --remote="$SOURCE_DSN" -f "$dir/schema.sql"
   supabase db dump --remote="$SOURCE_DSN" --data-only --use-copy -f "$dir/data.sql"
   (cd "$dir" && sha256sum roles.sql schema.sql data.sql > SHA256SUMS)
   ```

   Keep the digest reference, encrypted files and retention date under operator control; do **not** run `db dump --dry-run` with credentials or upload dumps/logs here. The [CLI backup notes](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) distinguish user schema/data from platform-managed definitions: separately account for any custom Auth triggers, Storage policies and migration history (none in this baseline). Record non-secret Auth/API settings separately. DB backups do not contain Storage file bytes; confirm the object count at capture. If files, Vault-encrypted data or other excluded state require recovery, stop until their separate protected recovery is covered. Do not export project keys into the ticket.

2. **Restore the actual captured files.** Use a clean, isolated self-hosted **Supabase-compatible PG17** target and patched 17.x clients (17.12 or later), with matching Auth/Storage schema versions, managed roles and required extensions. Start it separately from this checkout, without pre-applying academy migrations or seeds. Do not use bare PostgreSQL or the npm test fixture. Keep API, workers and outbound delivery off. From a restore session with **no source credentials or route to the source**, configure a private libpq service `waruna_restore` for **only** that target. Confirm its host/socket and database independently before writing. On the target, in the protected copy of the dump directory, verify the manifest against the capture ticket, then run:

   ```sh
   set -eu
   sha256sum -c SHA256SUMS
   psql -X -w -d 'service=waruna_restore' --single-transaction -v ON_ERROR_STOP=1 \
     -f roles.sql -f schema.sql -c 'SET LOCAL session_replication_role = replica' -f data.sql
   ```

   The provider’s trigger setting is local to the isolated import transaction. Never run the restore against a linked/cloud source, ignore an error, discard a failing table, or change access policies to get a pass. For an existing archive in a different format, use its documented restore method on the same isolated target (`pg_restore --exit-on-error --single-transaction` for a trusted custom-format archive).

3. **Verify and hand off.** In a new target session compare the restored schema/objects, role memberships, effective grants and RLS, extension compatibility, ledger and aggregate data counts to the captured source. Positively check that `auth.users` and `storage.objects` exist and managed Storage RLS is on, even when there are no users or files. Check ordinary client access is no broader than on the source. The empty counts alone do **not** prove an import ran. Record the successful import exit status and comparison (or discrepancy) privately. Return only the **source ref, non-secret artifact/ticket reference, capture UTC, isolated target label, verification UTC and pass/fail**. No DSNs, keys, file contents or identities. A failed or partial restore keeps the hold in force.

## 2. Apply the existing migrations — **only after step 1**

Use a clean checkout on the authenticated development operator runner with [Supabase CLI 3.2.0](https://github.com/supabase/cli/blob/v3.2.0/apps/cli/docs/supabase/db/push.md). Use an explicit remote ref, not the CLI’s default target or an inherited target selection. Do not load unreviewed config overrides, seeds, roles or Vault settings. Preserve the existing file versions in the ledger; do not retype DDL, invent timestamps, or mark unexecuted versions as applied. Pre-apply checks from this branch:

```sh
set -eu
ref=visphgkumgwnrajatidh
base=7cca86d40ca8697d0122411339a9f4360b0350b2
test "$(git branch --show-current)" = arena/ec56c36e-warunacademy
git diff --exit-code "$base" -- supabase/config.toml supabase/migrations
test -z "$(git ls-files --others -- supabase/migrations)"
test ! -e supabase/config.json
test -z "${SUPABASE_YES:-}"
supabase migration list --remote="$ref"
supabase db push --remote="$ref" --skip-vault --dry-run
```

Recheck database health, schema/bucket/policy collisions and Auth user/trigger counts. Compare the dry run to **exactly these six**: `20261118000100_core`, `20261118000200_learning_content_crm`, `20261118000300_provider_boundaries`, `20261118000400_access`, `20261118000500_admission_attendance`, `20261118000600_api`. **No hosted dry run or push was performed in this checkpoint.** Stop on drift or unexpected data. With recovery verified, check the CLI’s `Target:` line names this exact ref and only those six versions are pending. Apply interactively with `supabase db push --remote="$ref" --skip-vault`; then check `supabase migration list --remote="$ref"`. Never pass `--include-all` to force a mismatch, run `db reset --linked`, or load the local test fixture DDL. If a migration fails, stop, record the last committed version, reconcile the ledger and review before resuming. Do not delete earlier migrations or audit evidence.

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
