# ADR-001: Services talk only through events

Date: 2026-11-04
Deciders: Lead Architect, Platform Lead

## Context

Intake, the Checker and the Reporter must work together. If Intake called the Checker and waited, a slow or restarting Checker would make webhooks fail, and one sick service would hold up the others.

## Decision

Intake publishes `StoryChanged` on `readiness.story-changes`. The Checker publishes `StoryChecked` on `readiness.check-results`. The Reporter reads that. Every event has an `event_id` and a `version` and is keyed by `story_key`, so one story's events stay in order.

## Consequences

What gets better:

- Intake does not fail when the Checker is down. The Checker catches up from its group position when it returns.
- A new checker, such as an AI advisor, can subscribe later with no change to Intake.

What gets worse:

- Grading is eventually consistent. A story is Pending for a moment after every save.
- We run a broker, and somebody must own it.
- Duplicates are our problem, so the Reporter ignores an `event_id` it has already handled.

## Status

Accepted. Checked by `fitness/service-boundaries.js`.
