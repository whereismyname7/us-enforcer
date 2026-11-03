// Unit tests for the webhook signature check.
// A test value that is clearly not a real secret, as the no-secrets fitness rule requires.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// The code under test.
const signature = require("../signature");

// The shared value used in these tests, and a wrong one.
const TEST_SIGNING_VALUE = "dev-only-test-secret";
const WRONG_SIGNING_VALUE = "dev-only-wrong-value";

// A webhook body, as the exact bytes Jira would send.
const body = Buffer.from(JSON.stringify({ webhookEvent: "jira:issue_created", issue: { key: "NORTH-1" } }), "utf8");

test("a valid signature passes", function () {
  const header = signature.sign(body, TEST_SIGNING_VALUE);
  assert.match(header, /^sha256=[0-9a-f]{64}$/);
  assert.equal(signature.verify(body, header, TEST_SIGNING_VALUE), true);
});

test("a signature made with the wrong value fails", function () {
  const header = signature.sign(body, WRONG_SIGNING_VALUE);
  assert.equal(signature.verify(body, header, TEST_SIGNING_VALUE), false);
});

test("a missing header fails", function () {
  assert.equal(signature.verify(body, undefined, TEST_SIGNING_VALUE), false);
  assert.equal(signature.verify(body, "", TEST_SIGNING_VALUE), false);
});

test("a changed body fails", function () {
  const header = signature.sign(body, TEST_SIGNING_VALUE);
  const changed = Buffer.from(body.toString("utf8").replace("NORTH-1", "NORTH-2"), "utf8");
  assert.equal(signature.verify(changed, header, TEST_SIGNING_VALUE), false);
});

test("a short or malformed header fails without throwing", function () {
  assert.equal(signature.verify(body, "sha256=00", TEST_SIGNING_VALUE), false);
});
