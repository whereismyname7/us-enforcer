# ADR-001: Each service owns its own config

Date: 2026-11-03
Deciders: Lead Architect, BA Lead, Platform Lead

## Context

The checks are driven by config files: word lists, patterns, the impact map, the ADR rules and the team owners.
Two teams change them at different speeds. The BA and QA leads tune the wording rules weekly;
the architect changes the impact map when the architecture changes.

If two services read the same config file, a change for one can silently break the other,
and nobody knows who may approve a change. This is Northline's shared `products` table problem again.

## Decision

The Lead Architect assigns each config file to exactly one service: Rules owns `rules.yaml`;
Impact owns `impact-map.yaml`, `adr-rules.yaml` and `owners.yaml`; the Reporter owns Redis.
No service reads, imports or names another service's files, and `fitness/no-shared-config.js` fails the build if one does.

## Consequences

What gets better:

- Each file has one owner who approves its changes.
- A rule change rebuilds one service and nothing else.
- The boundary is testable: the fitness function proves it on every run.

What gets worse:

- Small helpers such as `match.js` and the log function are copied into each service, not shared.
  A fix to one copy must be made by hand in the other.
- A check that needs data another service owns must get it through an event, which is more work than a file read.

## Status

Accepted.

Enforced by `fitness/no-shared-config.js` (Day 5).
