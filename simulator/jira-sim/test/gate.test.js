// Unit tests for the Ready for Dev gate, run through the simulator's own transition code.
// Each test builds a story in a fresh store, sets its readiness, then tries the transition.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test.
const { createStore } = require("../store");
const gate = require("../gate");

// A fresh store with a CR and a story. linkCr decides whether the story implements the CR.
function setup(linkCr) {
  const store = createStore({ botAccount: "story-readiness-bot", overrideRoles: ["architect", "product-owner"], baseUrl: "http://jira-sim:3000" });
  store.createIssue({ key: "CR-12", fields: { project: { key: "CR" }, issuetype: { name: "Change Request" }, summary: "Reserve stock", status: "Approved" } }, "ba.user");
  store.createIssue({ key: "NORTH-1", fields: { project: { key: "NORTH" }, issuetype: { name: "Story" }, summary: "[Cart] Reserve stock" } }, "ba.user");
  if (linkCr) {
    store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  }
  return store;
}

// Write a grade for the version that is saved right now.
function grade(store, level) {
  const updated = store.getIssue("NORTH-1").fields.updated;
  store.setProperty("NORTH-1", "readiness", { state: "Graded", level: level, story_updated_at: updated });
}

// Try Ready for Dev and return the error, or null if it was allowed.
function tryReady(store, override) {
  const body = { transition: { id: "21" } };
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
  assert.equal(store.getIssue("NORTH-1").fields.status.name, "Ready for Dev");
});

test("400 at L3, with errors.readiness L3", function () {
  const store = setup(true);
  grade(store, 3);
  const err = tryReady(store);
  assert.equal(err.status, 400);
  assert.match(err.body.errorMessages[0], /not ready for development/);
  assert.equal(err.body.errors.readiness, "L3");
  assert.equal(store.getIssue("NORTH-1").fields.status.name, "Refinement");
});

test("400 when story_updated_at is stale", function () {
  const store = setup(true);
  store.setProperty("NORTH-1", "readiness", { state: "Graded", level: 4, story_updated_at: "2026-01-01T00:00:00.000Z" });
  const err = tryReady(store);
  assert.equal(err.status, 400);
  assert.equal(err.body.errors.readiness, "Pending");
});

test("400 when the story is still Pending", function () {
  const store = setup(true);
  const err = tryReady(store);
  assert.equal(err.status, 400);
  assert.equal(err.body.errors.readiness, "Pending");
});

test("400 without a CR link, even at L4", function () {
  const store = setup(false);
  grade(store, 4);
  const err = tryReady(store);
  assert.equal(err.status, 400);
  assert.equal(err.body.errors.readiness, "L4");
});

test("override allowed with a valid role and reason, and leaves a trace", function () {
  const store = setup(true);
  grade(store, 2);
  assert.equal(tryReady(store, { by: "lead.architect", role: "architect", reason: "Agreed with the PO for the demo" }), null);
  const issue = store.getIssue("NORTH-1");
  assert.equal(issue.fields.status.name, "Ready for Dev");
  assert.equal(issue.properties.override.by, "lead.architect");
  assert.equal(issue.fields.comment.comments[0].body, "Override by lead.architect (architect): Agreed with the PO for the demo");
  assert.equal(issue.fields.comment.comments[0].author.accountId, "ba.user");
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

test("other transitions follow the table", function () {
  const store = setup(true);
  // In Progress is allowed only from Ready for Dev.
  assert.throws(function () { store.transition("NORTH-1", { transition: { id: "31" } }, "ba.user"); }, function (err) {
    return err.status === 400 && err.body.errorMessages[0] === "Transition not allowed from Refinement";
  });
  // Refinement is allowed from anywhere, by name too.
  store.transition("NORTH-1", { transition: { name: "Refinement" } }, "ba.user");
  assert.equal(gate.isValidOverride({ by: "a", role: "product-owner", reason: "12345" }, ["architect", "product-owner"]), true);
});
