# ADR-003: Validate asynchronously, enforce at the gate

Date: 2026-11-03
Deciders: Lead Architect, BA Lead, Product Owner

## Context

We could check a story while the BA is saving it and refuse the save if it is not good enough.
But a BA must be able to save a half-written draft, and a check that calls several services
inside the save would make Jira slow and would fail whenever one service is down.

## Decision

The Platform Lead runs validation after every save, asynchronously, and the gate on "Ready for Dev" reads only
the stored readiness property: it allows the move only for a fresh L4 grade (`story_updated_at` equal to `fields.updated`)
with a CR link, or a valid override.

## Consequences

What gets better:

- Saving is never blocked. Drafts are always allowed.
- The gate is instant and works even when every service is down, because it only reads a stored value.
- An old grade can never open the gate for a newer version of the story.

What gets worse:

- A few seconds pass after each save before the level appears.
- While a story is Pending the gate stays closed, so a slow system delays BAs. The SLO in `docs/slo/readiness-slo.md` limits this.

## Status

Accepted.
