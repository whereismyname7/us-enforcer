# Story Readiness Gate - API Contract

Owner: Platform Lead
Status: Accepted
Course doc: 06
Machine-readable contract: `api/openapi.yaml`
Gateway config: `gateway/templates/default.conf.template` and `gateway/routes/webhook-route.conf`

---

## 1. What it is for

The API gateway is the only door into the Story Readiness Gate (ADR-009).
Jira sends its webhooks through it, and people and scripts read a story's readiness through it.
It routes, checks the API key, applies rate limits, adds a request id and answers errors as JSON.
It holds no business rules.

| Method and path | Goes to | Success |
|-----------------|---------|---------|
| `GET /health` | the gateway itself | 200 `{"status":"ok","service":"gateway"}` |
| `POST /webhook` | Intake `/webhook` | 202 |
| `GET /v1/stories/{key}/readiness` | Reporter | 200, the grade |
| `POST /v1/stories/{key}/recheck` | Intake | 202 `{"published":1,"event_id":"..."}` |
| `GET /v1/status/intake` | Intake `/ready` | 200 `{"ready":true,...}` |
| `GET /v1/status/reporter` | Reporter `/ready` | 200 `{"ready":true,...}` |

`{key}` must match `^[A-Z][A-Z0-9]*-[0-9]+$`. Anything else is a 404 from the gateway.

## 2. Who may call it

| Caller | How they prove it | Paths |
|--------|-------------------|-------|
| Jira | `X-Hub-Signature: sha256=<hex>`, the HMAC-SHA256 of the exact body with the shared webhook secret. Intake checks it. | `POST /webhook` |
| People and scripts | `X-Api-Key`, compared by the gateway with `READINESS_API_KEY` | `/v1/stories/*` |
| Anyone | Nothing; these say nothing private | `/health`, `/v1/status/*` |

Secrets come only from the environment. The repository holds only `dev-only-...` defaults.

**Rate limits:**

- Webhooks: 100 per second per caller address, burst 200 (enough for the k6 burst of 100 stories).
- The API: 10 per second per API key, burst 20.

## 3. Every error and what it means

Every error is JSON with a machine code, a human message and the request id:
`{"error":"story_not_found","message":"No story with key NORTH-99","request_id":"..."}`.
Every answer, good or bad, carries `X-Request-Id` and `X-Readiness-Route` (`gateway`, `intake`, `reporter`, `paused` or `none`).

| Status | `error` | Meaning | What the caller should do |
|--------|---------|---------|---------------------------|
| 401 | `invalid_api_key` | No `X-Api-Key`, or the wrong one | Send the right key |
| 401 | `bad_signature` | The webhook signature is missing or wrong | Check the shared secret |
| 404 | `route_not_found` | No such path on the gateway | Check the path |
| 404 | `not_graded` | The story has no grade yet | Wait a few seconds, or recheck |
| 404 | `story_not_found` | No story with that key | Check the key |
| 405 | `method_not_allowed` | Recheck needs POST | Use POST |
| 429 | `rate_limited` | Too many calls | Wait and retry |
| 502 | `service_unavailable` | The service behind the gateway is not answering | Retry in a minute |
| 503 | `jira_unavailable` | Intake could not read Jira | Jira's simulator retries webhooks on its own |
| 503 | `validation_paused` | An operator paused validation (Day 5) | Stories stay Pending; the gate stays closed |
| 503 | `{"ready":false,"reason":...}` | A status call: the service is alive but not ready | Wait |

## 4. The speed promise

- 95% of `/v1/*` calls answer within **300 ms**.
- The gateway gives up after **2 s** to connect and **5 s** to read, then answers 502 as JSON.
- Grading itself is asynchronous; its promise is in `docs/slo/readiness-slo.md` (95% within 10 s).

## 5. How it changes

- Every path is under `/v1`. Adding a field or a new path is not a breaking change.
- Removing or renaming a field, or changing its meaning, needs `/v2`.
- `/v2` is announced to every caller at least four weeks before `/v1` changes, and `/v1` keeps running until they have moved.
- The contract is `api/openapi.yaml`; a change to it goes through pull request review by the Platform Lead.
