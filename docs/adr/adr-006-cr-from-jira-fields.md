# ADR-006: Read Change Requests from Jira fields

Date: 2026-11-03
Deciders: Lead Architect, Product Owner, BA Lead

## Context

CRs live in two places: a Jira issue with a workflow status, and a Confluence page with the full business document.
Confluence pages have no fixed template yet, so parsing scope and impact from them would be guesswork.

## Decision

The BA Lead has every CR's status, impacted systems, in scope, out of scope and target date typed into fields on the
Jira CR, Intake reads only those fields in v1, and the Confluence page stays a reference link until v2.

## Consequences

What gets better:

- The CR checks (R-CR-01 to R-CR-04, I-CR-01) are exact and testable.
- One API and one service account reach everything we need.

What gets worse:

- CR scope must be typed into Jira fields, which repeats part of the Confluence page.
- If the fields and the page disagree, the fields win, and somebody has to notice.

## Status

Accepted.
