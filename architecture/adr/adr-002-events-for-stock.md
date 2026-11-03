# ADR-002: Stock is updated by events, not by a direct call

Date: 2026-03-04
Deciders: Lead Architect, Checkout Team Lead, Warehouse Team Lead

## Context

When a shopper pays, the stock count must go down.

The obvious option is for Checkout to call the Warehouse API directly and
wait for the answer. We tried this shape in the 2011 system. Two problems
appeared and never went away.

First, every time the warehouse was slow or restarting, checkout became
slow or failed. Shoppers could not pay because a back-office system was
being patched.

Second, the finance department later asked for the same information. The
only way to give it to them was to add a second call inside checkout.
Checkout now knows about two systems that have nothing to do with taking
money, and it must be tested against both.

## Decision

Checkout publishes one event, `PaymentCaptured`, to the topic
`northline.payments`. It does not know who reads it.

Warehouse subscribes to that topic in the consumer group
`warehouse-stock` and reduces the stock count.

Every event carries a unique `event_id`. Every consumer must be
idempotent: applying the same `event_id` twice has the same effect as
applying it once.

## Consequences

What gets better:

- Checkout does not fail when the warehouse is down. Sales continue.
- The warehouse catches up automatically when it comes back, in order.
- Finance can subscribe next year with zero changes to Checkout.
- Each side can be deployed and scaled on its own schedule.

What gets worse:

- The stock number is now eventually correct, not instantly correct.
  Usually the delay is under a second. During an outage it is longer.
  The product team must accept and communicate this.
- We now operate a broker. Somebody must own it, monitor it, and set
  the retention period.
- Debugging is harder. A problem is no longer one stack trace. You must
  follow an event across two services, so every log line carries the
  `event_id`.
- Duplicate delivery is now our problem to handle, not the network's.

## Status

Accepted.

Retention on `northline.payments` is set to 7 days, which is longer than
our worst recorded outage of 9 hours.
