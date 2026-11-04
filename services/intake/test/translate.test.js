// Unit tests for the anti-corruption layer: story card in, event fields out.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test, and a story card as the simulator returns it.
const translate = require("../translate");
const card = require("./fixtures/card-NORTH-1.json");

test("the card becomes exactly the story object of the StoryChanged example", function () {
  assert.deepEqual(translate.translateStory(card), {
    summary: "[Cart] Reserve stock",
    as_a: "customer",
    i_want: "my items reserved",
    so_that: "they don't sell out",
    acceptance_criteria: "Stock should be reserved quickly at checkout. Reservation time TBD.",
    technical_notes: "",
    due_date: null,
    status: "Refinement",
    links: [
      { relation: "implements", key: "CR-12", issue_type: "Change Request", status: "Approved" }
    ]
  });
});

test("every relation is kept, unknown ones are dropped", function () {
  const links = translate.translateLinks([
    { relation: "implements", key: "CR-1", type: "Change Request", status: "Approved" },
    { relation: "is_implemented_by", key: "NORTH-5", type: "Story", status: "Done" },
    { relation: "blocks", key: "NORTH-6", type: "Story", status: "Done" },
    { relation: "is_blocked_by", key: "NORTH-9", type: "Story", status: "Refinement" },
    { relation: "clones", key: "NORTH-10", type: "Story", status: "Done" }
  ]);
  assert.deepEqual(links.map(function (l) { return l.relation; }), ["implements", "is_implemented_by", "blocks", "is_blocked_by"]);
  assert.deepEqual(links[3], { relation: "is_blocked_by", key: "NORTH-9", issue_type: "Story", status: "Refinement" });
});

test("missing text becomes empty, missing lists become [], missing dates become null", function () {
  const story = translate.translateStory({ key: "NORTH-2", summary: "x", status: "Refinement" });
  assert.equal(story.as_a, "");
  assert.equal(story.technical_notes, "");
  assert.equal(story.due_date, null);
  assert.deepEqual(story.links, []);
  const cr = translate.translateChangeRequest({ key: "CR-1", status: "Draft" });
  assert.deepEqual(cr, { key: "CR-1", status: "Draft", impacted_systems: [], in_scope: [], out_of_scope: [], target_date: null, updated_at: "" });
});

test("a CR card becomes one change_requests entry", function () {
  const crCard = {
    key: "CR-12",
    type: "Change Request",
    status: "Approved",
    impactedSystems: ["Checkout"],
    inScope: ["reserve stock during checkout", "release unpaid reservations"],
    outOfScope: ["discount", "delivery fee"],
    targetDate: "2026-12-15",
    updated: "2026-11-03T08:59:59.900Z"
  };
  const event = translate.buildStoryChanged(card, [crCard], "links_changed", "5b0f6c1e-2d7a-4f43-9a51-0c6b8f1d2e10", "2026-11-03T09:00:00.400Z");
  assert.equal(event.type, "StoryChanged");
  assert.equal(event.version, 1);
  assert.equal(event.story_key, "NORTH-1");
  assert.equal(event.story_updated_at, "2026-11-03T09:00:00.250Z");
  assert.deepEqual(event.change_requests, [{
    key: "CR-12",
    status: "Approved",
    impacted_systems: ["Checkout"],
    in_scope: ["reserve stock during checkout", "release unpaid reservations"],
    out_of_scope: ["discount", "delivery fee"],
    target_date: "2026-12-15",
    updated_at: "2026-11-03T08:59:59.900Z"
  }]);
  assert.deepEqual(translate.implementedCrKeys(event.story), ["CR-12"]);
});
