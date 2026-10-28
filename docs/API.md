# API reference

[Documentation index](../README.md) · [Drawing behavior](DRAWING.md) · [Operations](OPERATIONS.md)

Implementation: [`api/src/worker.js`](../api/src/worker.js). Production base: `https://nob-hill-chile-drop-api.jogo.workers.dev`. These routes are unversioned; coordinate browser and Worker releases for contract changes. This is a reference, not permission to mutate production.

## Requests, authentication and responses

- `GET /health` and `GET /api/config` can be read without an Origin header. All other routes require an exact allowed `Origin`, including authenticated GETs. Production currently allows `https://aindaco1.github.io` (no project path).
- JSON bodies must be objects with `Content-Type: application/json`, with a maximum body size of 8,192 bytes. Empty draw actions still send `{}`. The deletion route has no JSON body requirement.
- Private requests use `Authorization: Bearer <accessToken>`. Entry and admin tokens are distinct roles. No cookies are used; the browser wrapper sets `credentials: 'omit'` and a 20-second request timeout.
- `OPTIONS` responds 204 for an allowed origin and permits GET, POST, PATCH, DELETE and OPTIONS with Content-Type/Authorization headers. Origin checks are not a substitute for Bearer authorization.
- JSON errors have `{ "error": "Readable message", "code": "machine_code" }`. Internal exceptions become generic 503 `service_error`; no stack, SQL or provider payload is returned.
- Responses use `Cache-Control: private, no-store`, `Vary: Origin`, no-referrer, nosniff and noindex headers. CSV is the sole non-JSON success response.

## Public and entry routes

| Method and route | Auth | Body | Success |
| --- | --- | --- | --- |
| `GET /health` | None | — | 200 `{ok, emailConfigured}`; reads settings and checks mail configuration shape |
| `GET /api/config` | None | — | 200 public settings and event metadata, below |
| `POST /api/entries` | Origin | `{name, email, groupSize, consent: true}` | 202 generic acknowledgment; queues a verification/access link |
| `POST /api/entries/link` | Origin | `{email}` | 202 same generic acknowledgment whether an entry exists or not |
| `POST /api/entries/verify` | Origin | `{token}` | 200 `{accessToken, expiresAt, entry}` |
| `GET /api/entries/status` | Entry Bearer + Origin | — | 200 `{entry}` |
| `PATCH /api/entries` | Entry Bearer + Origin | `{name, groupSize, consent: true}` | 200 `{entry}`; only while verified, open and unlocked |

`name` is trimmed, 1–120 characters with control characters rejected. `email` is normalized and validated, at most 254 characters. `groupSize` must be a JSON integer, 1–2000 (not a numeric string); consent must be literal `true`. Email cannot be changed with PATCH.

The generic acknowledgment intentionally avoids account enumeration:

```json
{
  "ok": true,
  "message": "If this address can receive a link, check your email. Links may take a few minutes."
}
```

A 202 does not prove eligibility, provider acceptance or inbox delivery. Duplicate registration does not overwrite an existing group's name/size. First verification is blocked after closing/preparation; previously verified owners can still exchange a fresh link for status access.

Public config contains:

| Field | Meaning |
| --- | --- |
| `registrationOpen` | Stored registration flag **and** mail readiness; can be false even if the stored flag is open |
| `capacity`, `locked`, `revision` | Current capacity, whether an immutable preview exists, and settings/entry revision |
| `freeEntry`, `priceCents`, `maxGroupSize` | `true`, `0`, `2000` |
| `consentVersion` | Current required consent revision (`free-drawing-2026-10-27` at this review) |
| `resultsPublished`, `results` | Boolean and either null or `{selectedOrders, selectedPeople}`; no identities |
| `eventDate`, `dropTime`, `timezone` | Event date, explicit midnight instant and IANA zone; currently hardcoded in Worker source |

An entry object contains `id`, `name`, `email`, `groupSize`, `verified`, `status`, `canEdit` and `createdAt`. Status is `pending_verification`, `entered`, `selected` or `waitlisted`. Entrants see only `entered` until results are published. Returned `createdAt`/`expiresAt` values are ISO timestamps; database and CSV timestamps use epoch milliseconds.

## Organizer routes

| Method and route | Auth | Body/query | Success |
| --- | --- | --- | --- |
| `POST /api/admin/login` | Origin | `{email}` | 202 generic acknowledgment; only allowlisted emails receive a link |
| `POST /api/admin/verify` | Origin | `{token}` | 200 `{accessToken, expiresAt}` |
| `GET /api/admin/entries` | Admin Bearer + Origin | `limit` 1–200, default 50; `offset` ≥0, default 0; both integers | 200 dashboard snapshot |
| `GET /api/admin/entries.csv` | Admin Bearer + Origin | — | 200 private `text/csv` attachment |
| `PATCH /api/admin/settings` | Admin Bearer + Origin | `{registrationOpen?: boolean, capacity?: integer}`; at least one field | 200 `{settings}`; immutable once prepared |
| `POST /api/admin/draw/preview` | Admin Bearer + Origin | `{}` | 200 fixed preview; **first call prepares and locks the drawing** |
| `POST /api/admin/draw/commit` | Admin Bearer + Origin | `{previewId}` | 200 `{ok, previewId, committedAt, published}` |
| `POST /api/admin/draw/publish` | Admin Bearer + Origin | `{}` | 200 `{ok, publishedAt, queuedWinnerEmails}`; repeat returns `alreadyPublished: true` |
| `DELETE /api/admin/entries/:id` | Admin Bearer + Origin | UUID path parameter | 200 `{ok, action: "deleted"}` before preparation, or `"anonymized"` afterward |

The dashboard snapshot contains:

- `entries`: page of `{id, name, email, groupSize, verified, createdAt, status, rank}`, newest first; rank may be null.
- `total`, `counts`: total orders/people and verified orders/people. “Orders” is the internal name for group entries, not purchases.
- `settings`: the same effective registration/capacity/lock/revision view as public config.
- `preview`: null or `previewId` plus drawing totals.
- `drawing`: null or `{previewId, committedAt, publishedAt}` (publication time may be null).
- `outbox`: object mapping existing mail statuses to counts; absent status keys mean zero.

The preview response includes `previewId`, `createdAt`, `capacity`, `eligibleOrders`, `selectedOrders`, `selectedPeople`, `waitlistedOrders`, `waitlistedPeople`, `unusedCapacity`, and private `results`. Each result includes `entryId`, `rank`, `status`, `groupSize`, `name`, `email`. Repeating preview returns the saved result; it does not reroll. Admin result visibility is independent of guest publication.

## Token lifetimes and limits

| Credential | Lifetime | Behavior |
| --- | --- | --- |
| Entry link | 30 minutes | Single use; emailed in URL fragment |
| Organizer link | 15 minutes | Single use; allowlist checked again on exchange |
| Entry session | 24 hours | Bearer access to that entry |
| Organizer session | 2 hours | Bearer admin access; allowlist rechecked on each request |

Tokens are 32 random bytes encoded as 43 base64url characters; only SHA-256 hashes are stored in the token table. Link consumption and session creation are atomic. UI sign-out clears `sessionStorage`, not the server session. Expired token/rate-limit rows are cleaned by scheduled work after a one-day grace period; expired tokens already fail auth immediately.

Mutating requests are limited to 60 per IP per 15-minute bucket. Entry registration/link requests share a 3-per-email hourly bucket; organizer login has its own 3-per-email hourly bucket. Hashes incorporate the outbox key. Rate limits are abuse controls, not household identity verification.

## Common failure handling

| Status/code | Client or operator response |
| --- | --- |
| 400 `invalid_request` | Correct the supplied fields; preserve useful form input |
| 401 `unauthorized` / `invalid_token` | Clear stale browser session; obtain a fresh link when appropriate. First verification may already be closed. |
| 403 `origin_forbidden` | Check the exact browser origin and allowlist; do not weaken production CORS for local testing |
| 409 `registration_closed` | Stop accepting edits/entries and refresh config/status |
| 409 `registration_open` | Close registration before preparation, only with organizer direction |
| 409 `drawing_locked` | Preparation already fixed registration/capacity; do not reset it |
| 409 `no_entries` | There are no verified eligible groups |
| 409 `stale_preview` / `drawing_committed` / `drawing_missing` | Refresh the saved state and follow the existing transition; do not manufacture a new preview |
| 413 / 415 | Send a bounded JSON object with the required content type |
| 429 `rate_limited` | Wait for the rate bucket to expire; do not loop login/registration attempts |
| 503 `email_unavailable` | Mail configuration is incomplete; registration/publication fail closed |
| 503 `service_error` | Inspect service health/configuration and private diagnostics; an uncertain mutation may already have succeeded |

Use [the isolated fixture](../api/test/helpers.js) for write examples and regression tests. Safe production probes are the two read-only routes shown in [Operations](OPERATIONS.md). Do not paste live tokens into shell history, docs or support threads.
