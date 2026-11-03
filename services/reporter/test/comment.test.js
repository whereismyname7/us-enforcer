// Unit tests for the readiness comment: it must read exactly as the two texts in section 9.6.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test.
const { buildComment } = require("../comment");
const { buildGrade } = require("../consumer");

// The two fixtures that carry an expected comment.
const fixed = require("./fixtures/v2-cr-updated.json");
const weak = require("./fixtures/v1-linked.json");

test("the fixed story (v2) gets exactly the L4 comment", function () {
  const grade = buildGrade(fixed.rules, fixed.impact, fixed.checked_at);
  assert.equal(buildComment(grade), fixed.expected_comment);
});

test("the weak story (v1, linked to CR-12) gets exactly the L1 comment", function () {
  const grade = buildGrade(weak.rules, weak.impact, weak.checked_at);
  assert.equal(buildComment(grade), weak.expected_comment);
});

test("a story with no impact says so", function () {
  const text = buildComment({ level: 0, failed: [], warnings: [], impacted_names: [], teams: [], checked_at: "a", story_updated_at: "b" });
  assert.match(text, /^Story readiness: L0 of 4\. Fix the blocking items to reach L1\./);
  assert.match(text, /Impacted containers: none found/);
  assert.match(text, /Teams: none/);
});
