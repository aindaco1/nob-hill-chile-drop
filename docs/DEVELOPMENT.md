# Development and validation

[Documentation index](../README.md) · [Source map](ARCHITECTURE.md) · [Release procedures](OPERATIONS.md)

All commands below run from the repository root unless stated otherwise. Shell examples assume macOS/Linux. Never substitute `--remote` into a local test command.

## Setup

Use Git with submodules, Node **26.12.1**, Ruby **3.3** and Bundler to match [CI](../.github/workflows/pages.yml). The API test harness uses `node:sqlite`; older Node versions are not the supported baseline. Dependencies are locked in `package-lock.json` and `Gemfile.lock`; use the lockfiles instead of updating packages as part of setup.

For a new checkout:

```sh
git clone --recurse-submodules https://github.com/aindaco1/nob-hill-chile-drop.git
cd nob-hill-chile-drop
bundle install
npm ci
npx playwright install chromium
```

For an existing checkout, inspect its changes, then initialize the pinned dependency if needed:

```sh
git status --short
git submodule update --init --recursive
git submodule status
```

No Cloudflare/Resend credentials are needed for the static build or automated tests. `api/package.json` has scripts but no separate dependency installation; tooling comes from the root install.

## Build and preview

```sh
npm run dev
```

Open [localhost](http://127.0.0.1:4173/nob-hill-chile-drop/). The root `/` is intentionally not the app. `dev` builds once and serves `_site` with no-store caching; it does not watch sources. In another terminal, run `npm run build` after an edit, then refresh. Stop the server with Ctrl-C.

`npm run build` prepares generated assets, runs Jekyll and minifies built CSS/JS. Do not invoke Jekyll alone on a fresh checkout: fonts, shared modules and `event.ics` must be prepared first. Files in `_site`, copied fonts/licenses, `assets/js/header-nav.js`, `assets/js/api-client.js` and `event.ics` are generated and ignored.

The default preview points at the production API. Browser API calls from localhost, including the config fetch, are blocked by production CORS, so entry remains unavailable. The public read-only routes can still be inspected with curl. This is expected. Do not add localhost to the production allowlist to make a test pass.

## Safe service testing

Use the API fixture for complete entry, authentication, drawing and mail flows:

```sh
npm --prefix api test
```

[`api/test/helpers.js`](../api/test/helpers.js) creates an in-memory SQLite database, fake clock and stub mail provider. It does not send email or use production D1. Add cases there for behavior changes; never replace the stub transport with production fetch/credentials.

For a local Workers-runtime check, apply the schema locally and explicitly disable email credentials:

```sh
npx wrangler d1 migrations apply nob-hill-chile-drop --local --config api/wrangler.toml
CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false npx wrangler dev \
  --config api/wrangler.toml --local --ip 127.0.0.1 --port 8787 \
  --var ALLOWED_ORIGINS:http://127.0.0.1:4173 \
  --var PUBLIC_SITE_URL:http://127.0.0.1:4173/nob-hill-chile-drop \
  --var RESEND_API_KEY: --var OUTBOX_ENCRYPTION_KEY:
```

Use a checkout without production `.dev.vars`/`.env` files. The explicit empty credential overrides are intentional. Wrangler persists local D1 under ignored `api/.wrangler/`; `--local` disables remote bindings. From a second terminal:

```sh
curl --fail --silent http://127.0.0.1:8787/health
curl --fail --silent http://127.0.0.1:8787/api/config
```

Expect `ok: true`, `emailConfigured: false` and effective `registrationOpen: false`. Mail readiness gates entry even though the initial database registration flag is open. This checks runtime/schema loading, not a working email flow. A local Worker with real email credentials can still send real messages; `--local` is not an outbound network sandbox.

To preview the browser against that local service, create an ignored Jekyll override:

```sh
mkdir -p work
cat > work/local.yml <<'YAML'
api_base: http://127.0.0.1:8787
YAML
node scripts/prepare-assets.mjs
bundle exec jekyll build --config _config.yml,work/local.yml
node scripts/serve.mjs
```

The form should remain closed in this mail-disabled mode. Stop any server already using port 4173 first, after checking it belongs to this checkout. `npm run build` restores the normal production API configuration. There is no standalone local inbox or full staging environment configured; the injected test fixture is the supported no-mail full-flow harness.

## Verification commands

| Command | What it establishes |
| --- | --- |
| `npm run test:content` | Event constraints, Platform pin, public-build exclusions |
| `npm --prefix api test` | Selection/auth/state/mail/privacy behavior against isolated SQLite and stub transport |
| `npm run build` | Source/assets compile to the static site |
| `npm run test:browser` | Playwright Chromium checks against the **existing** build; build first |
| `npm test` | Content tests, API tests, build, then browser tests |
| `npm run api:check` | Wrangler bundles the Worker into ignored `work/worker`; no deployment |

The baseline at application commit `3b45b14` contains 3 content tests, 23 API tests and 11 browser tests. Counts may change; passing assertions matter more than a fixed total. API coverage includes unbiased ranking, whole-group stopping, verification races, immutable preparation, idempotent publication, bounded mail retries, privacy erasure and CSV safety.

Browser coverage includes project-subpath assets, responsive overflow, the above-fold hero, mocked entry/admin flows, closed/error states, keyboard navigation, motion controls, axe checks, 200% text enlargement, midnight countdown behavior and no-JavaScript information access. The hero matrix includes 320×568, 375×667, 390×844, 768×1024, 1024×768, 1280×720, 1366×768 and 1440×900.

[`playwright.config.js`](../playwright.config.js) runs Chromium only, starts the static server, and can reuse a local server outside CI. Check that a reused server serves this checkout rather than stale `_site` content. Failed-test traces go under ignored test artifacts. Mocked tests do not establish actual email delivery, production storage or physical-device acceptance. Visually inspect layout changes on desktop/mobile; check Safari/WebKit separately when relevant.

## Editing content and assets

| Change | Files/checks |
| --- | --- |
| Copy, hours, venue, navigation, FAQ | `_data/event.yml`; inspect rendered page and rules/hours includes |
| New date/edition/venue | Also search `api/src/worker.js`, `api/src/mail.js`, `scripts/prepare-assets.mjs`, `_config.yml`, rules, tests and docs for old values |
| Drawing rules | Public rules/FAQ/form, Worker consent version and validation, algorithm/tests, API and Drawing guides must agree |
| Artwork | `assets/art/chile-sign.svg`; verify hero, mouse cursor and social card |
| Footage | Approved `film.youtube_id`; adjust the content test that currently asserts it is empty; verify click-to-load and consent/privacy wording |
| CSS/JS release | Bump `_config.yml` `asset_version` when needed to invalidate cached assets |
| Domain/API origin | Follow the coordinated cutover checklist in Operations |

Not all event facts are centralized yet: the API config and email text have hardcoded 2026/2027 details; the calendar generator hardcodes its UID, timestamp and public URL. The generated calendar marks the **one-minute midnight drop**, with opening/alcohol hours in its description. A date change must update all affected surfaces; editing YAML alone is insufficient.

Regenerate the committed social image after relevant art/headline/date changes:

```sh
node scripts/prepare-assets.mjs
npm run social:render
```

Review `assets/art/social-card.png` before committing it. Preserve font licenses and avoid importing unapproved Instagram photos.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Missing shared module/font | Initialize submodule, `npm ci`, then `npm run build` |
| `node:sqlite` import failure | Use the CI Node version |
| Bundler/Jekyll error | Check Ruby/Bundler and install the locked gems; do not broadly update dependencies to bypass setup |
| Browser install missing | `npx playwright install chromium`; Linux CI uses `--with-deps` |
| Old layout after editing | Rebuild; confirm server checkout and subpath; inspect asset version |
| Local entry CORS failure | Expected for production API; use mocks or the local API override above |
| `EADDRINUSE` on 4173/8787 | Identify the owning process; stop only the test server you own |
| iCloud read or npm `ETIMEDOUT` | Check whether files are offloaded (`dataless` in `ls -lO`). Download/keep the project locally or use a non-iCloud clone at the exact commit, carrying over reviewed uncommitted changes. Never interpret a partial copy as authoritative |

## Keeping the handbook current

Update docs in the same commit as the relevant behavior. Check Markdown links, command names, file paths, configuration keys and known limitations. Keep dated production observations in Project distinct from durable procedures; do not mark email delivery, private administration or deployment verified without evidence for that surface.
