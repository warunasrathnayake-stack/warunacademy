# academy-core · backend foundation

Internal identifier only. CEYTEQ – Ceylon Technology is the development and management partner for Waruna Rathnayaka. The dedicated development tenant is confirmed; the public name, domain and production tenancy are not. This repository contains a TypeScript server API and Supabase/PostgreSQL migrations for **one** academy. It has no frontend and no enabled external provider. The [supplied Master Technical Architecture V2.0](docs/spec/master-architecture-v2.txt) is the primary specification.

**Start here:** [current development commissioning status and recovery gate](docs/development-commissioning.md) · [original foundation report](docs/foundation-report.md) · [API contracts](docs/api.md) · [local setup, security and commissioning](docs/security-operations.md).

## Verify without credentials

Use Node 22.14+ (22 LTS recommended), npm and a non-root development account. No Docker, project link or secrets are required for these checks.

```sh
npm ci
npm run check
```

This runs ESLint, formatting checks, strict TypeScript checks, synthetic tests and generated-document drift checks. Tests start a disposable loopback PostgreSQL 17 cluster from a pinned development dependency, apply **all six migrations**, exercise RLS as actual restricted database roles, and remove the cluster. Auth claims and the managed Storage schema/transport are fixtures, **not** a hosted Auth or Storage verification. There is no test switch for connecting to a live database.

| Task | Command |
|---|---|
| Preview the post-migration synthetic smoke plan (offline) | `npm run dev:smoke -- --plan` |
| Database/authorization tests only | `npm run test:db` |
| All tests (including HTTP, environment and Node entry point) | `npm test` |
| Regenerate [OpenAPI 3.1](docs/openapi.json) from runtime contracts | `npm run docs:api` |
| Regenerate the [data dictionary](docs/data-dictionary.md) from a clean catalog | `npm run docs:schema` |
| Run server for an approved local stack | Copy `.env.example` to `.env.local`, set `API_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, then `npm run dev` |

## What runs

* Supabase email-session verification, least-privilege user-context RPC, scoped RLS and privileged MFA gates. No service key in the API.
* Staff course/class/session/device provisioning; atomic student/guardian registration, consent and enrolment; opaque QR issuance, rotation and revocation; supervised idempotent attendance, reasoned corrections and daily/class rosters.
* Entitlement-checked private library access; basic CRM lead/stage/follow-up, CMS drafts and personal notification reads.
* Disabled adapters and reserved callback routes that **refuse** traffic. No payments, ads, messaging, publishing, imports, queue worker or AI calls.

## Repository guide

| Path | Purpose |
|---|---|
| `supabase/config.toml`, `supabase/migrations/` | Local-only Auth/API baseline; schema, roles, RLS, private buckets and transactional RPCs |
| `src/modules/`, `src/platform/`, `src/integrations/` | Versioned domain contracts, validation/transport/authorization boundary, inert provider adapters |
| `api/v1/[...route].ts`, `vercel.json` | Node function entry point; Git auto-deployment disabled |
| `tests/`, `scripts/`, `.github/workflows/check.yml` | Disposable test harness, contract generation and read-only PR checks |
| [Architecture](docs/architecture.md) | All 18 modules, dependencies, ERD, delivered versus future scope |
| [Integration register](docs/integrations.md) | Credentials by **type**, scopes, refresh/webhooks, security and approval gates |
| [Incumbent migration plan](docs/incumbent-migration.md) | Discovery, mapping, staged crosswalk, pilot/parallel run, cutover and rollback |

**Do not link/deploy based on a project name.** Confirm dedicated tenancy, visibility/IP, region, environment and write approval first. See the [runbook](docs/security-operations.md) for first accounts/roles, verified family links, shared ingress protections, backups and restore gates. Never commit `.env.local`, student exports, raw QR tokens, private files or service credentials.
