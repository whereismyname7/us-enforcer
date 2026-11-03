# Story Readiness Gate - System Context

Owner: Lead Architect
Status: Accepted
Course doc: 01
Diagram: `docs/context.puml` (render with `docker compose run --rm diagrams`, then open `docs/context.png`)

---

## What the diagram shows

The Business Analyst writes stories and Change Requests in Jira, and the Developer picks stories from the Jira board.
Jira sends a signed webhook to the Story Readiness Gate every time a story or CR changes.
The Gate reads the story and its CRs, checks them against the Northline architecture files the Architect maintains, and writes a level from L0 to L4 back to Jira.
Jira's "Ready for Dev" step is allowed only at L4, so only dev-ready stories reach the developer board.
In v1, Jira is our own simulator (`jira-sim`, ADR-008), so nothing connects to real Jira.

## Scope

**In scope for v1:**

- The Jira simulator, the API gateway, and the four services: Intake, Rules, Impact and Reporter
- Redpanda (the event log) and Redis (the Reporter's store)
- Unit tests, a smoke test, three fitness functions, a k6 load test and C4 diagrams as code
- The nine course documents and a Day 0 to Day 5 README

**Out of scope for v1:**

- Real Jira and the Forge app
- Confluence parsing
- AI of any kind (ADR-007)
- Any web UI
- Authentication beyond the gateway API key and the webhook signature
- Kubernetes
