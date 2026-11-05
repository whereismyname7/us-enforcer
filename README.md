# Story Readiness Gate

A Definition of Ready gate for Jira. It grades every story L0 to L4 against the team's own architecture and blocks "Ready for Dev" until L4. This is a **proof of concept** on a Jira simulator.

```text
Jira ──webhook──> Gateway ──> Intake ──StoryChanged──> Checker ──StoryChecked──> Reporter ──level + comment──> Jira
```

A saved story becomes Pending, gets checked, and gets a level plus a comment saying what is missing. The gate reads only the stored level, so it stays closed if our services are down. A story that drops below L4 moves back to Refinement.

| Level | Checks |
|-------|--------|
| **L1** Draft | `[Area]` title; As a / I want / So that |
| **L2** Defined | Given/When/Then; a negative case; no vague words or TBD |
| **L3** Refined | CR linked; containers found; follows the target's ADRs |
| **L4** Dev-ready | CR approved; in scope; impact declared; data owner named |

L0 means an L1 check fails. Rules live in [`rules.yaml`](services/checker/rules.yaml).

## Run it

```bash
docker compose up -d --build --wait
```

```bash
docker compose run --rm demo
```

| Port | What |
|------|------|
| 9000 | Jira simulator |
| 9001 | API gateway (`X-Api-Key: dev-only-api-key`) |
| 9002 | Swagger UI |
| 9003 | Case viewer: every story and CR, with buttons to complete or break a story |

```bash
docker compose run --rm fitness
```

```bash
docker compose run --rm k6
```

## Architecture

![Containers](docs/containers.png)

Intake is the only service that knows Jira's field names, Checker never calls Jira, and Reporter is the only writer to Jira. See the [context map](docs/context-map.md), the [ADRs](docs/adr), the [API contract](api/openapi.yaml), the [SLO](docs/slo/readiness-slo.md) and the [fitness function](fitness/service-boundaries.js).

## What a full version adds

Real Jira through a Forge app, durable state, signed webhooks, audited overrides, richer checks, AI as an advisor only, and a pilot that measures stories bounced back by developers.
