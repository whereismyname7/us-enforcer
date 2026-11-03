# Story Readiness Gate

A Definition of Ready gate for user stories. It grades every story from **L0 to L4** and blocks "Ready for Dev" until the story reaches L4. Four event-driven services sit behind an API gateway, next to a Jira simulator, so everything runs in Docker with one command and nothing connects to real Jira.

The stories are about **Northline Shop**, the system from the [Lab2 repo](https://github.com/tahasalehhafez/Lab2). We check each story against Northline's own C4 containers, ADRs, OpenAPI contract and approved Change Requests.

| | |
|---|---|
| **Runtime** | Docker Desktop only. Node.js 20, Redpanda, Redis, nginx, PlantUML and k6 all run as containers. |
| **Days** | Day 0 Set up · Day 1 See the system · Day 2 Design the split · Day 3 Connect · Day 4 Scale and survive · Day 5 Modernise and govern |
| **OS** | Windows (PowerShell) · macOS (Terminal) |
| **Ports** | Jira simulator `9000`, API gateway `9001`. Nothing clashes with Lab2 (8000 to 8082, 6379, 9092). |

> Run **one block at a time**. Do not paste this whole file into a terminal.
> Every command below assumes your current folder is the repository folder (`us-enforcer`).
> Put **one command on each line**. Do not join lines with `&&`.

---

## Table of contents

1. [Repository layout](#repository-layout)
2. [Security rule](#security-rule-we-never-break)
3. [How to read the commands](#how-to-read-the-commands)
4. [Day 0: Set up](#day-0-set-up)
5. [Day 1: See the system](#day-1-see-the-system)
6. [Day 2: Design the split](#day-2-design-the-split)
7. [Day 3: Connect](#day-3-connect-walk-one-story-through-the-system)
8. [Day 4: Scale and survive](#day-4-scale-and-survive)
9. [Day 5: Modernise and govern](#day-5-modernise-and-govern)
10. [Clean up](#clean-up)
11. [Friday checklist](#friday-checklist)

---

## Repository layout

| Path | Purpose | Day |
|------|---------|-----|
| `docker-compose.yml` | Starts the whole system, plus the tools `smoke`, `fitness`, `k6` and `diagrams` | 0–5 |
| `api/` | Contracts: the gateway API, the simulator API and the two event schemas. The only files services share. | 3 |
| `architecture/` | The **target** system our stories are checked against (Northline, copied from Lab2) | 1–2 |
| `docs/` | **Our** architecture: C4 diagrams, the nine course documents, ADRs and the SLO | 1–5 |
| `gateway/` | The nginx API gateway; `routes/` holds the webhook route Day 5 pauses | 3, 5 |
| `simulator/jira-sim/` | Our stand-in for Jira: stories, CRs, links, webhooks, the L4 gate, the board | 3 |
| `services/intake/` | Signed webhooks in, `StoryChanged` out (the anti-corruption layer) | 3, 5 |
| `services/rules/` | Template, acceptance criteria, wording, INVEST and CR checks | 2–4 |
| `services/impact/` | C4, ADR, CR impact, data owner, events, APIs and security checks | 2–3 |
| `services/reporter/` | Combines both results into a level, writes it to Jira; timeout, breaker, outbox | 3–4 |
| `samples/` | The sample CR and stories used below and by the smoke test | 3–5 |
| `tests/smoke/` | The end-to-end smoke test | 0 |
| `load/` | The k6 load test for the SLO | 4 |
| `fitness/` | Three automated architecture rules | 5 |

---

## Security rule we never break

No real password, key or token is ever written in a file here. Always use a placeholder such as `${WEBHOOK_SECRET}`, or a value that starts with `dev-only-` for local runs.

```text
WEBHOOK_SECRET=${WEBHOOK_SECRET}
```

Without a `.env` file, the `dev-only-...` defaults in `docker-compose.yml` are used. `.env` is git-ignored. `fitness/no-secrets.js` fails the build if a real-looking secret appears in any file.

---

## How to read the commands

| Label | Use this if… |
|-------|----------------|
| **Windows** | You are on Windows. Use **PowerShell**, and type `curl.exe` wherever this guide says `curl`. PowerShell's own `curl` is a different command. |
| **macOS** | You are on a Mac. Use **Terminal** as written. |
| **Both** | The same Docker command works on Windows and macOS. |

Everything runs in Docker. The only tools on your laptop are Docker Desktop, git and curl.

Wait until Docker Desktop shows **Engine running** before any `docker` command. `docker version` must print both a **Client** and a **Server** section.

---

## Day 0: Set up

Install Docker Desktop exactly as in Lab2 (sections 0.1 to 0.3), then:

```bash
git clone https://github.com/<your-account>/us-enforcer.git
cd us-enforcer
docker compose up -d --build --wait
docker compose ps
docker compose run --rm smoke
```

**Expect:** 8 containers `running (healthy)`: redpanda, redis, jira-sim, gateway, intake, rules, impact, reporter. The smoke test prints 14 `PASS` lines and `ALL 14 STEPS PASSED`.

---

## Day 1: See the system

```bash
docker compose run --rm diagrams
```

Then open the pictures. Windows: `Invoke-Item docs\context.png`. macOS: `open docs/context.png`. Do the same for `docs/containers.png` and `architecture/containers.png`.

**Expect:** our C1 and C2 diagrams, and the Northline C2 diagram our stories are checked against. Read `docs/adr/adr-001-each-service-owns-its-config.md` and `docs/stakeholders.md`.

---

## Day 2: Design the split

```bash
docker compose run --rm --no-deps rules npm test
docker compose run --rm --no-deps impact npm test
docker compose run --rm --no-deps reporter npm test
```

**Expect:** every test passes. The checks are pure functions, so each service can be tested with nothing else running. Read `docs/context-map.md` and `docs/decomposition-plan.md`.

---

## Day 3: Connect: walk one story through the system

3.1 Start clean and create the approved CR:

```bash
curl -X POST http://localhost:9000/admin/reset
curl -X POST http://localhost:9000/rest/api/3/issue -H "Content-Type: application/json" --data-binary "@samples/crs/CR-12.json"
```

**Expect:** `{"id":"...","key":"CR-12",...}`

3.2 The BA writes a weak story and links it to the CR:

```bash
curl -X POST http://localhost:9000/rest/api/3/issue -H "Content-Type: application/json" --data-binary "@samples/stories/reserve-stock-v1.json"
curl -X POST http://localhost:9000/rest/api/3/issueLink -H "Content-Type: application/json" --data-binary "@samples/link-NORTH-1-CR-12.json"
```

3.3 See the grade. Wait a few seconds, then:

```bash
curl http://localhost:9000/rest/api/3/issue/NORTH-1
curl -H "X-Api-Key: dev-only-api-key" http://localhost:9001/v1/stories/NORTH-1/readiness
docker compose logs --tail 20 intake rules impact reporter
```

**Expect:** `"level":1` and a comment listing 8 blocking items. The logs show `published`, then `checked` twice, then `graded`, all with the same `story_key`.

3.4 The gate blocks it:

```bash
curl -i -X POST http://localhost:9000/rest/api/3/issue/NORTH-1/transitions -H "Content-Type: application/json" --data-binary "@samples/transition-ready.json"
```

**Expect:** `HTTP/1.1 400` and `This story is not ready for development.`

3.5 Fix the CR, then the story:

```bash
curl -X PUT http://localhost:9000/rest/api/3/issue/CR-12 -H "Content-Type: application/json" --data-binary "@samples/crs/CR-12-update.json"
curl -X PUT http://localhost:9000/rest/api/3/issue/NORTH-1 -H "Content-Type: application/json" --data-binary "@samples/stories/reserve-stock-v2.json"
curl http://localhost:9000/rest/api/3/issue/NORTH-1
```

**Expect:** `"state":"Pending"` straight after the edit, then `"level":4` a few seconds later, with one warning, `Needs security review: payment`.

3.6 The gate lets it through, and developers see it:

```bash
curl -i -X POST http://localhost:9000/rest/api/3/issue/NORTH-1/transitions -H "Content-Type: application/json" --data-binary "@samples/transition-ready.json"
curl http://localhost:9000/board
```

**Expect:** `HTTP/1.1 204`, and the board lists `NORTH-1`.

3.7 Scope creep moves it back:

```bash
curl -X PUT http://localhost:9000/rest/api/3/issue/NORTH-1 -H "Content-Type: application/json" --data-binary "@samples/stories/reserve-stock-v3.json"
curl http://localhost:9000/rest/api/3/issue/NORTH-1
curl http://localhost:9000/board
```

**Expect:** `"level":3`, `"discount" is out of scope for CR-12`, the status back to `Refinement`, and an empty board.

3.8 Catch-up: a stopped consumer misses nothing.

```bash
docker compose stop impact
curl -X POST http://localhost:9000/rest/api/3/issue -H "Content-Type: application/json" --data-binary "@samples/stories/gift-wrap.json"
curl http://localhost:9000/rest/api/3/issue/NORTH-2
docker compose start impact
docker compose logs --tail 10 impact
curl http://localhost:9000/rest/api/3/issue/NORTH-2
```

**Expect:** `"state":"Pending"` while Impact is stopped. After the start, Impact logs `checked` for NORTH-2 and the story shows `"level":2` (no CR linked).

---

## Day 4: Scale and survive

4.1 Three copies of Rules, then a burst of 100 stories:

```bash
docker compose up -d --scale rules=3 --wait
docker compose ps
docker compose run --rm k6
```

**Expect:** three `rules` rows. k6 ends with every threshold passing, including `graded_within_slo` at 95% or more.

4.2 Liveness versus readiness:

```bash
curl -i http://localhost:9001/v1/status/reporter
docker compose stop redis
curl -i http://localhost:9001/v1/status/reporter
docker compose start redis
curl -i http://localhost:9001/v1/status/reporter
```

**Expect:** 200, then `503` with `"reason":"redis_not_connected"`, then 200 again.

4.3 Timeout, circuit breaker and outbox. Jira fails for our bot only:

```bash
curl -X POST http://localhost:9000/admin/chaos -H "Content-Type: application/json" --data-binary "@samples/chaos-on.json"
curl -X POST -H "X-Api-Key: dev-only-api-key" http://localhost:9001/v1/stories/NORTH-2/recheck
curl -X POST -H "X-Api-Key: dev-only-api-key" http://localhost:9001/v1/stories/NORTH-2/recheck
curl -X POST -H "X-Api-Key: dev-only-api-key" http://localhost:9001/v1/stories/NORTH-2/recheck
docker compose logs --tail 15 reporter
curl -X POST http://localhost:9000/admin/chaos -H "Content-Type: application/json" --data-binary "@samples/chaos-off.json"
docker compose logs --tail 5 reporter
```

**Expect:** `jira_write_failed`, `outbox_saved`, then `breaker_opened` after 3 failures. Once chaos is off and the cooldown has passed (about 10 s), `outbox_flushed` appears and NORTH-2's `checked_at` is new.

4.4 Read `docs/slo/readiness-slo.md`: the SLI, the 95% target, the error budget and the stop rule.

---

## Day 5: Modernise and govern

5.1 The gateway is the only door:

```bash
curl -i http://localhost:9001/health
curl -i http://localhost:9001/nope
curl -i http://localhost:9001/v1/stories/NORTH-1/readiness
```

**Expect:** every answer has `X-Request-Id` and `X-Readiness-Route`. Then `404 route_not_found` as JSON, then `401 invalid_api_key`.

5.2 Pause validation with one reload, then resume. In `gateway/routes/webhook-route.conf`, comment out the 4 LIVE lines and uncomment the 3 PAUSED lines. Then:

```bash
docker compose exec gateway nginx -t
docker compose exec gateway nginx -s reload
curl -X POST http://localhost:9000/rest/api/3/issue -H "Content-Type: application/json" --data-binary "@samples/stories/paused-demo.json"
docker compose logs --tail 5 jira-sim
curl http://localhost:9000/rest/api/3/issue/NORTH-3
```

**Expect:** `nginx -t` says the config is ok. The simulator logs `webhook_failed` with status 503, and NORTH-3 stays `Pending`, so the gate stays closed (fail closed). Then put the 4 LIVE lines back, comment out the PAUSED lines, and run:

```bash
docker compose exec gateway nginx -t
docker compose exec gateway nginx -s reload
curl -X POST -H "X-Api-Key: dev-only-api-key" http://localhost:9001/v1/stories/NORTH-3/recheck
curl http://localhost:9000/rest/api/3/issue/NORTH-3
```

**Expect:** NORTH-3 graded, `"level":2`.

5.3 Fitness functions: fail, fix, pass.

```bash
docker compose run --rm fitness
```

Read the exit code straight away. Windows: `echo $LASTEXITCODE`. macOS: `echo $?`. **Expect:** `0`. Then add this line to the top of `services/rules/consumer.js`:

```js
const peek = require("../impact/checks/containers");
```

Run fitness again (expect FAIL, exit code `1`), remove the line, and run it once more (expect PASS, exit code `0`).

---

## Clean up

```bash
docker compose down
```

---

## Friday checklist

- [ ] `docs/context.puml`, `docs/context.png`, `docs/context.md` (doc 01)
- [ ] `docs/stakeholders.md` (doc 02)
- [ ] `docs/adr/adr-001` to `adr-009` (doc 03)
- [ ] `docs/context-map.md` (doc 04) and `docs/decomposition-plan.md` (doc 05)
- [ ] `api/openapi.yaml` and `docs/api-contract.md` (doc 06)
- [ ] `api/events/*` and `docs/event-catalogue.md` (doc 07)
- [ ] `docs/slo/readiness-slo.md` (doc 08)
- [ ] `docs/review-scorecard.md` (doc 09), `docs/slice-one-plan.md`, `docs/ai-readiness.md`
- [ ] Smoke test: 14 steps pass
- [ ] Three rules copies, k6 meets the SLO
- [ ] The gateway pauses and resumes in one reload
- [ ] `docker compose run --rm fitness` exits `0`
