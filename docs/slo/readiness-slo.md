# Service Level Objective: Story Readiness

Owner: Platform Lead

## 1. What we measure (the SLI)

The share of stories graded within 10 seconds of being saved, over a rolling 30 days. The Reporter logs one `graded` line per grade with `lag_ms`. A save that never gets a grade counts as late.

## 2. What we promise (the SLO)

95 percent, over a rolling 30 days.

## 3. What we are allowed to lose (the error budget)

5 percent. At an assumed 2,000 saves in 30 days, that is 100 late grades a month. While a story waits it stays Pending and the gate stays closed, so a late grade delays a BA but never lets a bad story through.

## 4. The stop rule

If more than half the budget is spent before day 15, all rule changes stop and the team works only on reliability until the budget recovers.

## 5. Where the numbers come from

- Live: the Reporter's `graded` log lines, field `lag_ms`.
- Before release: `load/story-burst.js` saves 100 stories at once and fails if fewer than 95 percent are graded within about 10 seconds.
