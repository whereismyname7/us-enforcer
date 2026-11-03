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

## Status

Accepted.
