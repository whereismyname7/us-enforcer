# Story Readiness Gate - Check Catalogue

Owner: BA Lead (Rules checks), Lead Architect (Impact checks)
Status: Accepted

Rule-based checks with clear evidence block the level; heuristics only warn. Nobody is blocked by a guess.

---

## Texts the checks read

A missing field counts as `""`.

- `ALL` = `summary`, `i_want`, `so_that`, `acceptance_criteria`, `technical_notes`, joined with a new line
- `STORY` = `i_want`, `so_that`, `acceptance_criteria`
- `NOTES` = `technical_notes`
- AC lines = `acceptance_criteria` split into lines, trimmed, empty lines dropped

"Find terms" means `findTerms` in each service's `match.js`: a term ending in `*` matches any word that starts with it,
`?` matches a question mark, and anything else must match as a whole word or phrase.

## Rules service (config: `services/rules/rules.yaml`)

| Id | Level | Severity | Rule | Message when it fails |
|----|-------|----------|------|-----------------------|
| R-TPL-01 | 1 | block | `summary` matches `template.title_pattern` | `Title must look like "[Area] Short phrase"` |
| R-TPL-02 | 1 | block | `as_a`, `i_want`, `so_that` are all filled | `Missing: as_a, so_that` |
| R-INV-V | 1 | warn | `so_that` and `i_want` both filled and different | `So that repeats I want; state the benefit` |
| R-AC-01 | 2 | block | At least one AC line, every one Given/When/Then | `No acceptance criteria`, or `<n> criteria are not Given/When/Then` |
| R-AC-02 | 2 | block | Some AC line has a word from `acceptance.negative_words` | `Add a negative case (error, empty, not allowed)` |
| R-VAG-01 | 2 | block | No word from `vague_words` in `STORY` | `Unmeasurable: "quickly". Use a number` |
| R-OPQ-01 | 2 | block | No term from `open_questions` in `ALL` | `Open question left: "TBD"` |
| R-CR-01 | 3 | block | At least one CR linked | `No Change Request linked` |
| R-INV-I | 4 | block | No `invest.dependency_phrases` match in `ALL`, no open "is blocked by" link | `Depends on other work: NORTH-9` |
| R-INV-N | 4 | warn | No `invest.implementation_words` in `STORY` | `Implementation detail belongs in technical notes: redis` |
| R-INV-S | 4 | warn | AC line count at most `acceptance.max_criteria` | `<n> criteria; consider splitting` |
| R-CR-02 | 4 | block | At least one CR, every CR Approved | `No CR to check`, or `CR-12 is Draft` |
| R-CR-03 | 4 | block | No word from any CR's out of scope in `ALL` | `"discount" is out of scope for CR-12` |
| R-CR-04 | 4 | warn | Due date not after any CR's target date | `Due after CR target date: CR-12` |

## Impact service (config: `services/impact/impact-map.yaml`, `adr-rules.yaml`, `owners.yaml`; architecture: `architecture/containers.puml`, `architecture/openapi.yaml`)

| Id | Level | Severity | Rule | Message when it fails |
|----|-------|----------|------|-----------------------|
| I-CON-01 | 3 | block | At least one container in both the impact map and `containers.puml` has a keyword in `ALL` | `No impacted container found; mention the business area` |
| I-ADR-001, I-ADR-002, ... | 3 | block | One per entry in `adr-rules.yaml`: no `forbid_pattern` match, and if every `when_containers` is impacted, some `must_mention_any` word appears | the entry's `message` |
| I-CR-01 | 3 | block | No CR, or every impacted container is declared in some CR's impacted systems | `Warehouse Service impacted but not declared by CR-12` |
| I-UNK-01 | 3 | warn | Every "Something service/system" in `ALL` is a known container | `Not in containers.puml: Billing service` |
| I-SIZE-01 | 4 | warn | Impacted containers at most `max_containers` | `Touches 3 containers; consider splitting` |
| I-OWN-01 | 4 | block | `NOTES` says "Data owner: X" and X is an impacted container | `Name the data owner in technical notes: "Data owner: <container>"` |
| I-EVT-01 | 4 | block | One container or none, or `NOTES` names an event (`StockReserved`) or an API path (`/v1/...`) | `Several containers impacted; name the event (e.g. StockReserved) or API path` |
| I-API-01 | 4 | warn | Every API path in `NOTES` exists in `openapi.yaml` | `New endpoint needed: /v1/gift-wrap` |
| I-SEC-01 | 4 | warn | No `security_words` term in `ALL` | `Needs security review: payment` (also adds the label `needs-security-review`) |

Rules always publishes 14 results. Impact publishes 10: 8 fixed checks plus one per ADR rule.

## How to change a rule

1. **Edit the yaml** of the service that owns the rule. Only that service may read it (ADR-001).
   For example, add a word to `vague_words` in `services/rules/rules.yaml`.
2. **Add a test** in that service's `test/checks.test.js` that fails without your change and passes with it.
   Run it with `docker compose run --rm --no-deps rules npm test`.
3. **Rebuild one service**: `docker compose up -d --build rules`. Nothing else restarts.
   A new check id also needs a row in this file and in `docs/maturity-levels.md` if it blocks.
