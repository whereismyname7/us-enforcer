# ADR-001: The Catalog service owns product data

Date: 2026-03-02
Deciders: Head of Engineering, Lead Architect, Catalog Team Lead

## Context

NorthlineCore is one program written in 2011. Every part of it reads and
writes the same database tables directly.

Four teams currently write to the `products` table: catalog, checkout,
warehouse and marketing. Nobody knows which team last changed a column.
Twice in the last year a change made by one team broke another team on
the same afternoon.

We want to split NorthlineCore into smaller services. The first candidate
is the catalog, because it is mostly read-only traffic and it has the
clearest boundary.

We cannot split anything while four teams write to the same table.

## Decision

The Catalog service is the only component allowed to read or write the
product tables. Every other component must ask the Catalog service through
its published API. No other service connects to the catalog database.

## Consequences

What gets better:

- One team owns the product data model. Changes are safe to review.
- The catalog database can be moved, resized or replaced without
  telling the other three teams.
- The boundary is now testable. We can write an automated check that
  fails the build if another service imports the catalog database.

What gets worse:

- Checkout can no longer join product rows to order rows in one query.
  It must call the Catalog API and hold the result. This is more code
  and it is slower.
- If the Catalog service is down, checkout cannot show product names.
  We must design a fallback and accept degraded pages.
- The migration is not free. Three call sites in NorthlineCore must be
  rewritten before we can enforce the rule.

## Status

Accepted.

Enforced from Day 5 by the automated check in `fitness/no-shared-db.js`.
