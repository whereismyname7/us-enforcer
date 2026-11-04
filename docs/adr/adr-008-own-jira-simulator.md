# ADR-008: Build and test against our own Jira simulator

Date: 2026-11-03
Deciders: Lead Architect, Platform Lead, QA Lead

## Context

We may not install a Forge app on the company Jira during the course, and tests against a shared Jira
are slow, flaky and leave junk issues behind. But the services must speak Jira's REST API and receive its webhooks.

## Decision

The Platform Lead builds and runs `jira-sim`, a small simulator behind Jira Cloud's REST paths with signed webhooks,
the L4 gate and the board, so v1 never connects to real Jira; moving later means changing `JIRA_URL` and installing the Forge app.

## Consequences

What gets better:

- The whole system runs on a laptop with one command, and the smoke test is repeatable.
- We can break Jira on purpose (chaos) to test the breaker and the outbox.

What gets worse:

- Not every Jira behaviour is copied. For example, `fields.updated` changes only on content and links in the simulator,
  while real Jira also changes it for status and labels; the freshness check must be adapted when we move.
- The simulator is one more component to keep in step with the real API.
- Our paths use `/rest/api/v3/` where real Jira uses `/rest/api/3/`. Moving to real Jira therefore also means
  changing the paths in `services/intake/jira-client.js` and `services/reporter/jira-client.js`, not only `JIRA_URL`.
- For a clear demo, the simulator returns a short card (level and status first, missing items as one line each,
  newest comment first), moves a story with `{"to": "Ready for Dev"}` instead of transition ids, and takes the
  Reporter's grade, comment and labels in one call. Real Jira does none of this, so Intake's `translate.js` and the
  Reporter's `jira-client.js` must be adapted when we move.

## Status

Accepted.
