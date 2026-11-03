# ADR-007: Rules decide, AI advises

Date: 2026-11-03
Deciders: Lead Architect, Product Owner, Security

## Context

Some problems are fuzzy: a new idea the CR never mentioned, a synonym the impact map does not know.
A model could guess these. But a guess that blocks a BA is not explainable or testable,
and sending story text to a model may send personal data out of our systems.

## Decision

The Lead Architect keeps AI out of v1, and any future AI check runs inside the Impact service behind a setting,
publishes only `warn` results and never changes the level.

## Consequences

What gets better:

- Every level is explained by rules a person can read and a test can prove.
- No story text leaves our systems.

What gets worse:

- Fuzzy problems such as new scope ideas only warn later, and are not caught at all in v1.
- Refinement meetings are still needed to decide whether the requirement is right.

## Status

Accepted.
