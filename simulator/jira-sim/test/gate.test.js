// Unit tests for the Ready for Dev gate, run through the simulator's own transition code.
// Each test builds a story in a fresh store, sets its readiness, then tries { "to": "Ready for Dev" }.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test.
const { createStore } = require("../store");
const gate = require("../gate");

// Our bot's account id, as in docker-compose.yml.
const BOT = "story-readiness-bot";

// A fresh store with a CR and a story. linkCr decides whether the story implements the CR.
function setup(linkCr) {
  const store = createStore({ botAccount: BOT, overrideRoles: ["architect", "product-owner"] });
  store.createIssue({ key: "CR-12", fields: { project: { key: "CR" }, issuetype: { name: "Change Request" }, summary: "Reserve stock", status: "Approved" } }, "ba.user");
  store.createIssue({ key: "NORTH-1", fields: { project: { key: "NORTH" }, issuetype: { name: "Story" }, summary: "[Cart] Reserve stock" } }, "ba.user");
  if (linkCr) {
    store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  }
  return store;
}

// Write a grade for the version saved right now, or for another time.
function grade(store, level, updatedAt) {
  store.writeReadiness("NORTH-1", { value: { state: "Graded", level: level, story_updated_at: updatedAt || store.getIssue("NORTH-1").updated } }, BOT);
}

// Try Ready for Dev and return the error, or null if it was allowed.
function tryReady(store, override) {
  const body = { to: "Ready for Dev" };
  if (override) {
    body.override = override;
  }
  try {
    store.transition("NORTH-1", body, "ba.user");
    return null;
  } catch (err) {
    return err;
  }
}

test("allowed at a fresh L4 with a CR link", function () {
  const store = setup(true);
  grade(store, 4);
  assert.equal(tryReady(store), null);
  assert.equal(store.getIssue("NORTH-1").status, "Ready for Dev");
});

test("400 at L3, with errors.readiness L3", function () {
  const store = setup(true);
  grade(store, 3);
  const err = tryReady(store);
  assert.equal(err.status, 400);
  assert.match(err.body.errorMessages[0], /not ready for development/);
  assert.equal(err.body.errors.readiness, "L3");
  assert.equal(store.getIssue("NORTH-1").status, "Refinement");
});

test("400 when the grade is for an older version", function () {
  const store = setup(true);
  grade(store, 4, "2026-01-01T00:00:00.000Z");
  const err = tryReady(store);
  assert.equal(err.status, 400);
  assert.equal(err.body.errors.readiness, "Pending");
});

test("400 when the story is still Pending", function () {
  const store = setup(true);
  assert.equal(tryReady(store).body.errors.readiness, "Pending");
});

test("400 without a CR link, even at L4", function () {
  const store = setup(false);
  grade(store, 4);
  const err = tryReady(store);
  assert.equal(err.status, 400);
  assert.equal(err.body.errors.readiness, "L4");
});

test("override allowed with a valid role and reason, and leaves one comment", function () {
  const store = setup(true);
  grade(store, 2);
  assert.equal(tryReady(store, { by: "lead.architect", role: "architect", reason: "Agreed with the PO for the demo" }), null);
  const card = store.getIssue("NORTH-1");
  assert.equal(card.status, "Ready for Dev");
  assert.equal(card.override.by, "lead.architect");
  assert.equal(card.comments.length, 1);
  assert.equal(card.comments[0].body, "Override by lead.architect (architect): Agreed with the PO for the demo");
  assert.equal(card.comments[0].author, "ba.user");
});

test("400 with a bad override: wrong role, no name, or a short reason", function () {
  const bad = [
    { by: "dev.user", role: "developer", reason: "I want it" },
    { by: "", role: "architect", reason: "Agreed with the PO" },
    { by: "lead.architect", role: "architect", reason: "ok" }
  ];
  for (const override of bad) {
    const store = setup(true);
    grade(store, 2);
    const err = tryReady(store, override);
    assert.equal(err.status, 400);
    assert.equal(err.body.errorMessages[0], "Override needs an allowed role, a name and a reason of at least 5 characters");
  }
});

test("only Ready for Dev and Refinement are allowed targets", function () {
  const store = setup(true);
  assert.throws(function () { store.transition("NORTH-1", { to: "Done" }, "ba.user"); }, function (err) { return err.status === 400; });
  assert.throws(function () { store.transition("CR-12", { to: "Refinement" }, "ba.user"); }, function (err) { return err.status === 400; });
  store.transition("NORTH-1", { to: "Refinement" }, "ba.user");
  assert.equal(gate.isValidOverride({ by: "a", role: "product-owner", reason: "12345" }, ["architect", "product-owner"]), true);
});
