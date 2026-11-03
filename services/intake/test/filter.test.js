// Unit tests for filter.js: one test per row of the table in section 8.1 of the build spec.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test, and one webhook payload per row.
const filter = require("../filter");
const webhooks = require("./fixtures/webhooks.json");

// Our bot's account id, as in docker-compose.yml.
const BOT = "story-readiness-bot";

test("the bot's own event is ignored: bot_event", function () {
  assert.deepEqual(filter.decide(webhooks.bot_event, BOT), { act: false, reason: "bot_event", trigger: null });
});

test("a story created is acted on: story_created", function () {
  assert.deepEqual(filter.decide(webhooks.story_created, BOT), { act: true, reason: null, trigger: "story_created" });
});

test("a story content field changed is acted on: story_updated", function () {
  assert.deepEqual(filter.decide(webhooks.story_updated, BOT), { act: true, reason: null, trigger: "story_updated" });
});

test("only the story's links changed is acted on: links_changed", function () {
  assert.deepEqual(filter.decide(webhooks.links_changed, BOT), { act: true, reason: null, trigger: "links_changed" });
});

test("a status-only change is ignored: no_content_change", function () {
  assert.deepEqual(filter.decide(webhooks.no_content_change, BOT), { act: false, reason: "no_content_change", trigger: null });
});

test("a CR change is acted on for its stories: cr_changed", function () {
  assert.deepEqual(filter.decide(webhooks.cr_changed, BOT), { act: true, reason: null, trigger: "cr_changed" });
});

test("a CR created is ignored: cr_without_stories", function () {
  assert.deepEqual(filter.decide(webhooks.cr_without_stories, BOT), { act: false, reason: "cr_without_stories", trigger: null });
});

test("any other issue type is ignored: not_a_story", function () {
  assert.deepEqual(filter.decide(webhooks.not_a_story, BOT), { act: false, reason: "not_a_story", trigger: null });
});
