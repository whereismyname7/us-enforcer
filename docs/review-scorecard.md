# Story Readiness Gate - Architecture Review Scorecard

Owner: Lead Architect
Status: Accepted
Reviewed: 2026-11-03
Course doc: 09

Each area is scored 0 (missing), 1 (partly there) or 2 (there and enforced). Each score has a file as evidence.

---

| Area | Score | Evidence | Note |
|------|-------|----------|------|
| Traceability: every decision has a reason and a home | 2 | `docs/adr/adr-001-each-service-owns-its-config.md` to `adr-009-one-api-gateway.md`; every check id in `docs/checks.md` | Every ADR has an owner and a cost. Every check points to one config file. |
| Data ownership: one owner per piece of data | 2 | `fitness/no-shared-config.js`; `services/reporter/store.js` | Rules owns its yaml, Impact owns three, the Reporter alone owns Redis. The build fails if a service reaches into another's files. |
| Contract: interfaces are written down and checked | 2 | `api/openapi.yaml`; `api/events/*.schema.json`; `fitness/events-match-catalogue.js` | Every topic in the code is in the catalogue, and every schema has a matching example. |
| Reversibility: we can undo a decision cheaply | 2 | `gateway/routes/webhook-route.conf`; `docs/slice-one-plan.md` | Validation pauses with one nginx reload, and the gate fails closed while it is paused. |
| Enforcement: rules are enforced by machines, not by memory | 1 | `simulator/jira-sim/gate.js`; `fitness/run-all.js` | The gate and the fitness functions are automatic. But in real Jira an admin could remove the validator; that is a governance gap. |

**Total: 9 of 10.**

## The strongest thing

The gate reads only the stored level and its freshness (`story_updated_at === fields.updated`), so it is instant,
works when every service is down, and cannot be fooled by an old grade. (ADR-003)

## The one risk to fix first

The keyword map in `services/impact/impact-map.yaml` decides impact. A word it does not know means a missed
container; a common word means a false alarm. Today only the override reasons show us where it is wrong.

## The next action

Review every override reason each sprint and tune `impact-map.yaml` from what they say, owned by the Lead Architect.
Record that routine, and who may remove the real Jira validator, as **ADR-010** before the move to real Jira.
It builds on ADR-004 (thin Jira app) and ADR-001 (Impact owns the map).
