# Free group drawing

The Chile Drop Worker owns free drawing entries, verified email ownership, administration, random selection and operational email. It has no prices, payment processing, paid entries or admission purchases. The public site is static GitHub Pages; the Worker and D1 are separate services.

The canonical event is December 31, 2026 at Hotel Zazz, Albuquerque. Midnight is `2027-01-01T00:00:00-07:00` in `America/Denver`.

## Reuse and boundaries

The site pins Dust Wave Platform at `ad2be4580fc05978e7d8d05c93c3038c13e09876` (Platform v0.44.0). The API imports worker-core's request validation, random tokens/checksums, automatic email headers, canonical outbox IDs/retry delay, Resend error classification and bounded response readers directly from that pin. Its domain schema, rules, authorization and D1 persistence remain consumer-owned.

Store's RSVP flow was reviewed as a precedent. It currently confirms admission immediately, supports a maximum configured party size of 20, and does not implement random selection or a capacity-aware waitlist. Using that confirmed-RSVP flow for these drawing entries would misrepresent admission. No Store source or unrelated Store changes were copied. Future confirmed-winner ticket/check-in integration can use Store after an explicit integration design.

## Rules implemented

- Registration starts **open**, per the organizer's instruction; closing and drawing are manual. The public config fails closed when email secrets are missing.
- Each normalized email address has one group of 1–2,000 people. Normalization trims whitespace and lowercases; it does not claim that multiple email addresses identify one person.
- The initial submission records explicit entry consent and emails a one-time verification link. Only verified entries are eligible. Re-submitting an address never overwrites its group; the verified owner can edit while entries remain open.
- Capacity defaults to 2,000 and cannot exceed 2,000. Close registration before preparing the drawing. Closing also ends first-time verification and group edits. Existing verified owners can still sign in and see private status.
- Fisher–Yates uses cryptographic random integers with rejection sampling. Each group receives one uniformly random position, regardless of its size. Select whole groups in that order, stopping at the **first** group that cannot fit. That group and all later groups form the waitlist. Unused capacity is possible. No automatic promotion or partial admission occurs.
- Equal random rank is not a guarantee of identical final admission probability for different group sizes: the capacity rule affects which complete groups fit. Public copy should describe the method rather than promise identical final odds.
- Preparing persists one immutable random order. Repeated/concurrent previews return that same order; reopening registration and changing capacity are then locked. There is no reroll endpoint. Preview contains private names/emails for operator review.
- Committing the reviewed preview atomically stores one draw and its results. Retrying commit does not rerun it. Results remain private until the administrator explicitly publishes. Publishing exposes **counts only** publicly and queues one winner email per selected, non-erased group. Individual status is accessible only through the owner's private token.
- Selection grants free Hot Spot admission for the entire group. It does not issue a QR code, hotel wristband, alcohol purchase or check-in entitlement. Arrival/check-in instructions remain an organizer follow-up.

## API contract

API base: `https://nob-hill-chile-drop-api.jogo.workers.dev`. All responses are `private, no-store` and `noindex`. JSON writes require `Content-Type: application/json` and an exact allowed `Origin`. The maximum body is 8 KiB. Error bodies are `{error,code}` with appropriate 4xx/503 statuses.

| Method and route | Request / response |
| --- | --- |
| `GET /health` | `{ok,emailConfigured}`; reads D1 but reveals no credentials |
| `GET /api/config` | `{registrationOpen,capacity,locked,revision,freeEntry:true,priceCents:0,maxGroupSize:2000,consentVersion,resultsPublished,results,eventDate,dropTime,timezone}`; `results` is null or `{selectedOrders,selectedPeople}` |
| `POST /api/entries` | `{name,email,groupSize,consent:true}` → generic 202 receipt; creates pending entry and queues verification |
| `POST /api/entries/link` | `{email}` → same generic 202 receipt; sends a link only for an existing entry; works after closing |
| `POST /api/entries/verify` | `{token}` → `{accessToken,expiresAt,entry}` |
| `GET /api/entries/status` | Entry Bearer token → `{entry}` |
| `PATCH /api/entries` | Entry Bearer token + `{name,groupSize,consent:true}` → `{entry}`; email cannot change |
| `POST /api/admin/login` | `{email}` → generic 202; only configured administrators receive a link |
| `POST /api/admin/verify` | `{token}` → `{accessToken,expiresAt}` |
| `GET /api/admin/entries?limit=50&offset=0` | Admin Bearer token → paged entries, counts, settings, preview/draw summaries and outbox counts; limit 1–200 |
| `GET /api/admin/entries.csv` | Admin Bearer token → private CSV, with spreadsheet formula prefixes neutralized |
| `PATCH /api/admin/settings` | Admin Bearer token + `{registrationOpen?,capacity?}` → `{settings}` |
| `POST /api/admin/draw/preview` | Admin Bearer token + `{}` → persisted preview and private ranked results |
| `POST /api/admin/draw/commit` | Admin Bearer token + `{previewId}` → `{ok,previewId,committedAt,published}` |
| `POST /api/admin/draw/publish` | Admin Bearer token + `{}` → `{ok,publishedAt,queuedWinnerEmails}` or `{ok,publishedAt,alreadyPublished:true}` |
| `DELETE /api/admin/entries/:id` | Admin Bearer token → `{ok,action:'deleted'\|'anonymized'}`; handles a verified privacy request |

An entry is `{id,name,email,groupSize,verified,status,canEdit,createdAt}`. Status is `pending_verification`, `entered`, `selected` or `waitlisted`. Unpublished drawing results are never returned to entry owners.

The admin list response is:

```json
{
  "entries": [{"id":"uuid","name":"Guest","email":"guest@example.test","groupSize":4,"verified":true,"createdAt":"ISO timestamp","status":"entered","rank":null}],
  "total": 1,
  "counts": {"totalOrders":1,"totalPeople":4,"verifiedOrders":1,"verifiedPeople":4},
  "settings": {"registrationOpen":true,"capacity":2000,"locked":false,"revision":2},
  "preview": null,
  "drawing": null,
  "outbox": {"queued":1}
}
```

Preview summary fields are `previewId`, `capacity`, `eligibleOrders`, `selectedOrders`, `selectedPeople`, `waitlistedOrders`, `waitlistedPeople`, `unusedCapacity`. The preview endpoint adds `createdAt` and `results:[{entryId,rank,status,groupSize,name,email}]`. A committed drawing is `{previewId,committedAt,publishedAt:null|string}`.

The emailed URLs are `${PUBLIC_SITE_URL}/entry/#token=...` and `${PUBLIC_SITE_URL}/admin/#token=...`. The browser must remove the fragment after reading it, exchange the token and avoid embedding either token in analytics, links, logs or public content. Session tokens are opaque Bearer credentials, not cookies. Entry links expire after 30 minutes, admin links after 15 minutes; they are consumed atomically once. Entry sessions last 24 hours and admin sessions two hours. The allowlist is rechecked for every admin session request.

## Provision and run

The checked-in `api/wrangler.toml` names the Cloudflare account, Worker and provisioned D1 database. Those identifiers are public deployment configuration, not secrets. Parent/project deployment owns production changes.

Required secrets:

- `RESEND_API_KEY`: key permitted to send from the verified `dustwave.xyz` domain.
- `OUTBOX_ENCRYPTION_KEY`: 32 random bytes encoded as base64url (43 characters). Keep a secure backup. Do not rotate while messages are pending without migrating their encrypted payloads.

Configured variables: `ALLOWED_ORIGINS=https://aindaco1.github.io`, `PUBLIC_SITE_URL=https://aindaco1.github.io/nob-hill-chile-drop`, `ADMIN_EMAILS=alonso@dustwave.xyz`, `REPORT_EMAIL=alonso@dustwave.xyz`, `EMAIL_FROM=Nob Hill Chile Drop <events@dustwave.xyz>`. Email replies go to `REPORT_EMAIL`.

```sh
cd api
wrangler secret put RESEND_API_KEY
wrangler secret put OUTBOX_ENCRYPTION_KEY
wrangler d1 migrations apply nob-hill-chile-drop --remote
wrangler deploy
```

For local development, place test credentials in an ignored `api/.dev.vars` and use a separate local D1 database with `wrangler d1 migrations apply nob-hill-chile-drop --local`. Override origin/site URL to the actual local preview origin. Never connect a local fixture to production Resend. The automated tests use an in-memory SQLite implementation of D1 and a stub provider; they require Node 26.12.1+ and make no external requests:

```sh
npm test --prefix api
```

GitHub Pages cannot host Worker secrets or D1. Validate the deployed `/health`, CORS preflight and `/api/config` before making the entry form live. A successful API receipt means the message is queued; it does not prove inbox delivery. Production integration requires a real verified sender, sufficient provider quotas and a confirmed Cloudflare deployment. These are separate from passing local tests.

## Email, reporting and recovery

Encrypted D1 outbox payloads contain the immutable message, including any one-time link; the token table stores only SHA-256 hashes. AES-GCM authenticates each payload to its job ID. Sent/expired unattempted payloads are erased. Admin/entry link creation queues the token and email in one D1 transaction. Winner publication inserts ID-only jobs with deterministic `winner:<draw UUID>:<entry UUID>` keys in the same transaction as publication. The dispatcher reads the locked entry and freezes/encrypts its winner message before the first send. All retries use that exact stored payload. Privacy erasure suppresses an unsent winner job.

Each job uses a canonical stable ID as its Resend idempotency key. A database compare-and-set lease prevents concurrent workers from sending the same job. Network, conflict, rate-limit and server errors retry with bounded exponential backoff; a crash after provider acceptance reuses the same key. Retries stop after 23 hours from the first attempt, before Resend's 24-hour deduplication window ends; uncertain messages become `needs_review`. Do not blindly reset them or change their idempotency key. Reconcile provider records before any manual resend. `sent` means **provider accepted**, not delivered, and there is no delivery-webhook integration in this release.

The every-minute cron drains up to 10 messages per invocation, with a 20-second processing budget and bounded provider deadlines. Expiring admin/entry links take priority over reports and winner messages, so a winner backlog cannot consume their validity window. A full 2,000-group winner batch takes about 3 hours 20 minutes at that rate, longer if quota or provider errors intervene. Entry/admin link requests also attempt queued mail promptly in background; publishing delegates delivery to the cron to keep request work bounded. The admin outbox totals expose queued, sent, failed, suppressed, expired and needs-review counts. Review provider sending limits before publishing winners. A blocked email never rewrites committed drawing results.

Publication uses one SQL `INSERT … SELECT`, followed by the publication timestamp, in a [D1 atomic batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). It performs no per-winner encryption in that HTTP request. At most 10 winner messages are materialized by each dispatcher invocation. Local timing is not production CPU-limit verification; monitor the deployed workload. No paid Workers plan is assumed or enabled.

Monday at 16:00 UTC (10:00 a.m. MDT / 9:00 a.m. MST), the weekly cron queues a deduplicated activity report to Alonso. It reports new/total/verified groups and people, registration status, capacity and mail queue counts; it explicitly reports no sales or payments. It does not email entrant lists. Disable the weekly cron at the campaign's end; there is no implicit closing date or automatic draw.

Before a manual drawing: review eligible/pending counts, close entries, prepare once, inspect capacity/results, commit, then explicitly publish and queue winner emails. There is no background draw, auto-promotion or automatic admission based on an entry receipt.

## Privacy and operational limits

Only the entry owner's token and authorized admins can read personal entry data. CORS matches origins, not URL paths: every page under the GitHub account shares its origin. Do not add third-party scripts to token-handling pages. Bearer sessions prevent ambient cookie/CSRF authentication; no session secret is shipped in the static site.

For a confirmed erasure request, the admin DELETE route removes the entry before random preparation. After preparation it replaces name/email with anonymous placeholders, preserving group size and draw rank so other entrants' outcomes do not change. Both paths revoke entry tokens and suppress stored queued messages. Already accepted or in-flight email cannot be recalled, and provider retention is managed separately. Audit records retain the operator, entry ID and action without copying entrant names, email or request text. D1 backups require the provider's retention cycle; exported CSV files must be managed separately. After the event, the organizer should delete unnecessary personal records and exports.

Authentication, rate limits, bounded input, closed gates, safe ownership updates, token expiry/replay/concurrent consumption, unbiased random rank, whole-group capacity, immutable/atomic draw, private results, CSV injection, publication gating, privacy erasure, outbox leases/retry deduplication and a 2,000-winner batch are covered by the API tests. SQLite tests characterize D1 transactions locally; production D1/Resend operation still needs deployment verification.
