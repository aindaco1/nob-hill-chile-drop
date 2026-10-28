# Nob Hill Chile Drop

New Year's Eve at Hotel Zazz in Nob Hill, Albuquerque. The chile drops at midnight Mountain Time, welcoming January 1, 2027.

- Website: https://aindaco1.github.io/nob-hill-chile-drop/
- Organizer desk: https://aindaco1.github.io/nob-hill-chile-drop/admin/
- API: https://nob-hill-chile-drop-api.jogo.workers.dev

The public site uses ZEMA Landing's Jekyll/Liquid structure and a pinned Dust Wave Platform submodule. A small Cloudflare Worker/D1 service handles the free drawing. GitHub Pages hosts only public static files. No payment information is collected.

## Local development

Use Node 26.12.1+, Ruby with Bundler, and the pinned submodule:

```sh
git submodule update --init --recursive
bundle install
npm ci
npx playwright install chromium
npm run dev
```

Open http://127.0.0.1:4173/nob-hill-chile-drop/. The remote API only accepts the production Pages origin; browser tests mock the API. To develop the full service locally, use a separate local D1 database and test email configuration as described in [the drawing guide](docs/DRAWING.md). Do not point test fixtures at production email.

```sh
npm test
npm run api:check
```

## Content and design

Edit `_data/event.yml` for public event information and `_config.yml` for hosting configuration. Times are explicit Mountain Time, not the visitor's local time. Fonts are self-hosted Barlow Condensed and DM Sans under their OFL licenses; build preparation copies the license files alongside them. The original SVG chile illustration and navy, lime, red, cream and blue palette take inspiration from the event's Instagram neon sign. No Instagram photos or old event details were copied.

Add an approved YouTube ID to `film.youtube_id` when footage is ready. The footage section stays hidden until a video is supplied; its player loads only on a visitor's click. Parking, accessible routes and the public viewing map remain unconfirmed. Set `preview: false` when the final public launch should be indexed. No custom domain is configured.

## Drawing operations

Free entries start open. Each verified email holds one whole group, with no extra entries for a larger group. The initial capacity is 2,000 people. Selection follows a fixed, uniformly random order and stops before the next whole group would exceed capacity; unused spaces are possible. Equal random rank does not mean identical admission probability for differently sized groups.

Sign in at `/admin/` using `alonso@dustwave.xyz`. Close registration manually, prepare the random order once, review totals, commit, then publish and queue winner notifications. The drawing never runs automatically. Weekly activity reports go to the same address on Mondays at 16:00 UTC. Public results show only counts; guests use their private email link for their own status.

See [docs/DRAWING.md](docs/DRAWING.md) for API contracts, mail retries, privacy requests, selection details and deployment commands. Store RSVP was reviewed: it immediately confirms admission, so its consumer-specific RSVP workflow is not used for unselected drawing entries. Shared Platform primitives are reused directly.

## Deployment

Push to `main` to run tests and deploy GitHub Pages through `.github/workflows/pages.yml`. API changes are deployed separately after tests:

```sh
npm run api:check
npm --prefix api run migrate:remote
npm --prefix api run deploy
```

Authenticate Wrangler to the configured Cloudflare account before these commands. Secrets live in Cloudflare, never Pages or Git. The existing database must not be recreated. Disable the weekly report cron when the campaign ends. Do not rotate the outbox encryption key while encrypted messages are pending.

## Source provenance

- ZEMA Landing starting structure: `ea02ebc8594569cdeee35a3c959c8196479ea911`.
- Dust Wave Platform: v0.44.0, `ad2be4580fc05978e7d8d05c93c3038c13e09876`; package pins in `platform.json`.
- Shared modules: site navigation, layout mixins, asset minification, browser rendering checks, admin API client, request validation, cryptography, email preparation and outbox/provider helpers.
- Visual reference: https://www.instagram.com/nobhillchiledrop/
- Information structure reference: https://onetimessquare.com/nye-ball

The free-entry implementation supersedes the earlier paid-entry proposal. Ticket scanning, automatic waitlist promotion and hotel wristbands are outside this release.
