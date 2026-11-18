# Backend API v1

[OpenAPI 3.1](openapi.json) is generated from the runtime route and Zod definitions (`npm run docs:api`). It describes methods, fields, validation, scopes, results and the error envelope. Base: `/api/v1`. This is **implemented source**, not a public base URL. No browser session is created by this backend.

| Domain | Implemented HTTP contracts (relative to base) |
|---|---|
| Identity | `GET /me`, `POST /auth/logout` |
| Academic provisioning | `POST /admin/courses`, `/admin/classes`, `/admin/sessions`; `GET /classes`, `/classes/{group_id}/sessions` |
| Devices | `POST /admin/devices`, `/admin/devices/{device_id}/disable` |
| Registration & family | `POST /admissions`, `/enrollments`, `/guardian/consent`; `GET /students`, `/students/{student_id}/guardians`, `/students/{student_id}/enrollments` |
| Cards | `POST /cards/issue`, `/cards/revoke`; `GET /cards/{card_id}/print`, `/students/{student_id}/cards` |
| Attendance | `POST /attendance/scan`, `/attendance/override`; `GET /attendance/reports?day=YYYY-MM-DD[&group_id=UUID]`, `/students/{student_id}/attendance` |
| Library | `GET /resources`, `/resources/{resource_id}/access` |
| CRM | `GET` and `POST /admin/leads`, `PATCH /admin/leads/{lead_id}` |
| CMS & notifications | `GET /posts`, `POST /admin/posts`, `GET /notifications` |
| Disabled callbacks | `POST /webhooks/{provider}`: `meta`, `whatsapp`, `sms`, `payments`, `live-class` always return **503 integration_disabled**. No payload read, challenge answered, or event persisted. Unknown provider: 404. |

### Authentication and privacy contract

1. Authenticate directly to **the approved Supabase Auth tenant**: confirmed email/password, refresh-token grant, password recovery with allowlisted callback; TOTP enroll/challenge/verify before admin access. Public sign-up, anonymous accounts and SMS login are closed in this foundation. There is no password-handling proxy or role-management HTTP endpoint. No invitations, resets or emails are sent by setup.
2. Supply `Authorization: Bearer <user access JWT>` (never an anon/service key as a user credential). The API calls `/auth/v1/user`, requires a confirmed non-anonymous identity, then calls RPC with **the same** JWT and the publishable key. Roles come from database joins, never editable user metadata. A profile must be provisioned. `POST /auth/logout` revokes refresh for this session; already issued JWTs can remain valid until expiry.
3. This is a bearer-only API; cookies do not authenticate it. An `Origin` header must match `API_ORIGIN`, no wildcard CORS, no cookie-based write fallback. If a future browser BFF handles refresh tokens, require HTTPS, HttpOnly/Secure/SameSite cookies, strict redirect allowlists, CSRF tokens and origin checks before switching auth modes. Do not put refresh tokens in persistent browser storage.
4. JSON writes only, bounded to 64 KiB. Unexpected fields, duplicate query keys, invalid enum/UUID/date, absent consent, etc. fail before the RPC. Result schemas allowlist response fields. All responses use `Cache-Control: no-store`. Treat QR values and signed URLs as bearer secrets.
5. Success: `{ "data": ..., "request_id": ... }`. Failure: `{ "error": { "code": ..., "request_id": ... } }`; also `X-Request-Id`. An HTTP correlation ID is **not** the client's idempotency key. `400` malformed JSON; `401` missing/invalid session; `403` permission/origin/profile; `404` missing/inaccessible single resource; `405` method; `409` duplicate/conflicting identity or idempotency key; `413/415/422` size/media/validation; `429` quota with Retry-After; `502/503` invalid/unavailable upstream, missing config or disabled integration. No SQL detail, stack, PII or provider response body is returned on error.
6. Lists are RLS-filtered: an empty result does not disclose whether another family's row exists. Paged lists return up to 100, stable ordering, integer `offset` (0–999999, default 0). Guardian/enrolment lists are scoped to one student; card history returns the latest 100. Reports are scoped reads; no bulk export permission is implied.

### Admission → card → supervised scan

* An AAL2 administrator provisions a course (grade 6–11), group with teacher, session with explicit open/close/late cutoffs, and operator-bound device. Attendance rules are inputs; do not guess the academy's grace period. A 24-hour maximum scan window is an implementation safety ceiling.
* An admissions officer submits `request_id`, name, birth date, group, relationship and affirmative guardian consent with `notice_version` and non-sensitive `evidence_ref`. Use either a reviewed `guardian_id` **or** new name + E.164 phone. In one transaction: create student/code, link guardian, append admission consent, enroll and audit. A contact is **not** automatically a portal user. Existing-guardian linking requires staff verification of custody, not just matching phone.
* Same registration request ID or same normalized name + birth date + guardian phone returns **409**, with no orphan rows. This is collision detection, not definitive identity proof: shared names or changed contacts require human review. Never merge automatically. Explicitly verified guardians can append consent grants/withdrawals for their child; latest per-guardian evidence governs future enrolment/card/scan eligibility. Marketing, recording and notices require separate purposes.
* Card issuance returns `card_id`, one-time `qr_token`, expiry and a print-job reference. The token consists of two independent random UUIDv4 values encoded without dashes (244 random bits); the database stores only SHA-256. Print metadata contains name/code/grade/validity, no QR lookup or public file. Use the one-time issuance response in an authorized print process; if lost, issue with `replace:true`. Replacement/renewal revokes the prior card, cancels pending prints and rotates the token atomically. No printing or public brand rendering is implemented.
* A supervised scan includes `request_id`, `session_id`, `device_id`, `qr_token`. No client clock, attendance status or student ID is accepted. Device must be registered, active and assigned to the authenticated operator and class. Server checks card status/expiry, active student, valid admission consent, enrollment, session status/time window. **200** records a domain result (`present`, `late`, `duplicate`, `invalid_card`, `outside_window`, `not_enrolled`), not necessarily a present mark. Unauthorized device/operator gets 403 **before** student lookup. A device ID is a registration binding, not hardware attestation or proof of presence.
* The immutable event and attendance write commit together. Retry a lost response with the **same** request ID, operator, device, session and token; get the original result (not a second physical scan). Changed input on a used key is 409. A fresh request for an already marked student records a `duplicate` event without overwriting a correction. Supervised scanning and anomaly review remain necessary against shared/copied cards.
* A scoped teacher/admin can correct or manually mark a rostered student with a reason; before/after, actor and time are retained. Staff daily/class report is a roster, not an inferred absence list. Guardian/student history excludes other families. Monthly export, offline mode, bulk import, automated notices and card PDFs are **not active**.

### Deferred contracts from the primary spec

No handlers for anonymous public enquiries/lead forms, public publishing, assignment submission, social jobs, checkout, outbound send, OAuth callbacks, AI/chat/reindex, export or `/imports/students`. Proposed contracts require privacy/abuse controls, separate privileges, provider prerequisites and tests. Do not wire placeholder 2xx responses or toggle real actions on with an environment flag.
