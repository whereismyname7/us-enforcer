# ADR-009: One API gateway is the only door

Date: 2026-11-03
Deciders: Lead Architect, Platform Lead, Security

## Context

Jira must reach Intake, and people and scripts must read grades from the Reporter.
If each service were exposed on its own port, each would need its own key check, rate limit and error format,
and the internal service names would leak to callers.

## Decision

The Platform Lead runs one nginx gateway as the only door into the system: it routes, checks the API key,
applies rate limits, adds a request id and answers errors as JSON, and it holds no business rules.

## Consequences

What gets better:

- One place for the key, the limits and the request id; every log line can be joined by that id.
- Internal names stay hidden, and every error looks the same.
- Validation can be paused and resumed with one reload (Day 5), and the gate fails closed while paused.

What gets worse:

- One more component to run.
- A single point to protect: if the gateway is down, no webhook reaches us and stories stay Pending.
- If the gateway ever grows business rules, we have rebuilt the monolith; reviews must watch for it.

## Status

Accepted.
