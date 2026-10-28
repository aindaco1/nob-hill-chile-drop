# Deployment and operations

[Documentation index](../README.md) · [Organizer workflow](DRAWING.md) · [Current verified snapshot](PROJECT.md)

## Services and configuration

| Service | Current identity / source |
| --- | --- |
| Static host | GitHub Pages, repository `aindaco1/nob-hill-chile-drop`, branch `main`, Actions deployment |
| Public URL | `https://aindaco1.github.io/nob-hill-chile-drop/` |
| Worker | `nob-hill-chile-drop-api`, `https://nob-hill-chile-drop-api.jogo.workers.dev` |
| Cloudflare account | `fee6147787ab9025e9fd8e6e8fd76910` in `api/wrangler.toml` |
| D1 | `nob-hill-chile-drop`, binding `DB`, ID `7afb3b21-843c-4967-bda4-edc5272e9a3c` |
| Email | Resend; sender `Nob Hill Chile Drop <events@dustwave.xyz>` |
| Platform | Git submodule and `platform.json`; upgrade intentionally, not during deployment |

Resource IDs and URLs are identifiers, not secrets. Recheck the live account/bindings before remote operations.

| Configuration | Purpose |
| --- | --- |
| `_config.yml`: `url`, `baseurl` | Static canonical origin and project path |
| `_config.yml`: `api_base` | Worker URL used by browser modules |
| `_config.yml`: `asset_version` | Public CSS/JS cache invalidation value |
| `_config.yml`: `preview` | Indexing flag; true currently emits noindex |
| Worker `ALLOWED_ORIGINS` | Comma-separated exact origins; currently only `https://aindaco1.github.io` |
| Worker `PUBLIC_SITE_URL` | Full public base including project path; used in emailed links |
| Worker `ADMIN_EMAILS` | Comma-separated organizer allowlist; currently `alonso@dustwave.xyz` |
| Worker `REPORT_EMAIL` | Weekly report destination and reply-to; currently the same organizer |
| Worker `EMAIL_FROM` | Verified sender identity |
| Secret `RESEND_API_KEY` | Provider credential; never in Git/Pages |
| Secret `OUTBOX_ENCRYPTION_KEY` | 32 random bytes as unpadded base64url (43 characters); encrypts queued private payloads |

Secrets are installed in Cloudflare. Retrieve/manage them only through the organizer's approved private credential workflow. Do not print them, copy them into a public issue, or publish a backup in this repository. Ignored local files are not a substitute for secure storage. Do not rotate the outbox key while encrypted jobs require it; rotation needs a migration/recovery plan. The key also salts rate-limit hashes.

## Read-only smoke checks

These do not register entrants or send email:

```sh
curl --fail --silent https://nob-hill-chile-drop-api.jogo.workers.dev/health
curl --fail --silent https://nob-hill-chile-drop-api.jogo.workers.dev/api/config
curl --fail --silent --head https://aindaco1.github.io/nob-hill-chile-drop/
```

Health reads D1 settings and validates the shape/presence of mail configuration. It does not send through Resend. Public config reports effective registration, capacity/lock state and published counts, not a private guest list. Refresh it instead of relying on a dated screenshot.

For CORS, inspect a read-only config response with `Origin: https://aindaco1.github.io`, or an OPTIONS preflight. The allow-origin response must match exactly. Check live Pages HTML/assets separately from API health. To establish real organizer access or email delivery, use an explicitly authorized controlled check and record what was observed; do not infer it from a passing build or health response.

## Release the static site

1. Inspect the diff and run checks required by [AGENTS.md](../AGENTS.md). For application changes, `npm test`; for API changes, also `npm run api:check`.
2. Commit the reviewed change and push the intended branch. Pushing `main` runs [the Pages workflow](../.github/workflows/pages.yml); pull requests run verification without deployment. Follow the current user's requested release scope.
3. Check that **the exact pushed commit** passed verification and Pages deployment in [Actions](https://github.com/aindaco1/nob-hill-chile-drop/actions/workflows/pages.yml). A successful earlier run is not evidence for this release.
4. Inspect the live page and changed assets under `/nob-hill-chile-drop/`; verify important links, responsive layout and no unexpected indexing change. Allow for CDN propagation; use a fresh reload when inspecting cached assets.

CI uses Node 26.12.1, Ruby 3.3, recursive submodules, locked dependencies, Chromium tests, the full `npm test` and Worker dry-run checks. It uploads `_site` only after verification. Documentation, backend source, dependencies and tests are excluded by Jekyll configuration. **CI does not deploy the Worker or migrate D1.** A docs-only main push also runs the full pipeline.

## Release the Worker or schema

These commands can change production. Use them only for an authorized service release, from the reviewed checkout and correct authenticated Cloudflare account.

1. Review `api/wrangler.toml` and pending migrations. Keep the existing production D1 identity. Never create a replacement database as a routine deploy step.
2. Run isolated tests and a dry run:

```sh
npm --prefix api test
npm run api:check
```

3. For schema changes, create a **new** migration; do not edit an already-applied migration. Review its effect on entries, fixed ranks, mail jobs and rollback compatibility. Test on local D1. The current in-memory test helper loads `0001_drawing.sql` directly, so extend it to apply subsequent migrations when adding one.
4. Before a remote migration, arrange a private database backup/recovery point. `wrangler d1 export` can produce a full SQL export; consult `npx wrangler d1 export --help` for the installed version and choose protected storage outside the repo/public artifacts. An export contains personal data, token hashes and encrypted mail; treat it accordingly. Check recovery procedures before a destructive migration.
5. Apply pending reviewed migrations **only if needed**, then deploy:

```sh
npm --prefix api run migrate:remote
npm --prefix api run deploy
```

6. Record the returned Worker version ID. Inspect live bindings, secret **names**, traffic deployment and schedules. Run health/config probes and the task-specific read-only checks. Keep browser/API changes backward compatible across the independent releases.

The dry run bundles code only. Migration success does not deploy new code; a successful upload does not prove the browser is using it, cron is configured, or mail is delivered.

## Email queue and recovery

Implementation: [`api/src/mail.js`](../api/src/mail.js). Creation of verification/login tokens and their encrypted mail jobs is batched. Entry/login requests schedule a prompt background send attempt; winner publication only queues IDs, with delivery performed by cron. Winner jobs freeze their encrypted payload before the first provider request and reuse it on retries.

Jobs use stable IDs as Resend idempotency keys, including `winner:<preview UUID>:<entry UUID>`. A database lease prevents concurrent dispatchers from taking the same job. Dispatch runs every minute, handles at most 10 jobs per invocation within a 20-second budget, and prioritizes admin/entry links before reports and winners. A large winner batch may take hours to drain; publication is not immediate bulk delivery.

Review current provider quotas and Worker execution limits before a large publication. The 2,000-winner test uses local SQLite and stub email; it does not establish production throughput or delivery capacity. No paid-plan upgrade is assumed by the implementation.

| Outbox state | Interpretation / action |
| --- | --- |
| `queued` | Waiting for a due attempt/retry; inspect schedules and sanitized failure evidence if stuck |
| `sending` | Leased to a dispatcher; allow the two-minute lease to expire before diagnosing a stalled attempt |
| `sent` | Resend returned a provider message ID; encrypted payload was cleared. This means **accepted**, not delivered. |
| `failed` | Non-retryable provider failure; fix the cause and review safe recovery before requeueing |
| `needs_review` | An attempted job exceeded its expiry/retry window; acceptance may be uncertain. Reconcile with provider evidence. |
| `expired` | An unattempted job expired; its payload was cleared. An expired access link needs a new user-requested link. |
| `suppressed` | Erased/unavailable recipient; payload cleared. Do not revive it. |

Network errors, retryable provider responses and conflicts use bounded exponential retry delays. Attempts stop after 23 hours from the first attempt (or earlier job expiry). This stays within [Resend's documented 24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys), checked October 28, 2026; recheck provider behavior before changing retry policy.

When diagnosing a failure:

1. Inspect queue counts and sanitized `last_error` codes/stages. Do not dump encrypted payloads, recipient lists, tokens or raw exception causes into logs/chat.
2. Check the Worker version, sender/domain authorization, credential presence and provider response/message evidence privately. `emailConfigured: true` alone cannot validate credentials or delivery.
3. For `needs_review` or an uncertain HTTP outcome, reconcile by job idempotency key/provider ID before any resend. Do not reset `first_attempt_at`, invent a new key or replay outside the provider window to force success.
4. Any manual remediation must preserve the exact payload/key where applicable, respect privacy suppression, and have organizer direction for sending. There is no public retry/requeue endpoint or UI.

Provider requests are restricted in code to Resend's email endpoint with manual redirect handling. Failure evidence records fixed stages, safe exception names or HTTP status, never raw recipient/credential-bearing messages. No delivery/bounce webhook is implemented; consult Resend for downstream delivery status.

## Schedules and campaign close

[`api/wrangler.toml`](../api/wrangler.toml) declares two UTC cron triggers:

| Trigger | Job |
| --- | --- |
| `* * * * *` | Outbox dispatch and expired token/rate-limit cleanup |
| `0 16 * * MON` | Queue a deduplicated weekly activity report, then dispatch/cleanup |

The report goes at 9 a.m. MST / 10 a.m. MDT. There are no automatic registration close, drawing or publication schedules. Do not simulate cron on production to test email behavior.

At the organizer-directed campaign end, remove the weekly report trigger and deploy/verify the schedule change. Keep dispatch active until remaining authorized mail is resolved. Decide and implement retention separately: the service has no automatic whole-campaign deletion or archive policy.

## Rollback and incidents

- **Static regression:** revert the specific faulty commit on the intended release branch and let Pages redeploy. Preserve unrelated work; do not reset shared history. Verify the new workflow/live assets.
- **Worker regression:** identify a previously working version and its schema/secret compatibility. `npx wrangler rollback --help` describes rollback for the installed CLI; target `api/wrangler.toml` and the verified version for an authorized rollback. Then check traffic, health/config and schedules again.
- **Database or drawing incident:** code rollback does not undo a migration, result publication, email acceptance or real entries. Preserve evidence and the fixed random order. Do not restore a stale database blindly: it may discard entries or replay mail. Plan a forward fix or controlled recovery with the organizer.
- **Leaked credential/token:** prevent further exposure, use private incident handling, and distinguish provider-key revocation from outbox-key rotation. Existing browser sign-out does not revoke a server token. Removing an organizer from the live allowlist blocks their existing sessions on subsequent requests.

## Launch or custom-domain cutover

Before final launch, resolve the outstanding organizer decisions in [Project](PROJECT.md), verify public facts/rules/privacy, and decide whether `preview` should become false. Noindex removal does not open registration; those are independent settings.

A domain move requires confirmed ownership/access, Pages domain/DNS/HTTPS configuration, `_config.yml` `url`/`baseurl`, Worker `PUBLIC_SITE_URL` and `ALLOWED_ORIGINS`, plus calendar URL generation, metadata, local-server/test subpaths and documentation. Audit hardcoded references. Preserve the old address or redirect behavior as needed for already-issued links; do not strand entry access. Test both origins and links during the transition, then remove obsolete allowances deliberately. No custom domain is currently configured.
