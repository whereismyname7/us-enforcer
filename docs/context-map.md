# Story Readiness Gate - Context Map

A bounded context is a boundary where one word has exactly one meaning. We have three, one per service.

| Context | Service | Purpose | Promises to others |
|---------|---------|---------|--------------------|
| Story Intake | Intake | Turn what Jira says into our words | `StoryChanged` v1 on `readiness.story-changes`, with fresh CR data |
| Checking | Checker | Decide which checks a story passes | `StoryChecked` v1 on `readiness.check-results` |
| Reporting | Reporter | Give each story one level and tell Jira | The level and a comment on the story, plus the readiness API |

## The dangerous words

**ready**
- In Jira, "Ready for Dev" is a status: a column on a board.
- In Reporting, ready means L4 for the version saved right now.
- Rule: we say "Ready for Dev status" or "L4", never only "ready".

**impact**
- A CR declares impact: the systems a person typed into Jira.
- The Checker detects impact from the story text and the target's containers.
- Rule: `IMPACT-DECLARED` fails when they disagree. We say "declared" or "detected", never only "impact".

**story**
- In Jira, a story is a live issue that keeps changing.
- In Checking and Reporting, a story is a `StoryChanged` snapshot at one `story_updated_at`.
- Rule: a grade is only for the snapshot it came from, so Jira refuses a grade for an older version.

## Relationship type

Jira is upstream and we are downstream. We adapt through an anti-corruption layer (Intake, ADR-003), so when Jira's fields change, only Intake changes. Inside our system, Intake is upstream of the Checker and the Checker of the Reporter, always through events.
