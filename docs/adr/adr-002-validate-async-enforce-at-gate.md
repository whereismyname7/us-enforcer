# ADR-002: Validate asynchronously, enforce at the gate

Date: 2026-11-04
Deciders: Lead Architect, BA Lead

## Context

Blocking the save would stop a BA from keeping a draft, and it would make Jira depend on our services. But stories must not reach developers before they are ready.

## Decision

Saving is always allowed. Every save sets the story to Pending and triggers a check. The move to Ready for Dev reads only the stored level and requires L4 for the version saved right now.

Rules decide the level. Only rule-based checks with clear evidence can block. AI may advise later, but it never decides.

## Consequences

What gets better:

- A BA can always save a draft.
- The gate is instant, and it stays closed when our services are down (fail closed).

What gets worse:

- There is a short wait before the level appears.
- Rules check structure, not whether the requirement is right, so refinement meetings stay.

## Status

Accepted.
