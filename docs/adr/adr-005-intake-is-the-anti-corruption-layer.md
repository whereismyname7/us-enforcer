# ADR-005: Intake is the anti-corruption layer

Date: 2026-11-03
Deciders: Lead Architect, Platform Lead

## Context

Jira's field names (`asA`, `acceptanceCriteria`, `issuelinks`) and its link directions are Jira's model, not ours.
If every service read Jira's shape, a change in Jira would break all four, and Jira's words would leak into every rule.

## Decision

The Platform Lead makes Intake the only service that knows Jira's fields: it translates each story into the
snake_case `story` object, adds fresh CR data and publishes `StoryChanged`, and nothing else reads Jira's shape.

## Consequences

What gets better:

- Rules and Impact are pure functions of the event; they never call Jira.
- A Jira change touches one file, `services/intake/translate.js`.

What gets worse:

- Intake must change whenever Jira's fields change.
- Intake makes extra reads (the story and each CR) for every webhook.

## Status

Accepted.
