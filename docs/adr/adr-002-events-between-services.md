# ADR-002: Services talk only through events

Date: 2026-11-03
Deciders: Lead Architect, Platform Lead

## Context

Four services must work together: Intake, Rules, Impact and the Reporter.
If Intake called Rules and Impact directly and waited, a slow or restarting checker would make Intake fail,
Jira would retry its webhooks, and one sick service would hold up all of them.
Northline learned this with Checkout calling Warehouse directly.

## Decision

The Platform Lead runs one event log (Redpanda), and the services talk only through two events on it:
Intake publishes `StoryChanged` on `readiness.story-changes`, and Rules and Impact each publish `StoryChecked` on `readiness.check-results`.
Every event has an `event_id` and a `version`, is keyed by `story_key`, and is listed in `docs/event-catalogue.md`.

## Consequences

What gets better:

- Intake does not fail when a checker is down. The checker catches up from its group position when it comes back.
- Rules can run three copies; Kafka shares the partitions between them.
- A new checker can subscribe later with zero changes to Intake.

What gets worse:

- Grading is eventually consistent. A story is Pending for a few seconds after every save.
- We run a broker. Somebody must own it, watch it and set its retention.
- Debugging follows an event across services, so every log line carries `story_key` and `event_id`.
- Duplicates are our problem: the Reporter needs the `seen:` key to stay idempotent.

## Status

Accepted.

Checked by `fitness/events-match-catalogue.js`.
