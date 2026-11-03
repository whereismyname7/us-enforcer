# Story Readiness Gate - Event Catalogue

Owner: Platform Lead
Status: Accepted
Course doc: 07
Schemas: `api/events/*.schema.json` · Examples: `api/events/examples/`
Checked by: `fitness/events-match-catalogue.js`

The services talk only through these events (ADR-002). Event names are business facts in the past tense.
Every event has an `event_id` and a `version`, and field names are snake_case.

---

## Topics

| Topic | Event | Partitions | Message key | Publisher | Consumer group(s) |
|-------|-------|------------|-------------|-----------|-------------------|
| `readiness.story-changes` | `StoryChanged` v1 | 3 | `story_key` | intake | `rules-checks` (rules), `impact-checks` (impact) |
| `readiness.check-results` | `StoryChecked` v1 | 3 | `story_key` | rules, impact | `reporter-grading` (reporter) |

Retention is the Redpanda default. Keying by `story_key` keeps one story's events in order on one partition.
Every Kafka service creates both topics at startup; doing it twice is safe.

---

## StoryChanged v1

"A story's content, links or CR changed."

- **Topic:** `readiness.story-changes`
- **Key:** `story_key`
- **Publisher:** Intake
- **Consumers:** Rules (`rules-checks`) and Impact (`impact-checks`)

| Field | Type | Meaning |
|-------|------|---------|
| `event_id` | string (uuid) | Unique per event |
| `type` | `"StoryChanged"` | |
| `version` | `1` | |
| `occurred_at` | ISO time | When Intake published it, taken after its last read; later means fresher data |
| `story_key` | string | e.g. `NORTH-1` |
| `story_updated_at` | ISO time | The story's `fields.updated` when Intake read it |
| `trigger` | `story_created` \| `story_updated` \| `links_changed` \| `cr_changed` \| `recheck` | Why it was published |
| `story` | object | The story translated by Intake: `summary`, `as_a`, `i_want`, `so_that`, `acceptance_criteria`, `technical_notes`, `due_date`, `status`, `links` |
| `change_requests` | array | Every CR the story implements, read fresh: `key`, `status`, `impacted_systems`, `in_scope`, `out_of_scope`, `target_date`, `updated_at` |

## StoryChecked v1

"One checker finished checking one StoryChanged."

- **Topic:** `readiness.check-results`
- **Key:** `story_key`
- **Publishers:** Rules (`checker: "rules"`, 14 checks) and Impact (`checker: "impact"`, 8 checks plus one per ADR rule)
- **Consumer:** Reporter (`reporter-grading`)

| Field | Type | Meaning |
|-------|------|---------|
| `event_id`, `type` (`"StoryChecked"`), `version` (`1`), `occurred_at` | | as above |
| `story_key`, `story_updated_at` | | copied from the StoryChanged |
| `source_event_id` | string | The StoryChanged `event_id`; the Reporter groups results by it |
| `source_occurred_at` | ISO time | The StoryChanged `occurred_at`; the Reporter drops anything older than the newest it has seen |
| `checker` | `"rules"` \| `"impact"` | |
| `checks` | array of `{id, level, severity, passed, message}` | `level` 1 to 4, `severity` `block` or `warn` |
| `facts` | object | `{}` from rules; from impact `{impacted_containers, impacted_names, teams, labels}` |

---

## The rules every event follows

**Failure rule: a stopped consumer catches up from its group position.**
Each consumer group's position is saved by the broker. Stop Impact, save a story, start Impact again:
it reads every event it missed, in order, and the story is graded (README Day 3, step 3.8).

**Idempotency: `event_id` plus the Reporter's `seen:` key.**
Kafka can deliver a message twice. The Reporter stores `seen:<event_id>` with `NX` for a day;
a repeat finds the key and is skipped (`duplicate_ignored`). Results older than the newest change
for a story are dropped (`stale_dropped`), and a grade is written only if the story has not changed since.

**No call-backs.** A consumer never calls back to the publisher. Rules and Impact never call Intake or Jira;
everything they need is inside the event. Only the Reporter writes to Jira.

**Versions.** A new optional field keeps `version: 1`. A removed or renamed field is a new version,
published next to the old one until every consumer has moved.
