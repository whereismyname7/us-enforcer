// Unit tests for the simulator's memory: keys, timestamps, readiness resets, the board and search.
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
  const store = createStore({ botAccount: BOT, overrideRoles: ["architect", "product-owner"], baseUrl: "http://jira-sim:3000", now: clock });
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

test("create with a given key keeps that key", function () {
  const { store } = newStore();
  const result = store.createIssue(storyBody("NORTH-7"), "ba.user");
  assert.equal(result.body.key, "NORTH-7");
  assert.equal(result.body.self, "http://jira-sim:3000/rest/api/v3/issue/NORTH-7");
  assert.equal(store.getIssue("NORTH-7").fields.status.name, "Refinement");
});

test("create without a key takes the next free number in the project", function () {
  const { store } = newStore();
  assert.equal(store.createIssue(storyBody(), "ba.user").body.key, "NORTH-1");
  assert.equal(store.createIssue(storyBody(), "ba.user").body.key, "NORTH-2");
  // A given key moves the counter on.
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

test("updated moves on a content change and on a link", function () {
  const { store, clock } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.createIssue(crBody(), "ba.user");
  const first = store.getIssue("NORTH-1").fields.updated;
  // A content field.
  clock.tick(10);
  store.updateIssue("NORTH-1", { fields: { acceptanceCriteria: "Given a, When b, Then c" } }, "ba.user");
  const second = store.getIssue("NORTH-1").fields.updated;
  assert.ok(second > first);
  // A link.
  clock.tick(10);
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  assert.ok(store.getIssue("NORTH-1").fields.updated > second);
});

test("updated does not move on status, labels, comments or properties", function () {
  const { store, clock } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  const before = store.getIssue("NORTH-1").fields.updated;
  clock.tick(10);
  store.transition("NORTH-1", { transition: { id: "11" } }, "ba.user");
  store.updateIssue("NORTH-1", { fields: { labels: ["readiness-L1"] } }, BOT);
  store.addComment("NORTH-1", "hello", BOT);
  store.setProperty("NORTH-1", "readiness", { state: "Graded", level: 1 });
  assert.equal(store.getIssue("NORTH-1").fields.updated, before);
});

test("two changes in the same millisecond still move updated forward", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  const before = store.getIssue("NORTH-1").fields.updated;
  // The clock does not move between the create and this edit.
  store.updateIssue("NORTH-1", { fields: { summary: "[Cart] Reserve stock now" } }, "ba.user");
  const after = store.getIssue("NORTH-1").fields.updated;
  assert.equal(Date.parse(after) - Date.parse(before), 1);
});

test("an edit with no real change sends no webhook", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  const result = store.updateIssue("NORTH-1", { fields: { summary: "[Cart] Reserve stock" } }, "ba.user");
  assert.equal(result.webhooks.length, 0);
});

test("a human edit resets readiness to Pending and removes the override", function () {
  const { store, clock } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.setProperty("NORTH-1", "readiness", { state: "Graded", level: 3 });
  store.setProperty("NORTH-1", "override", { by: "x", role: "architect", reason: "because" });
  clock.tick(5);
  store.updateIssue("NORTH-1", { fields: { technicalNotes: "Data owner: Warehouse." } }, "ba.user");
  const issue = store.getIssue("NORTH-1");
  assert.deepEqual(issue.properties.readiness, { state: "Pending", story_updated_at: issue.fields.updated });
  assert.equal(issue.properties.override, undefined);
});

test("a bot edit does not reset readiness", function () {
  const { store, clock } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.createIssue(crBody(), "ba.user");
  const graded = { state: "Graded", level: 3, story_updated_at: "x" };
  store.setProperty("NORTH-1", "readiness", graded);
  clock.tick(5);
  // The bot links a CR it found in the text. That is a content change, but by the bot.
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, BOT);
  assert.deepEqual(store.getIssue("NORTH-1").properties.readiness, graded);
});

test("links show the other issue on the right side", function () {
  const { store } = newStore();
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.createIssue(crBody(), "ba.user");
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  const storyLink = store.getIssue("NORTH-1").fields.issuelinks[0];
  assert.deepEqual(storyLink, {
    type: { name: "Implements", inward: "implements", outward: "is implemented by" },
    outwardIssue: { key: "CR-12", fields: { issuetype: { name: "Change Request" }, status: { name: "Approved" } } }
  });
  const crLink = store.getIssue("CR-12").fields.issuelinks[0];
  assert.equal(crLink.inwardIssue.key, "NORTH-1");
  // A duplicate link is ignored and sends no webhook.
  const again = store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  assert.equal(again.webhooks.length, 0);
  assert.equal(store.getIssue("NORTH-1").fields.issuelinks.length, 1);
});

test("the board lists only gate-passing or overridden stories", function () {
  const { store } = newStore();
  store.createIssue(crBody(), "ba.user");
  // NORTH-1: fresh L4 with a CR link, moved to Ready for Dev. On the board.
  store.createIssue(storyBody("NORTH-1"), "ba.user");
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-1" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  store.setProperty("NORTH-1", "readiness", { state: "Graded", level: 4, story_updated_at: store.getIssue("NORTH-1").fields.updated });
  store.transition("NORTH-1", { transition: { id: "21" } }, "ba.user");
  // NORTH-2: L2, overridden into Ready for Dev. On the board.
  store.createIssue(storyBody("NORTH-2"), "ba.user");
  store.setProperty("NORTH-2", "readiness", { state: "Graded", level: 2, story_updated_at: store.getIssue("NORTH-2").fields.updated });
  store.transition("NORTH-2", { transition: { id: "21" }, override: { by: "lead.architect", role: "architect", reason: "Agreed with the PO" } }, "ba.user");
  // NORTH-3: still in Refinement. Not on the board.
  store.createIssue(storyBody("NORTH-3"), "ba.user");
  // NORTH-4: was L4 in Ready for Dev, then the grade went stale. Not on the board.
  store.createIssue(storyBody("NORTH-4"), "ba.user");
  store.createLink({ type: { name: "Implements" }, inwardIssue: { key: "NORTH-4" }, outwardIssue: { key: "CR-12" } }, "ba.user");
  store.setProperty("NORTH-4", "readiness", { state: "Graded", level: 4, story_updated_at: store.getIssue("NORTH-4").fields.updated });
  store.transition("NORTH-4", { transition: { id: "21" } }, "ba.user");
  store.setProperty("NORTH-4", "readiness", { state: "Graded", level: 4, story_updated_at: "2020-01-01T00:00:00.000Z" });

  const board = store.board();
  assert.deepEqual(board.issues, [
    { key: "NORTH-1", summary: "[Cart] Reserve stock", level: 4, override: false },
    { key: "NORTH-2", summary: "[Cart] Reserve stock", level: 2, override: true }
  ]);
});

test("search parses project = LOAD and returns issues in key order", function () {
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
  assert.equal(result.issues[0].properties.readiness.state, "Pending");
  // maxResults limits the list but not the total.
  assert.equal(store.search("project = LOAD", "5").issues.length, 5);
});
