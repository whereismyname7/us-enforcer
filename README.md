# Story Readiness Gate

**A Definition of Ready gate for Jira, checked against your own architecture.** It grades every user story L0 to L4 and blocks "Ready for Dev" until it reaches L4, so bad stories are caught when they are written, not mid-sprint.

This repository is a **proof of concept**. It shows the idea and the architecture on a Jira simulator. See [What a full version adds](#what-a-full-version-adds).

## The problem

Stories reach the sprint half-ready: acceptance criteria say "fast" or "TBD", nobody knows which services are touched, stories break architecture decisions, and scope creeps past what the Change Request (CR) approved. Developers find out mid-sprint and send them back. Existing story checkers look at the text only. They don't know your architecture.

## How it works

```text
Jira ──webhook──> Gateway ──> Intake ──StoryChanged──> Checker ──StoryChecked──> Reporter ──level + comment──> Jira
```

1. A BA saves a story. It becomes **Pending**, and saving is always allowed.
2. **Intake** reads the story and its CR, translates Jira's fields and publishes `StoryChanged`.
3. **Checker** runs the checks and publishes `StoryChecked`. It never calls Jira.
4. **Reporter** computes the level and writes it to Jira with a comment listing what is missing.
5. **The gate** allows "Ready for Dev" only at L4. It reads the stored level, so it stays closed if our services are down.
6. Any edit resets the story to Pending. A story that drops below L4 moves back to Refinement.

| Level | Meaning | Checks |
|-------|---------|--------|
| **L1** Draft | Has the shape of a story | `[Area]` title; As a / I want / So that |
| **L2** Defined | Can be tested | Given/When/Then; a negative case; no vague words or TBD |
| **L3** Refined | Impact is known and allowed | CR linked; containers found; no conflict with the target's ADRs |
| **L4** Dev-ready | Can enter a sprint | CR approved; nothing out of scope; impact declared by the CR; data owner named |

A story is L0 if an L1 check fails. Rules live in [`rules.yaml`](services/checker/rules.yaml), so adding a word or an ADR rule is a config change. The target system is Northline Shop, described by `rules.yaml` and [`target-containers.puml`](services/checker/target-containers.puml).

## Run it

You need Docker Desktop.

```bash
docker compose up -d --build --wait
```

```bash
docker compose run --rm demo
```

The demo walks one story through the whole flow: weak story at L1, gate refuses it, story fixed to L4, gate opens, scope creep drops it to L3 and it moves back. It prints the comments a BA would see and ends with `DEMO PASSED`.

To try it by hand, run `docker compose up -d swagger` and open http://localhost:9002.

| Port | Service |
|------|---------|
| 9000 | Jira simulator |
| 9001 | API gateway (`X-Api-Key: dev-only-api-key`) |
| 9002 | Swagger UI (optional) |

```bash
docker compose run --rm fitness
```

```bash
docker compose run --rm k6
```

To see events catch up, run `docker compose stop checker`, save a story (it stays Pending and the gate stays closed), then run `docker compose start checker` and it gets graded within about 30 seconds.

## Architecture

![Containers](docs/containers.png)

| Container | Role |
|-----------|------|
| **Gateway** (nginx) | The only door in: routes and API key |
| **Intake** | Anti-corruption layer: Jira's field names stop here |
| **Checker** | Checks a story against the rules and the target architecture |
| **Reporter** | Computes the level; the only writer to Jira |
| **Redpanda** | The event log between services |
| **jira-sim** | Stand-in for Jira, including the gate and the board |

| Course topic | Where it is |
|--------------|-------------|
| C4 context and containers | [`docs/context.puml`](docs/context.puml), [`docs/containers.puml`](docs/containers.puml) |
| Bounded contexts | [`docs/context-map.md`](docs/context-map.md) |
| ADRs | [Events](docs/adr/adr-001-services-talk-through-events.md), [async validation and the gate](docs/adr/adr-002-validate-async-enforce-at-gate.md), [anti-corruption layer](docs/adr/adr-003-intake-is-the-anti-corruption-layer.md) |
| API contract | [`api/openapi.yaml`](api/openapi.yaml) |
| Events, idempotency, catch-up | [`services/`](services), consumer groups and `event_id` |
| API gateway | [`gateway/nginx.conf`](gateway/nginx.conf) |
| SLO and load test | [`docs/slo/readiness-slo.md`](docs/slo/readiness-slo.md), [`load/story-burst.js`](load/story-burst.js) |
| Fitness function | [`fitness/service-boundaries.js`](fitness/service-boundaries.js) |

## What a full version adds

Left out on purpose, to keep the proof of concept small:

- **Real Jira:** a thin Forge app with a readiness field and a workflow validator. The checks do not change (ADR-003).
- **Durable state and resilience:** store grades in a database, sign webhooks, add a circuit breaker and an outbox for Jira outages.
- **Audited overrides:** architects can bypass the gate with a recorded reason.
- **Richer checks:** OpenAPI paths, INVEST, security review labels, re-reading ADRs directly.
- **AI as advisor:** warnings for scope creep by meaning, never deciding the level (ADR-002).
- **Pilot:** measure stories bounced back by developers, before and after. The benefits are unproven until then.
