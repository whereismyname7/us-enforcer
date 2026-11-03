# Story Readiness Gate - Maturity Levels

Owner: BA Lead
Status: Accepted

A story is at a level only when every blocking check at that level and below has passed.
Warnings never lower the level. The algorithm is `services/reporter/level.js`.
"Ready for Dev" is allowed only at L4 (the gate, ADR-003).

---

| Level | Name | Meaning | Blocking checks that must pass | Example story (from `samples/`) |
|-------|------|---------|--------------------------------|----------------------------------|
| L0 | Not a draft | Not even the story shape | (an L1 check fails) | Summary `reserve stock`, I want `stock`, nothing else: no `[Area]` title, no As a / so that |
| L1 | Draft | Has the story shape | R-TPL-01, R-TPL-02 | `reserve-stock-v1.json`: "Stock should be reserved quickly at checkout. Reservation time TBD." |
| L2 | Defined | Testable | L1 plus R-AC-01, R-AC-02, R-VAG-01, R-OPQ-01 | `gift-wrap.json`: Given/When/Then with an "unavailable" case, but no CR linked |
| L3 | Refined | Impact known, no ADR conflict, linked to a CR | L2 plus R-CR-01, I-CON-01, I-ADR-001, I-ADR-002, I-CR-01 | `reserve-stock-v3.json`: like the fixed story, but adds a "discount" that CR-12 puts out of scope |
| L4 | Dev-ready | Can enter a sprint | L3 plus R-INV-I, R-CR-02, R-CR-03, I-OWN-01, I-EVT-01 | `reserve-stock-v2.json` with CR-12 declaring Checkout and Warehouse: event `StockReserved`, data owner Warehouse |

## What caps a level

- No acceptance criteria fails R-AC-01, so the story cannot pass L2: it stays L1 at best.
- No CR link fails R-CR-01, so the story cannot pass L3: it stays L2 at best.
- A CR that is not Approved fails R-CR-02, so the story stays L3.

## Pending

Between a save and its grade, a story is **Pending**. Pending is not a level. The gate treats it as "not ready",
so nothing half-checked reaches developers.
