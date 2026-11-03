# ADR-004: Logic in external services, a thin Jira app

Date: 2026-11-03
Deciders: Lead Architect, Jira Admin, Platform Lead

## Context

We could build everything as a Jira plugin. But Forge apps cannot host our services or an event bus,
the checks need the architecture files, and the rules change weekly. A plugin-only design would put
all of that inside Jira's release cycle and limits.

## Decision

The Lead Architect keeps all grading logic in our own services; when we move to real Jira, only a thin Forge app
lives in Jira, and it only sends events, shows the readiness panel and runs the workflow validator.

## Consequences

What gets better:

- The checks can be built, tested and released without Jira.
- The same services work with the simulator now and real Jira later.

What gets worse:

- Two things to deploy when we go live: our services and the Forge app.
- A Jira admin could remove the validator from the workflow. That is a governance gap we must cover in a later ADR.

## Status

Accepted.
