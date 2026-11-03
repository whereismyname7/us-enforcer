// Unit tests for every Rules check, using the sample stories as StoryChanged events.
// The expected results come from the table in section 10.2 of the build spec.
// The checks are pure functions, so nothing else needs to run.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test: the same path the service uses, and the text helpers.
const { loadConfig, runChecks, buildResult } = require("../consumer");
const { termRegex, findTerms } = require("../match");

// rules.yaml, loaded once.
const config = loadConfig();

// Load one fixture event by name.
function fixture(name) {
  return require("./fixtures/" + name + ".json");
}

// The ids of failed checks of one severity, sorted so the order does not matter.
function failedIds(checks, severity) {
  return checks.filter(function (c) { return c.severity === severity && !c.passed; }).map(function (c) { return c.id; }).sort();
}

// One check result by id.
function byId(checks, id) {
  return checks.find(function (c) { return c.id === id; });
}

// Each row of 10.2: the Rules ids that must fail (blocking, then warnings).
const rows = [
  { name: "v1-created", block: ["R-AC-01", "R-AC-02", "R-VAG-01", "R-OPQ-01", "R-CR-01", "R-CR-02"], warn: [] },
  { name: "v1-linked", block: ["R-AC-01", "R-AC-02", "R-OPQ-01", "R-VAG-01"], warn: [] },
  { name: "v2-cr-checkout-only", block: [], warn: [] },
  { name: "v2-cr-updated", block: [], warn: [] },
  { name: "v3-discount", block: ["R-CR-03"], warn: [] },
  { name: "gift-wrap", block: ["R-CR-01", "R-CR-02"], warn: [] },
  { name: "paused-demo", block: ["R-CR-01", "R-CR-02"], warn: [] },
  { name: "draft-cr", block: ["R-CR-02"], warn: [] },
  { name: "l0-minimal", block: ["R-TPL-01", "R-TPL-02", "R-AC-01", "R-AC-02", "R-CR-01", "R-CR-02"], warn: ["R-INV-V"] }
];

// One test per row.
for (const row of rows) {
  test("10.2 row " + row.name + ": the expected Rules checks fail", function () {
    const checks = runChecks(fixture(row.name), config);
    assert.deepEqual(failedIds(checks, "block"), row.block.slice().sort());
    assert.deepEqual(failedIds(checks, "warn"), row.warn.slice().sort());
  });
}

test("always 14 results, each with a known shape", function () {
  for (const row of rows) {
    const checks = runChecks(fixture(row.name), config);
    assert.equal(checks.length, 14);
    for (const c of checks) {
      assert.deepEqual(Object.keys(c), ["id", "level", "severity", "passed", "message"]);
    }
  }
});

test("exact messages for R-VAG-01, R-OPQ-01 and the v1 acceptance criteria", function () {
  const checks = runChecks(fixture("v1-linked"), config);
  assert.equal(byId(checks, "R-VAG-01").message, "Unmeasurable: \"quickly\". Use a number");
  assert.equal(byId(checks, "R-OPQ-01").message, "Open question left: \"TBD\"");
  assert.equal(byId(checks, "R-AC-01").message, "1 criteria are not Given/When/Then");
  assert.equal(byId(checks, "R-AC-02").message, "Add a negative case (error, empty, not allowed)");
  assert.equal(byId(checks, "R-CR-01").message, "Linked to CR-12");
});

test("exact message for R-CR-03 on scope creep", function () {
  const checks = runChecks(fixture("v3-discount"), config);
  assert.equal(byId(checks, "R-CR-03").message, "\"discount\" is out of scope for CR-12");
});

test("exact messages for a Draft CR, no CR and the L0 story", function () {
  assert.equal(byId(runChecks(fixture("draft-cr"), config), "R-CR-02").message, "CR-12 is Draft");
  assert.equal(byId(runChecks(fixture("gift-wrap"), config), "R-CR-01").message, "No Change Request linked");
  assert.equal(byId(runChecks(fixture("gift-wrap"), config), "R-CR-02").message, "No CR to check");
  const l0 = runChecks(fixture("l0-minimal"), config);
  assert.equal(byId(l0, "R-TPL-02").message, "Missing: as_a, so_that");
  assert.equal(byId(l0, "R-AC-01").message, "No acceptance criteria");
});

test("INVEST: a dependency phrase and an open blocker fail R-INV-I", function () {
  const event = JSON.parse(JSON.stringify(fixture("v2-cr-updated")));
  event.story.technical_notes = "This depends on the new pricing work.";
  event.story.links.push({ relation: "is_blocked_by", key: "NORTH-9", issue_type: "Story", status: "In Progress" });
  const c = byId(runChecks(event, config), "R-INV-I");
  assert.equal(c.passed, false);
  assert.equal(c.message, "Depends on other work: depends on, NORTH-9");
});

test("the result event copies the source fields", function () {
  const event = fixture("v1-linked");
  const out = buildResult(event, runChecks(event, config));
  assert.equal(out.type, "StoryChecked");
  assert.equal(out.version, 1);
  assert.equal(out.checker, "rules");
  assert.equal(out.source_event_id, event.event_id);
  assert.equal(out.source_occurred_at, event.occurred_at);
  assert.equal(out.story_updated_at, event.story_updated_at);
  assert.deepEqual(out.facts, {});
});

test("termRegex: reserv* matches reserved and reservation", function () {
  assert.equal(termRegex("reserv*").test("Stock is reserved"), true);
  assert.equal(termRegex("reserv*").test("Reservation time"), true);
});

test("termRegex: pay does not match payment", function () {
  assert.equal(termRegex("pay").test("When payment has not completed"), false);
  assert.equal(termRegex("pay").test("I pay by card"), true);
});

test("termRegex: ? matches any question mark", function () {
  assert.equal(termRegex("?").test("Is this right?"), true);
  assert.equal(termRegex("?").test("No question here."), false);
  assert.deepEqual(findTerms("Reserve it fast?", ["fast", "?", "quickly"]), ["fast", "?"]);
});
