// Unit tests for the simulator's memory: keys, timestamps, readiness resets, the card, the board and search.
// Run with: npm test (which runs node --test). No network, no other container.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test.
const { createStore, parseJql } = require("../store");

// Our bot's account id, as in docker-compose.yml.
const BOT = "story-readiness-bot";

// A clock we control. Each call returns the current value; tick() moves it on.
function fakeClock() {
  let ms = Date.parse("2026-11-03T09:00:00.000Z");
  const clock = function () { return ms; };
  clock.tick = function (n) { ms = ms + n; };
  return clock;
}

// A fresh store with a fake clock.
function newStore() {
  const clock = fakeClock();
  const store = createStore({ botAccount: BOT, overrideRoles: ["architect", "product-owner"], now: clock });
  return { store: store, clock: clock };
}

// A minimal story body.
function storyBody(key) {
  const body = { fields: { project: { key: "NORTH" }, issuetype: { name: "Story" }, summary: "[Cart] Reserve stock", asA: "customer", iWant: "my items reserved", soThat: "they don't sell out" } };
  if (key) {
    body.key = key;
  }
  return body;
}

// A minimal approved CR body.
function crBody() {
  return { key: "CR-12", fields: { project: { key: "CR" }, issuetype: { name: "Change Request" }, summary: "Reserve stock", status: "Approved", impactedSystems: ["Checkout"] } };
}

// A grade for the version saved right now, written by the bot.
function grade(store, key, level, failed) {
  store.writeReadiness(key, { value: { state: "Graded", level: level, story_updated_at: store.getIssue(key).updated, checked_at: "x", failed: failed || [], warnings: [] } }, BOT);
}

test("create with a given key keeps that key, and answers only the key", function () {
  const { store } = newStore();
  const result = store.createIssue(storyBody("NORTH-7"), "ba.user");
  assert.deepEqual(result.body, { key: "NORTH-7" });
  assert.equal(store.getIssue("NORTH-7").status, "Refinement");
});

test("create without a key takes the next free number in the project", function () {
  const { store } = newStore();
  assert.equal(store.createIssue(storyBody(), "ba.user").body.key, "NORTH-1");
  assert.equal(store.createIssue(storyBody(), "ba.user").body.key, "NORTH-2");
  store.createIssue(storyBody("NORTH-10"), "ba.user");
  assert.equal(store.createIssue(storyBody(), "ba.user").body.key, "NORTH-11");
});

test("create with an existing key answers 409", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  assert.throws(function () { store.createIssue(storyBody("NORTH-1"), "ba.user"); }, function (err) { return err.status === 409; });
});

test("create without project, issuetype or summary answers 400", function () {
  const { store } = newStore();
  assert.throws(function () { store.createIssue({ fields: { issuetype: { name: "Story" } } }, "ba.user"); }, function (err) {
    return err.status === 400 && "project" in err.body.errors && "summary" in err.body.errors;
  });
});

test("the card shows level and status first, missing items as short lines, comments newest first", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  assert.equal(store.getIssue("NORTH-1").level, "Pending");
  store.writeReadiness("NORTH-1", { value: { state: "Graded", level: 1, story_updated_at: store.getIssue("NORTH-1").updated, checked_at: "t1", failed: [{ id: "R-AC-01", level: 2, message: "No acceptance criteria" }], warnings: [] }, comment: "first" }, BOT);
  store.writeReadiness("NORTH-1", { value: { state: "Graded", level: 1, story_updated_at: store.getIssue("NORTH-1").updated, checked_at: "t2", failed: [{ id: "R-AC-01", level: 2, message: "No acceptance criteria" }], warnings: [] }, comment: "second" }, BOT);
  const card = store.getIssue("NORTH-1");
  assert.deepEqual(Object.keys(card).slice(0, 4), ["key", "type", "level", "status"]);
  assert.equal(card.level, "L1");
  assert.deepEqual(card.missing, ["R-AC-01: No acceptance criteria"]);
  assert.deepEqual(card.comments.map(function (c) { return c.body; }), ["second", "first"]);
  assert.equal(card.comments[0].author, BOT);
  assert.equal(card.checkedAt, "t2");
});

test("updated moves on a content change and on a link", function () {
  const { store, clock } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.createIssue(crBody(), "ba.user");
  const first = store.getIssue("NORTH-1").updated;
  clock.tick(10);
  store.updateIssue("NORTH-1", { fields: { acceptanceCriteria: "Given a, When b, Then c" } }, "ba.user");
  const second = store.getIssue("NORTH-1").updated;
  assert.ok(second > first);
  clock.tick(10);
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  assert.ok(store.getIssue("NORTH-1").updated > second);
});

test("updated does not move on status, labels or a grade", function () {
  const { store, clock } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  const before = store.getIssue("NORTH-1").updated;
  clock.tick(10);
  store.transition("NORTH-1", { to: "Refinement" }, "ba.user");
  store.updateIssue("NORTH-1", { fields: { labels: ["readiness-L1"] } }, BOT);
  grade(store, "NORTH-1", 1);
  assert.equal(store.getIssue("NORTH-1").updated, before);
});

test("two changes in the same millisecond still move updated forward", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  const before = store.getIssue("NORTH-1").updated;
  store.updateIssue("NORTH-1", { fields: { summary: "[Cart] Reserve stock now" } }, "ba.user");
  assert.equal(Date.parse(store.getIssue("NORTH-1").updated) - Date.parse(before), 1);
});

test("an edit with no real change sends no webhook", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  assert.equal(store.updateIssue("NORTH-1", { fields: { summary: "[Cart] Reserve stock" } }, "ba.user").webhooks.length, 0);
});

test("a human edit resets readiness to Pending and removes the override", function () {
  const { store, clock } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  grade(store, "NORTH-1", 2);
  store.transition("NORTH-1", { to: "Ready for Dev", override: { by: "x", role: "architect", reason: "because" } }, "ba.user");
  clock.tick(5);
  store.updateIssue("NORTH-1", { fields: { technicalNotes: "Data owner: Warehouse." } }, "ba.user");
  const card = store.getIssue("NORTH-1");
  assert.equal(card.level, "Pending");
  assert.equal(card.override, null);
});

test("a bot edit does not reset readiness", function () {
  const { store, clock } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.createIssue(crBody(), "ba.user");
  grade(store, "NORTH-1", 3);
  clock.tick(5);
  // The bot links a CR it found in the text. The grade is now for an older version, so the card shows Pending,
  // but the stored grade was not wiped: no human edit happened.
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, BOT);
  assert.equal(store.getIssue("NORTH-1").level, "Pending");
  store.writeReadiness("NORTH-1", { value: { state: "Graded", level: 3, story_updated_at: store.getIssue("NORTH-1").updated, checked_at: "x", failed: [], warnings: [] } }, BOT);
  assert.equal(store.getIssue("NORTH-1").level, "L3");
});

test("links show from each side as a relation", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.createIssue(crBody(), "ba.user");
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  assert.deepEqual(store.getIssue("NORTH-1").links, [{ relation: "implements", key: "CR-12", type: "Change Request", status: "Approved" }]);
  assert.deepEqual(store.getIssue("CR-12").links, [{ relation: "is_implemented_by", key: "NORTH-1", type: "Story", status: "Refinement" }]);
  const again = store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  assert.equal(again.webhooks.length, 0);
});

test("one grade write adds at most one comment, sets labels and can move the story back", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  grade(store, "NORTH-1", 4);
  store.transition("NORTH-1", { to: "Refinement" }, "ba.user");
  store.writeReadiness("NORTH-1", { value: { state: "Graded", level: 3, story_updated_at: store.getIssue("NORTH-1").updated, checked_at: "x", failed: [], warnings: [] }, comment: "Moved back to Refinement: readiness dropped to L3.\n\nStory readiness: L3 of 4.", labels: ["readiness-L3"], status: "Refinement" }, BOT);
  const card = store.getIssue("NORTH-1");
  assert.equal(card.comments.length, 1);
  assert.deepEqual(card.labels, ["readiness-L3"]);
  assert.equal(card.status, "Refinement");
});

test("the board lists only gate-passing or overridden stories", function () {
  const { store } = newStore();
  store.createIssue(crBody(), "ba.user");
  // NORTH-1: fresh L4 with a CR link, moved to Ready for Dev. On the board.
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  grade(store, "NORTH-1", 4);
  store.transition("NORTH-1", { to: "Ready for Dev" }, "ba.user");
  // NORTH-2: L2, overridden into Ready for Dev. On the board.
  store.createIssue(storyBody("NORTH-2"), "ba.user");
  grade(store, "NORTH-2", 2);
  store.transition("NORTH-2", { to: "Ready for Dev", override: { by: "lead.architect", role: "architect", reason: "Agreed with the PO" } }, "ba.user");
  // NORTH-3: still in Refinement. Not on the board.
  store.createIssue(storyBody("NORTH-3"), "ba.user");
  // NORTH-4: was L4 in Ready for Dev, then the grade went stale. Not on the board.
  store.createIssue(storyBody("NORTH-4"), "ba.user");
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-4" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  grade(store, "NORTH-4", 4);
  store.transition("NORTH-4", { to: "Ready for Dev" }, "ba.user");
  store.writeReadiness("NORTH-4", { value: { state: "Graded", level: 4, story_updated_at: "2020-01-01T00:00:00.000Z" } }, BOT);

  assert.deepEqual(store.board().issues, [
    { key: "NORTH-1", summary: "[Cart] Reserve stock", level: "L4", override: false },
    { key: "NORTH-2", summary: "[Cart] Reserve stock", level: "L2", override: true }
  ]);
});

test("search parses project = LOAD and returns cards in key order", function () {
  assert.equal(parseJql("project = LOAD"), "LOAD");
  assert.equal(parseJql("project=LOAD"), "LOAD");
  assert.equal(parseJql("project = \"LOAD\""), "LOAD");
  assert.equal(parseJql("status = Done"), null);
  const { store } = newStore();
  for (let i = 0; i < 12; i++) {
    store.createIssue({ fields: { project: { key: "LOAD" }, issuetype: { name: "Story" }, summary: "[Catalog] Show product badge" } }, "ba.user");
  }
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  const result = store.search("project = LOAD", "1000");
  assert.equal(result.total, 12);
  assert.equal(result.issues[1].key, "LOAD-2");
  assert.equal(result.issues[11].key, "LOAD-12");
  assert.equal(result.issues[0].level, "Pending");
  assert.equal(store.search("project = LOAD", "5").issues.length, 5);
});
