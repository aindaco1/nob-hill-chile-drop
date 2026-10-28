# Nob Hill Chile Drop

The website and free group drawing for New Year's Eve at Hotel Zazz in Nob Hill, Albuquerque. Jekyll/Liquid and native browser modules serve the public site; a Cloudflare Worker, D1 and Resend handle entries, organizer access and notifications. GitHub Pages hosts the static build.

**Future agents: start with [AGENTS.md](AGENTS.md), then [Project decisions and current state](docs/PROJECT.md).** These documents live with the code and should be updated with changes. Earlier meeting notes are background; the free-entry implementation supersedes the paid-entry proposal.

## Project links

| Resource | Location |
| --- | --- |
| Public website | [Nob Hill Chile Drop](https://aindaco1.github.io/nob-hill-chile-drop/) |
| Private entry access | [Manage your group](https://aindaco1.github.io/nob-hill-chile-drop/entry/) |
| Organizer access | [Organizer desk](https://aindaco1.github.io/nob-hill-chile-drop/admin/) |
| Source | [GitHub repository](https://github.com/aindaco1/nob-hill-chile-drop) |
| Deployment checks | [GitHub Actions](https://github.com/aindaco1/nob-hill-chile-drop/actions/workflows/pages.yml) |
| API health | [Worker health](https://nob-hill-chile-drop-api.jogo.workers.dev/health) |

The working project folder on Alonso's Mac is:

```text
/Users/aindaco1/Library/Mobile Documents/com~apple~CloudDocs/nob-hill-chile-drop
```

Inspect its Git status before editing. A chat's scratch directory or a validation clone is not automatically the current project checkout.

## Documentation map

| Read this | For |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Agent workflow, constraints and completion checklist |
| [Project](docs/PROJECT.md) | Confirmed event facts, product decisions, design direction, remaining work and dated verification |
| [Development](docs/DEVELOPMENT.md) | Setup, safe local testing, content changes and troubleshooting |
| [Architecture](docs/ARCHITECTURE.md) | File map, Platform reuse, data flow, database and security boundaries |
| [Drawing](docs/DRAWING.md) | Guest lifecycle, selection rules, organizer steps and privacy requests |
| [API](docs/API.md) | Routes, authentication, payloads, errors and rate limits |
| [Operations](docs/OPERATIONS.md) | Deployments, configuration, email recovery, rollback and launch checks |

## Start locally

Use Node **26.12.1** and Ruby **3.3** with Bundler to match CI. From the repository root:

```sh
git submodule update --init --recursive
bundle install
npm ci
npx playwright install chromium
npm run dev
```

Open [the local preview](http://127.0.0.1:4173/nob-hill-chile-drop/). `npm run dev` builds once; run `npm run build` after edits. Production CORS does not permit local form submissions. Use the mocked browser tests and isolated API tests described in [Development](docs/DEVELOPMENT.md).

```sh
npm test
npm run api:check
```

A push to `main` runs verification and deploys Pages. **It does not deploy the Worker or migrate D1.** Follow [Operations](docs/OPERATIONS.md) for service changes.

## Prompt for the next agent

> Work in the Nob Hill Chile Drop repository. Read AGENTS.md, docs/PROJECT.md and the task-relevant guides linked in README.md. Inspect the current checkout and relevant source before editing; recheck live state if the task concerns deployment or drawing operations. Preserve the free-entry, whole-group drawing rules and keep the implementation DRY and KISS. Implement the requested change, run the relevant checks, update affected documentation, and report exactly what was tested and deployed. Task: [describe the change].
