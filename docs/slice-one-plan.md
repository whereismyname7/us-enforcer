# Story Readiness Gate - Slice One Plan

Owner: Platform Lead
Status: Accepted

---

## What slice one is

Grading is switched on, and the gate runs in **warn-only mode** for **one team** for **one sprint**.
Every story that team saves is graded and gets the readiness comment and labels, but "Ready for Dev" is not blocked yet.
After that sprint, the gate is switched on for the team.

| Week | Grading | Gate | Who |
|------|---------|------|-----|
| Sprint 1 | On | Warn only: the comment says the level, nothing is blocked | One pilot team |
| Sprint 2 | On | On: Ready for Dev needs L4 or an override | The same team |
| After review | On | On | The next team |

Why warn-only first: BAs see what the checks ask for before the checks can stop them, so the first week is learning,
not arguing. It also gives us the false-alarm list to tune `impact-map.yaml` and `rules.yaml` before anyone is blocked.

## How we undo it

Reversible in one sentence: "pause the webhook route in the gateway and reload".

In `gateway/routes/webhook-route.conf`, comment out the LIVE block, uncomment the PAUSED block, then run
`docker compose exec gateway nginx -t` and `docker compose exec gateway nginx -s reload`.
No container restarts. Stories then stay Pending, so the gate fails closed; an architect or product owner can override with a reason.

## How we know it worked

Success measure: **stories bounced back by developers per sprint**, counted before and after the gate.
A story is bounced back when a developer moves it out of In Progress because it was not ready.

Secondary measure: time from Created to Ready for Dev, so we see whether the gate slows teams down.

Both are compared for the pilot team between the sprint before slice one and the first sprint with the gate on.
