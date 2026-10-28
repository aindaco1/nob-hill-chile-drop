# Project guidance

- Keep Jekyll/Liquid, native browser modules and the small Worker. Prefer existing Platform helpers over duplicate infrastructure.
- Public facts belong in `_data/event.yml`; do not invent schedules, footage or access logistics.
- Keep the Platform submodule pinned. Never edit upstream source to patch a consumer issue.
- Drawing entries and selected admission are free. Group size must not increase random-rank weight. Keep whole groups and enforce the 2,000-person ceiling.
- Do not reroll or reset a prepared drawing, publish results, or change real entries without explicit organizer direction.
- Keep private data, tokens and provider keys out of logs, screenshots, fixtures, public builds and Git. Tests use isolated databases and a stub mail provider.
- Run `npm test` for application changes and `npm run api:check` for Worker changes. Verify project-subpath assets and mobile layouts.
- Pages deployment is automatic on main. Worker deployment is separate; check migrations and bindings before updating it.
