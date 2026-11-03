# Story Readiness Gate - Context Map

Owner: Lead Architect
Status: Accepted
Course doc: 04

A bounded context is a boundary where one word has exactly one meaning.
Two contexts may use the same word differently. That is fine, as long as
we write it down here and translate at the border.

We have four contexts, one per service.

---

## Context 1: Story Intake

Owner: Platform Lead
Purpose: turn what Jira says into what our services understand.

| Word    | What it means inside Story Intake |
|---------|-----------------------------------|
| story   | A Jira issue of type Story, read fresh from Jira with its links and CRs. Jira's field names (`asA`, `acceptanceCriteria`) exist only here. |
| webhook | A signed message from Jira saying "something changed". It may be our own bot's change, which we ignore. |
| trigger | Why we publish: `story_created`, `story_updated`, `links_changed`, `cr_changed` or `recheck`. |

What Story Intake promises to others:

- It publishes `StoryChanged` v1 on `readiness.story-changes`, keyed by `story_key`.
- Every event carries the story's `story_updated_at` and fresh CR data.

---

## Context 2: Rules

Owner: BA Lead
Purpose: decide whether the story is written well enough to build.

| Word      | What it means inside Rules |
|-----------|----------------------------|
| story     | A `StoryChanged` snapshot: frozen text at one `story_updated_at`. Never a live Jira issue. |
| criterion | One non-empty line of `acceptance_criteria`. It must be Given/When/Then. |
| ready     | Never used here. Rules only says which checks passed. |

What Rules promises to others:

- One `StoryChecked` with `checker: "rules"` and exactly 14 checks per `StoryChanged`.

---

## Context 3: Impact

Owner: Lead Architect
Purpose: decide what the story touches in the Northline architecture.

| Word      | What it means inside Impact |
|-----------|-----------------------------|
| impact    | The containers we **detect** from the story text using `impact-map.yaml` and `containers.puml`. |
| container | One box in Northline's `containers.puml`, by id (`warehouse`) and name (`Warehouse Service`). |
| owner     | The team in `owners.yaml`, or the data owner the story names in its technical notes. |

What Impact promises to others:

- One `StoryChecked` with `checker: "impact"` and the facts `impacted_containers`, `impacted_names`, `teams` and `labels`.

---

## Context 4: Reporting

Owner: Platform Lead
Purpose: give each story one level and tell Jira.

| Word  | What it means inside Reporting |
|-------|--------------------------------|
| level | L0 to L4: the lowest failed blocking level minus one, or 4 if nothing blocking failed. |
| grade | The readiness value: level, failed, warnings, impact, teams, labels, and the `story_updated_at` it is for. |
| ready | L4 for the version that is saved right now. |

What Reporting promises to others:

- The `readiness` property, a comment and labels on the Jira story, written as the bot.
- `GET /v1/stories/{key}/readiness` through the gateway.

---

## The dangerous words

**ready** is the most dangerous one.

- In Jira, "Ready for Dev" is a **status**: a column on a board that anyone can drag a card into.
- In Reporting, ready means **L4** for the saved version.

Rule: the gate allows the status only when the level is L4 and fresh. We say "Ready for Dev status" or "L4", never only "ready".

**impact** is the second one.

- A CR **declares** impact: the "Impacted systems" a person typed into Jira.
- Impact **detects** impact from the story text and the C4 diagram.

Rule: I-CR-01 fails when they disagree. We say "declared impact" or "detected impact", never only "impact".

**story** is the third one.

- In Jira, a story is a live issue that keeps changing.
- In Rules, Impact and Reporting, a story is a `StoryChanged` snapshot at one `story_updated_at`.

Rule: a grade is only for the snapshot it was made from. The gate checks `story_updated_at === fields.updated`.

---

## The border

Intake translates at the border (ADR-005). Jira's field names never leave Intake.
Rules, Impact and Reporting never call Jira to read a story; they read the event.

## Relationship type

Jira is upstream. We are downstream.
We adapt to Jira through an anti-corruption layer (Intake), so when Jira's fields change, only Intake changes.
Inside our system, Story Intake is upstream of Rules and Impact, and both are upstream of Reporting,
always through the published events in `api/events/`.
