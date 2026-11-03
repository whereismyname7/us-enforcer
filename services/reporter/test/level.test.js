// Unit tests for the level algorithm and for how a grade is built.
// Each fixture holds the Rules and Impact results for one row of section 10.2,
// with the level the build spec expects for that row.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// Node's built-in tools for files and paths.
const fs = require("fs");
const path = require("path");

// The code under test.
const { computeLevel } = require("../level");
const { buildGrade } = require("../consumer");

// Every fixture file in test/fixtures.
const FIXTURES = path.join(__dirname, "fixtures");
const fixtures = fs.readdirSync(FIXTURES)
  .filter(function (f) { return f.endsWith(".json"); })
  .map(function (f) { return JSON.parse(fs.readFileSync(path.join(FIXTURES, f), "utf8")); });

// One test per row: all results from both checkers together give the expected level.
for (const fx of fixtures) {
  test("10.2 row " + fx.row + " is L" + fx.expected_level, function () {
    const checks = fx.rules.checks.concat(fx.impact.checks);
    assert.equal(computeLevel(checks), fx.expected_level);
  });
}

test("all nine rows of 10.2 have a fixture", function () {
  assert.equal(fixtures.length, 9);
});

test("warnings never lower the level", function () {
  assert.equal(computeLevel([{ id: "I-SEC-01", level: 4, severity: "warn", passed: false, message: "x" }]), 4);
  assert.equal(computeLevel([{ id: "R-TPL-01", level: 1, severity: "block", passed: false, message: "x" }]), 0);
});

test("the v1 grade lists exactly the 8 blocking items, sorted by level then id", function () {
  const fx = fixtures.find(function (f) { return f.row === "v1-linked"; });
  const grade = buildGrade(fx.rules, fx.impact, fx.checked_at);
  assert.deepEqual(grade.failed.map(function (c) { return c.id; }), [
    "R-AC-01", "R-AC-02", "R-OPQ-01", "R-VAG-01", "I-ADR-002", "I-CR-01", "I-EVT-01", "I-OWN-01"
  ]);
  assert.deepEqual(grade.warnings, []);
  assert.equal(grade.state, "Graded");
  assert.equal(grade.level, 1);
  assert.equal(grade.source_event_id, fx.rules.source_event_id);
  assert.deepEqual(grade.impacted_containers, ["checkout", "warehouse"]);
  assert.deepEqual(grade.teams, ["Checkout Team", "Warehouse Team"]);
});

test("a grade's failed and warnings are sorted by level and then id", function () {
  // Results deliberately out of order.
  const rules = { story_updated_at: "t", source_event_id: "s", checks: [
    { id: "R-CR-02", level: 4, severity: "block", passed: false, message: "b" },
    { id: "R-INV-S", level: 4, severity: "warn", passed: false, message: "w2" },
    { id: "R-AC-02", level: 2, severity: "block", passed: false, message: "a" },
    { id: "R-INV-V", level: 1, severity: "warn", passed: false, message: "w1" },
    { id: "R-TPL-01", level: 1, severity: "block", passed: true, message: "ok" }
  ] };
  const impact = { facts: { impacted_containers: [], impacted_names: [], teams: [], labels: [] }, checks: [
    { id: "I-OWN-01", level: 4, severity: "block", passed: false, message: "c" },
    { id: "I-ADR-002", level: 3, severity: "block", passed: false, message: "d" },
    { id: "I-API-01", level: 4, severity: "warn", passed: false, message: "w3" }
  ] };
  const grade = buildGrade(rules, impact, "now");
  assert.deepEqual(grade.failed.map(function (c) { return c.id; }), ["R-AC-02", "I-ADR-002", "I-OWN-01", "R-CR-02"]);
  assert.deepEqual(grade.warnings.map(function (c) { return c.id; }), ["R-INV-V", "I-API-01", "R-INV-S"]);
  assert.deepEqual(grade.failed[0], { id: "R-AC-02", level: 2, message: "a" });
});

test("the fixed story is L4 with one warning and the security label", function () {
  const fx = fixtures.find(function (f) { return f.row === "v2-cr-updated"; });
  const grade = buildGrade(fx.rules, fx.impact, fx.checked_at);
  assert.equal(grade.level, 4);
  assert.deepEqual(grade.failed, []);
  assert.deepEqual(grade.warnings, [{ id: "I-SEC-01", level: 4, message: "Needs security review: payment" }]);
  assert.deepEqual(grade.labels, ["needs-security-review"]);
});
