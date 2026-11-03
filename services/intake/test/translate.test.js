// Unit tests for the anti-corruption layer: Jira issue in, event fields out.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test, and the issue JSON from section 6.4 of the build spec.
const translate = require("../translate");
const issue = require("./fixtures/jira-issue-NORTH-1.json");

test("the 6.4 issue becomes exactly the story object of the 7.2 example", function () {
  assert.deepEqual(translate.translateStory(issue), {
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

test("each link type and side becomes the relation in section 7.4", function () {
  // A small helper that builds one Jira link from the story's point of view.
  function link(typeName, side, key) {
    const types = {
      Implements: { name: "Implements", inward: "implements", outward: "is implemented by" },
      Blocks: { name: "Blocks", inward: "blocks", outward: "is blocked by" }
    };
    const other = { key: key, fields: { issuetype: { name: "Story" }, status: { name: "Done" } } };
    const out = { type: types[typeName] };
    out[side] = other;
    return out;
  }
  const links = translate.translateLinks([
    link("Implements", "outwardIssue", "CR-1"),
    link("Implements", "inwardIssue", "NORTH-5"),
    link("Blocks", "outwardIssue", "NORTH-6"),
    link("Blocks", "inwardIssue", "NORTH-9")
  ]);
  assert.deepEqual(links.map(function (l) { return l.relation; }), ["implements", "is_implemented_by", "blocks", "is_blocked_by"]);
  assert.deepEqual(links[3], { relation: "is_blocked_by", key: "NORTH-9", issue_type: "Story", status: "Done" });
});

test("missing text becomes empty, missing lists become [], missing dates become null", function () {
  const bare = { key: "NORTH-2", fields: { summary: "x", status: { name: "Refinement" } } };
  const story = translate.translateStory(bare);
  assert.equal(story.as_a, "");
  assert.equal(story.technical_notes, "");
  assert.equal(story.due_date, null);
  assert.deepEqual(story.links, []);
  const cr = translate.translateChangeRequest({ key: "CR-1", fields: { status: { name: "Draft" } } });
  assert.deepEqual(cr, { key: "CR-1", status: "Draft", impacted_systems: [], in_scope: [], out_of_scope: [], target_date: null, updated_at: "" });
});

test("a CR becomes one change_requests entry", function () {
  const crIssue = {
    key: "CR-12",
    fields: {
      status: { name: "Approved" },
      impactedSystems: ["Checkout"],
      inScope: ["reserve stock during checkout", "release unpaid reservations"],
      outOfScope: ["discount", "delivery fee"],
      targetDate: "2026-12-15",
      updated: "2026-11-03T08:59:59.900Z"
    }
  };
  const event = translate.buildStoryChanged(issue, [crIssue], "links_changed", "5b0f6c1e-2d7a-4f43-9a51-0c6b8f1d2e10", "2026-11-03T09:00:00.400Z");
  assert.equal(event.type, "StoryChanged");
  assert.equal(event.version, 1);
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
