# ADR-003: Intake is the anti-corruption layer, and only the Reporter writes to Jira

Date: 2026-11-04
Deciders: Lead Architect, Platform Lead

## Context

Jira's field names and custom fields change, and they differ per installation. If they spread through our services, every Jira change would touch all of them.

## Decision

Only Intake reads Jira's shape and translates it into our event. The Checker never calls Jira. Only the Reporter writes to Jira. We build and test against our own small simulator, `services/jira-sim`, so the idea can be shown without a Jira licence.

## Consequences

What gets better:

- Moving to real Jira changes Intake, the Reporter's one write call and a thin Jira app. The checks do not change.
- The Checker is pure logic and can be tested with nothing else running.

What gets worse:

- The simulator does not copy every Jira behaviour, so real Jira will bring surprises.
- Each event must carry everything the Checker needs, including the CR.

## Status

Accepted. Checked by `fitness/service-boundaries.js`.
