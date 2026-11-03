# Story Readiness Gate - Decomposition Plan

Owner: Lead Architect
Status: Accepted
Course doc: 05

---

## Why four services

We cut by **capability** and by **rate of change**.

| Capability | Service | Changes | Why it is separate |
|------------|---------|---------|--------------------|
| Read Jira, translate, add CR data | Intake | Rarely: only when Jira's fields change | It is the anti-corruption layer (ADR-005). Jira's names stop here. |
| Check the writing: template, criteria, wording, INVEST, CR | Rules | Weekly: the BA and QA leads tune `rules.yaml` | The rules change most often. They must ship without touching anything else. |
| Check against the architecture: C4, ADRs, CR impact, delivery | Impact | Monthly: when the architecture or an ADR changes | It reads the architect's files and has its own owner. |
| Combine, grade, write back to Jira | Reporter | Rarely | It is the only writer to Jira, so there is one place to handle Jira being down (timeout, breaker, outbox). |

Each service owns its own config (ADR-001) and they talk only through events (ADR-002).
Rules and Impact are pure checks, so each can be tested with nothing else running, and Rules can run three copies.

## Alternatives, ranked

| Rank | Option | Verdict | Why |
|------|--------|---------|-----|
| 1 | **Four services** (Intake, Rules, Impact, Reporter) | **Chosen** | Matches the three rates of change and the one-writer rule. Small enough to run on a laptop. |
| 2 | Two services (intake plus one checker that also writes) | Rejected | The weekly rule changes would redeploy the Jira writer and the architecture checks together. |
| 3 | One service | Rejected | Simplest to run, but every rule tweak is a full release, and a slow Jira would block the checks. |
| 4 | One service per check (24 services) | Rejected | Far too many moving parts for one team. Most checks change together with their neighbours. |

## The first slice

Slice one is the whole path for **one story**: a webhook in, both checkers, a grade back in Jira, and the gate.
It is in `docs/slice-one-plan.md`.

Why this slice first: it proves the riskiest part, the round trip through events and back to Jira,
on the smallest amount of rules. More rules are only config changes after that.
