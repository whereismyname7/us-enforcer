# Story Readiness Gate - AI Readiness

Owner: Lead Architect
Status: Accepted

Version 1 uses no AI, on purpose (ADR-007): predictable, explainable, testable, and no data leaves our systems.
This page answers the course's five questions to say how ready the system is for AI later.

---

| Question | Our answer | Score |
|----------|------------|-------|
| One owner per fact? | Yes. Rules owns `rules.yaml`, Impact owns the impact map, ADR rules and owners, the Reporter owns the grades in Redis. Enforced by `fitness/no-shared-config.js`. | Ready |
| Does data leave only through an API? | Mostly. Grades leave through `GET /v1/stories/{key}/readiness` and the Jira write-back. But story text travels inside events, so an AI service would read it from the event log, not through a contract made for it. | Partly |
| Who may see it? | The gateway needs an API key for readiness, and webhooks are signed. But there is no per-team permission: anyone with the key sees every story's grade. Story text may hold personal data. | Partly |
| Timeout and fallback? | Every outbound call has a timeout, the Reporter has a breaker and an outbox, and the gate fails closed. An AI call would get the same treatment, and its answer would only ever be a warning. | Ready |
| Are decisions logged? | Yes. Every check result is in the `StoryChecked` event, every grade is logged as `graded` with its level, and every override is stored on the story with a name and a reason. | Ready |

## The one blocker

Story text can contain personal data, and nothing today decides which parts of it an AI model may see.
Until that is decided, no story text may be sent to a model.

## The first task

Write down and keep the rule from ADR-007: **rules decide, AI advises**.
Any AI check goes inside the Impact service behind a setting, publishes only `warn` results, and never changes the level.
The first candidate is a scope-creep warning by meaning ("new idea the CR never mentioned"), using Forge's
Atlassian-hosted model so data stays inside Atlassian.
