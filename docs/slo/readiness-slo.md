# Service Level Objective: Story Readiness

Owner: Platform Lead
Reviewed: every quarter, next review 2027-02-01
Status: Active
Course doc: 08

---

## 1. What we measure (the SLI)

The share of stories graded within 10 seconds of being saved, over a rolling 30 days.

"Saved" is the story's `fields.updated` in Jira. "Graded" is the Reporter's `checked_at`.
The Reporter logs one `graded` line per grade with `lag_ms` = `checked_at` minus `story_updated_at`.
A grade counts as on time if `lag_ms` is 10,000 or less.

A save that never gets a grade counts as late.

## 2. What we promise (the SLO)

95 percent, over a rolling 30 days.

## 3. What we are allowed to lose (the error budget)

100 percent minus 95 percent is 5 percent.

The teams save about 2,000 stories in 30 days.
5 percent of 2,000 is 100 saves.

So up to about 100 stories a month may be graded late, and we are still keeping our promise.

While a story waits, it stays Pending and the gate stays closed. A late grade delays a BA; it never lets a bad story through.

## 4. The stop rule

If more than 50 percent of the error budget is spent before day 15 of the window:

- All rule changes stop that same day (no new checks, no `rules.yaml` or `impact-map.yaml` edits).
- The team works only on reliability until the budget recovers.
- The Platform Lead informs the Lead Architect in writing.

If the budget is fully spent:

- No deployment except a fix for the cause, or a rollback.
- This rule cannot be waived by the team alone. It needs the Lead Architect and the Product Owner together.

## 5. What we do not promise

- We do not promise anything about Jira's own speed. That is outside our control.
  Our promise is that every call to Jira times out after 2 seconds, and a grade Jira refused waits in the outbox.
- We do not promise 10 seconds for the 5 percent slowest grades.
- We do not promise anything while validation is paused at the gateway (Day 5). Stories stay Pending on purpose.

## 6. Where the numbers come from

- Live: the Reporter's `graded` log lines, field `lag_ms`.
- Before release: the k6 script in `load/story-burst.js`. It saves 100 stories at once from 10 virtual users,
  then fails the run if fewer than 95 percent are graded within 10 seconds (`graded_within_slo`).

## 7. Named owner

The Platform Lead is accountable for this SLO.
If the Platform Lead changes role, this document must be reassigned within one week or it is treated as expired.
