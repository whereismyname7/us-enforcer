# Story Readiness Gate - Stakeholders

Owner: Lead Architect
Status: Accepted
Course doc: 02

---

Each stakeholder gets the view that answers their own question, and no more.
Time is how much of a refinement week each one is expected to spend on the gate.

| Stakeholder | What they care about | The view they get | Time they get |
|-------------|----------------------|-------------------|---------------|
| Business Analyst | Knowing exactly what is missing before refinement, not mid-sprint | The readiness comment on each story: the level and a list of blocking items and warnings | A few minutes per story, every time they save it |
| Developer | Only picking stories that are really ready | The developer board (`GET /board`): only L4 or overridden stories, with impact and teams | None extra; the board is filtered for them |
| Architect | Stories that respect the architecture and the ADRs | The ADR rules (`services/impact/adr-rules.yaml`), the impact map (`services/impact/impact-map.yaml`) and the I-ADR / I-UNK checks | 30 minutes a sprint to review overrides and tune the map |
| QA Lead | Testable acceptance criteria with a negative case | The acceptance criteria checks R-AC-01 and R-AC-02, and R-VAG-01 for unmeasurable words | 15 minutes a sprint to review the vague-word list |
| Product Owner | Every story belongs to an approved CR and stays in scope | Readiness per CR: R-CR-01 to R-CR-04 and I-CR-01 on each story, and the override with a reason | 15 minutes a sprint, plus each override they give |
| Jira admin | A gate that cannot be bypassed by accident | The gate setup: the Ready for Dev rule (`simulator/jira-sim/gate.js`; a Forge validator later, ADR-004) and the override roles | One hour at setup, then only on change |
| Security | Sensitive data is reviewed before build | The `needs-security-review` label from I-SEC-01 | A label filter they check once a sprint |

## Who decides

| Decision | Decider |
|----------|---------|
| The architecture and the ADRs | Lead Architect |
| The story template and wording rules | BA Lead |
| The acceptance criteria rules | QA Lead |
| Running the system and the SLO | Platform Lead |
