# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A course proof of concept: a Definition of Ready gate that grades Jira stories L0 to L4 against a team's own architecture. The goal is to demonstrate the idea and an architecture aligned with the course, not a complete product. Keep it about the size and shape of the reference project, https://github.com/tahasalehhafez/Lab2 (about 40 files and 1,000 lines of JS). Prefer listing a feature under "What a full version adds" in the README over building it.

Node.js 20 (CommonJS), Redpanda, nginx, Docker Compose. There is no linter, unit test suite, CI or root `package.json`.

## Commands

Dependencies are only installed inside images.

```bash
docker compose up -d --build --wait      # start everything, including Swagger UI on http://localhost:9002
docker compose run --rm demo             # end-to-end story; wipes the simulator's data
docker compose run --rm fitness          # architecture rules
docker compose run --rm k6               # SLO load test; wipes the simulator's data
docker compose run --rm diagrams         # render docs/*.puml to PNG
docker compose up -d --build checker     # apply a change to one service
```

Source and `rules.yaml` are copied into the images, so a change needs `--build`. The demo is the test: run it after any change to the flow.

## Architecture

`jira-sim` sends a webhook through `gateway` to `intake`, which publishes `StoryChanged`. `checker` consumes it and publishes `StoryChecked`. `reporter` consumes that and writes the level and comment back to `jira-sim`.

Boundaries, enforced by `fitness/service-boundaries.js`:

- Only `intake` reads Jira's field names; events use snake_case.
- `checker` never calls Jira, so everything it needs must be in the event. A new story field touches `jira-sim`, `intake` and `checks.js`.
- Only `reporter` writes to Jira.
- Services share no code. Each has its own small Kafka setup on purpose.

Behaviour that is easy to break:

- **The gate** lives in `services/jira-sim/server.js` and reads only the stored `status`.
- **Two fields on a story:** `status` is readiness (`Pending`, `L0` to `L4`) and `workflowStatus` is the board column. On a CR, `status` is the CR's own status, such as `Approved`. The lookup list is `STATUSES` in `services/reporter/server.js`.
- **Stale grades:** `jira-sim` answers 409 when a grade's `story_updated_at` is not the story's current `updated`.
- **One comment per change:** `jira-sim` skips the comment when the level and missing list are unchanged.
- **Gateway addresses:** `gateway/nginx.conf` uses variables with `resolver` so names resolve per request. A static `upstream` keeps a stale IP after a restart and sends webhooks to the wrong service.
- **State is in memory:** restarting `jira-sim` empties it, and restarting `reporter` empties the readiness API.

`docs/` describes this system. The target system being checked (Northline Shop) is `services/checker/target-containers.puml` plus the second half of `rules.yaml`. Northline's ADR-001 and ADR-002 in `rules.yaml` are not our ADRs in `docs/adr/`.

## Making changes

- **A word or ADR rule:** edit `services/checker/rules.yaml`.
- **A check:** add it to `services/checker/checks.js`, and update the level table in the README if it changes what a level means. The demo asserts levels, so run it.
- **An event field:** a new optional field keeps `version: 1`. A removed or renamed field is a new version.
