# Agent entry point

## Start here

1. Read [README.md](README.md) and [docs/PROJECT.md](docs/PROJECT.md). Follow the documentation map for the task; read [Drawing](docs/DRAWING.md) before changing entries or selection and [Operations](docs/OPERATIONS.md) before a release.
2. Inspect `git status --short`, the branch/HEAD, recent commits and the Platform submodule. Preserve unrelated changes. The canonical local folder is listed in README; do not assume an old scratch checkout is current.
3. Read the implementation named in [Architecture](docs/ARCHITECTURE.md). Dated documentation is a snapshot, not proof of today's production state. Refresh relevant live configuration before operational work.

## Implementation rules

- Keep Jekyll/Liquid, native browser modules and the small Worker. Prefer existing Platform helpers; avoid adding a framework or duplicate infrastructure for a local change.
- Keep `shared/dust-wave-platform` pinned with `platform.json`. Do not patch shared source inside this consumer. An intentional Platform upgrade must update the gitlink and manifest together and pass consumer-pin tests.
- Public event content starts in `_data/event.yml`. Some event details remain duplicated in the Worker, mail and calendar generator; use the cross-file checklist in [Development](docs/DEVELOPMENT.md). Do not invent logistics or footage.
- Preserve readable mobile layouts, the countdown between header and hero, above-the-fold hero at tested sizes, keyboard controls, reduced-motion behavior and the footer rules link. See [Project](docs/PROJECT.md) for current design decisions.
- Edit source, not `_site` or generated Platform/font/calendar assets. Keep subpath-safe Liquid URLs and the configured Pages base path.
- The drawing and selected admission are free. Each verified email holds one whole group; group size does not increase random-rank weight. Enforce the 2,000-person ceiling and stop at the first group that cannot fit. Do not silently change this algorithm or restore paid checkout.

## Production boundaries

- Routine coding, builds and tests use isolated data and stubbed email. Do not use real registration, login email or drawing endpoints as smoke tests.
- Do not close/reopen real registration, prepare/reroll/reset a drawing, commit/publish results, send guest messages or change/delete real entries without organizer direction for that action. A request to change the website alone does not authorize drawing operations.
- Never recreate the production D1 database or run fixture/seed/reset SQL against it. New schema changes use reviewed, additive migrations; read the backup and rollback guidance first.
- Keep entry data, tokens, CSV exports, credentials and mail payloads out of Git, logs, screenshots and public artifacts. Docs are excluded from Pages but remain public in this repository.
- Do not rotate the outbox encryption key with outstanding encrypted jobs. Do not reset uncertain mail jobs or change their idempotency keys to force a resend.

## Verify and finish

- Application changes: run `npm test`. Worker changes: also run `npm run api:check`. New behavior needs focused tests at the appropriate layer; do not add tests that only mirror prose or implementation.
- Layout changes: inspect desktop and mobile rendering, including 320×568 and 375×667, text enlargement, keyboard focus and reduced motion. Automated Chromium coverage does not establish Safari or physical-device behavior.
- Docs-only changes: check relative links, source paths, commands and consistency with current code. A normal main push still runs the full CI suite.
- Main deploys Pages automatically; Worker and D1 releases are separate. Verify the exact commit's workflow and relevant live result before claiming deployment. Do not treat a dry run as a release or provider acceptance as email delivery.
- Update the relevant guide in the same change. Keep event/product decisions in Project, procedures in Development/Operations, drawing behavior in Drawing and contracts in API. Update dated verification only after actually rechecking it.
- Handoff with the commit, changed behavior, checks performed, deployment status and remaining uncertainties. Do not put private operational evidence in public docs.
