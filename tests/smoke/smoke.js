// The end-to-end smoke test: walks one story through the whole running system.
// Run with: docker compose run --rm smoke
// A plain Node 20 script with no libraries. It prints one PASS or FAIL line per step,
// then "ALL 14 STEPS PASSED" or "<n> OF 14 STEPS FAILED", and exits 0 only if every step passed.

// Node's built-in tools for files and paths.
const fs = require("fs");
const path = require("path");

// Where the simulator and the gateway are, inside the Docker network.
const JIRA_URL = process.env.JIRA_URL || "http://jira-sim:3000";
const GATEWAY_URL = process.env.GATEWAY_URL || "http://gateway";

// The readiness API key, from the environment (a dev-only default in docker-compose.yml).
const API_KEY_VALUE = process.env.READINESS_API_KEY || "";

// The sample files, mounted read-only at /work/samples.
const SAMPLES = path.join(__dirname, "..", "..", "samples");

// Our bot's account id. Comments it writes are the readiness comments.
const BOT = "story-readiness-bot";

// Read one sample file as an object.
function sample(name) {
  return JSON.parse(fs.readFileSync(path.join(SAMPLES, name), "utf8"));
}

// Wait a number of milliseconds.
function pause(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Call the simulator as a person (X-Actor, default ba.user). Returns { status, headers, body }.
async function jira(method, urlPath, body, actor) {
  const res = await fetch(JIRA_URL + urlPath, {
    method: method,
    headers: { "Content-Type": "application/json", "X-Actor": actor || "ba.user" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  });
  const raw = await res.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    parsed = raw;
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

// Call the gateway. key true sends the API key. headers and rawBody are for the webhook step.
async function gw(method, urlPath, options) {
  const opts = options || {};
  const headers = Object.assign({}, opts.headers || {});
  if (opts.key) {
    headers["X-Api-Key"] = API_KEY_VALUE;
  }
  if (opts.rawBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(GATEWAY_URL + urlPath, { method: method, headers: headers, body: opts.rawBody, signal: AbortSignal.timeout(5000) });
  const raw = await res.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (err) {
    parsed = raw;
  }
  return { status: res.status, headers: res.headers, body: parsed };
}

// Poll a condition every 500 ms until it returns something truthy, or fail after timeoutMs.
async function waitFor(fn, what, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  let last;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) {
        return last;
      }
    } catch (err) {
      // Not ready yet. Try again.
    }
    await pause(500);
  }
  throw new Error("timed out waiting for " + what);
}

// Wait until a story is graded for the version saved right now, then return the issue.
async function waitForGrade(key) {
  return waitFor(async function () {
    const res = await jira("GET", "/rest/api/3/issue/" + key);
    const r = res.body && res.body.properties ? res.body.properties.readiness : null;
    if (r && r.state === "Graded" && r.story_updated_at === res.body.fields.updated) {
      return res.body;
    }
    return null;
  }, "a fresh grade on " + key);
}

// Read one issue.
async function getIssue(key) {
  return (await jira("GET", "/rest/api/3/issue/" + key)).body;
}

// The comments on an issue written by our bot.
function botComments(issue) {
  return issue.fields.comment.comments.filter(function (c) { return c.author.accountId === BOT; });
}

// Throw a clear "expected ..., got ..." error if a condition is false.
function check(ok, expected, got) {
  if (!ok) {
    throw new Error("expected " + expected + ", got " + JSON.stringify(got));
  }
}

// The ids of a list of checks.
function ids(list) {
  return (list || []).map(function (c) { return c.id; });
}

// Shared between steps.
const state = {};

// The 14 steps, in order.
const steps = [
  ["S0", "setup", async function () {
    // Wait up to 60 s for both services callers depend on.
    await waitFor(async function () { return (await gw("GET", "/v1/status/intake")).status === 200; }, "intake ready", 60000);
    await waitFor(async function () { return (await gw("GET", "/v1/status/reporter")).status === 200; }, "reporter ready", 60000);
    const statusIntake = await gw("GET", "/v1/status/intake");
    const statusReporter = await gw("GET", "/v1/status/reporter");
    const reset = await jira("POST", "/admin/reset");
    const chaos = await jira("POST", "/admin/chaos", sample("chaos-off.json"));
    const health = await gw("GET", "/health");
    for (const r of [statusIntake, statusReporter, reset, chaos, health]) {
      check(r.status >= 200 && r.status < 300, "2xx", r.status);
    }
    for (const r of [statusIntake, statusReporter, health]) {
      check(!!r.headers.get("x-request-id"), "an X-Request-Id header", null);
    }
  }],

  ["S1", "CR created", async function () {
    const res = await jira("POST", "/rest/api/3/issue", sample("crs/CR-12.json"));
    check(res.status === 201, "201", res.status);
    check(res.body.key === "CR-12", "key CR-12", res.body.key);
  }],

  ["S2", "weak story graded L1", async function () {
    const created = await jira("POST", "/rest/api/3/issue", sample("stories/reserve-stock-v1.json"));
    check(created.status === 201, "201 on create", created.status);
    const linked = await jira("POST", "/rest/api/3/issueLink", sample("link-NORTH-1-CR-12.json"));
    check(linked.status === 201, "201 on link", linked.status);
    const issue = await waitForGrade("NORTH-1");
    const r = issue.properties.readiness;
    check(r.level === 1, "level 1", r.level);
    const want = ["R-AC-01", "R-AC-02", "R-OPQ-01", "R-VAG-01", "I-ADR-002", "I-CR-01", "I-EVT-01", "I-OWN-01"];
    check(JSON.stringify(ids(r.failed)) === JSON.stringify(want), JSON.stringify(want), ids(r.failed));
    // The comment and labels are written just after the property, so allow them a moment.
    const done = await waitFor(async function () {
      const i = await getIssue("NORTH-1");
      const hasComment = botComments(i).some(function (c) { return c.body.indexOf("Story readiness: L1 of 4") === 0; });
      return hasComment && i.fields.labels.indexOf("readiness-L1") !== -1 ? i : null;
    }, "the L1 comment and label").catch(function () { return null; });
    const latest = done || (await getIssue("NORTH-1"));
    check(botComments(latest).some(function (c) { return c.body.indexOf("Story readiness: L1 of 4") === 0; }), "a bot comment starting \"Story readiness: L1 of 4\"", botComments(latest).map(function (c) { return c.body.split("\n")[0]; }));
    check(latest.fields.labels.indexOf("readiness-L1") !== -1, "label readiness-L1", latest.fields.labels);
  }],

  ["S3", "gate blocks below L4", async function () {
    const res = await jira("POST", "/rest/api/3/issue/NORTH-1/transitions", sample("transition-ready.json"));
    check(res.status === 400, "400", res.status);
    check(res.body.errorMessages[0].indexOf("not ready for development") !== -1, "\"not ready for development\"", res.body.errorMessages[0]);
    check(res.body.errors.readiness === "L1", "errors.readiness L1", res.body.errors.readiness);
    const issue = await getIssue("NORTH-1");
    check(issue.fields.status.name === "Refinement", "status Refinement", issue.fields.status.name);
  }],

  ["S4", "gateway readiness API needs the key", async function () {
    const without = await gw("GET", "/v1/stories/NORTH-1/readiness");
    check(without.status === 401, "401 without a key", without.status);
    check(without.body.error === "invalid_api_key", "invalid_api_key", without.body.error);
    const withKey = await gw("GET", "/v1/stories/NORTH-1/readiness", { key: true });
    check(withKey.status === 200, "200 with the key", withKey.status);
    check(withKey.body.level === 1, "level 1", withKey.body.level);
  }],

  ["S5", "fixed story graded L4", async function () {
    const crPut = await jira("PUT", "/rest/api/3/issue/CR-12", sample("crs/CR-12-update.json"));
    check(crPut.status === 204, "204 on the CR edit", crPut.status);
    const storyPut = await jira("PUT", "/rest/api/3/issue/NORTH-1", sample("stories/reserve-stock-v2.json"));
    check(storyPut.status === 204, "204 on the story edit", storyPut.status);
    const straight = await getIssue("NORTH-1");
    check(straight.properties.readiness.state === "Pending", "Pending straight after the edit", straight.properties.readiness.state);
    const issue = await waitForGrade("NORTH-1");
    const r = issue.properties.readiness;
    check(r.level === 4, "level 4", r.level);
    check(r.failed.length === 0, "no failed checks", ids(r.failed));
    check(JSON.stringify(ids(r.warnings)) === JSON.stringify(["I-SEC-01"]), "warnings [I-SEC-01]", ids(r.warnings));
    const labelled = await waitFor(async function () {
      const i = await getIssue("NORTH-1");
      return i.fields.labels.indexOf("readiness-L4") !== -1 && i.fields.labels.indexOf("needs-security-review") !== -1 ? i : null;
    }, "the L4 labels").catch(function () { return null; });
    const latest = labelled || (await getIssue("NORTH-1"));
    check(latest.fields.labels.indexOf("readiness-L4") !== -1 && latest.fields.labels.indexOf("needs-security-review") !== -1, "labels readiness-L4 and needs-security-review", latest.fields.labels);
  }],

  ["S6", "gate passes at L4", async function () {
    const res = await jira("POST", "/rest/api/3/issue/NORTH-1/transitions", sample("transition-ready.json"));
    check(res.status === 204, "204", res.status);
    const board = await jira("GET", "/board");
    check(board.body.issues.some(function (i) { return i.key === "NORTH-1"; }), "NORTH-1 on the board", board.body.issues);
  }],

  ["S7", "scope creep moves it back", async function () {
    const put = await jira("PUT", "/rest/api/3/issue/NORTH-1", sample("stories/reserve-stock-v3.json"));
    check(put.status === 204, "204 on the edit", put.status);
    const issue = await waitForGrade("NORTH-1");
    const r = issue.properties.readiness;
    check(r.level === 3, "level 3", r.level);
    check(JSON.stringify(ids(r.failed)) === JSON.stringify(["R-CR-03"]), "failed [R-CR-03]", ids(r.failed));
    check(r.failed[0].message === "\"discount\" is out of scope for CR-12", "the R-CR-03 message", r.failed[0].message);
    // The Reporter moves the story back, then comments. Wait for both.
    const back = await waitFor(async function () {
      const i = await getIssue("NORTH-1");
      const moved = botComments(i).some(function (c) { return c.body.indexOf("Moved back to Refinement") === 0; });
      return i.fields.status.name === "Refinement" && moved ? i : null;
    }, "status Refinement").catch(function () { return null; });
    const latest = back || (await getIssue("NORTH-1"));
    check(latest.fields.status.name === "Refinement", "status Refinement", latest.fields.status.name);
    check(botComments(latest).some(function (c) { return c.body.indexOf("Moved back to Refinement") === 0; }), "a bot comment starting \"Moved back to Refinement\"", botComments(latest).map(function (c) { return c.body.split("\n")[0]; }));
    const board = await jira("GET", "/board");
    check(!board.body.issues.some(function (i) { return i.key === "NORTH-1"; }), "NORTH-1 not on the board", board.body.issues);
  }],

  ["S8", "override lets it through with a trace", async function () {
    const res = await jira("POST", "/rest/api/3/issue/NORTH-1/transitions", sample("transition-override.json"));
    check(res.status === 204, "204", res.status);
    const issue = await getIssue("NORTH-1");
    check(issue.fields.status.name === "Ready for Dev", "status Ready for Dev", issue.fields.status.name);
    check(issue.fields.comment.comments.some(function (c) { return c.body.indexOf("Override by lead.architect (architect)") !== -1; }), "an override comment", null);
    const board = await jira("GET", "/board");
    const row = board.body.issues.find(function (i) { return i.key === "NORTH-1"; });
    check(!!row && row.override === true, "NORTH-1 on the board with override true", board.body.issues);
  }],

  ["S9", "story without a CR graded L2", async function () {
    const created = await jira("POST", "/rest/api/3/issue", sample("stories/gift-wrap.json"));
    check(created.status === 201, "201", created.status);
    const issue = await waitForGrade("NORTH-2");
    const r = issue.properties.readiness;
    check(r.level === 2, "level 2", r.level);
    check(ids(r.failed).indexOf("R-CR-01") !== -1, "failed includes R-CR-01", ids(r.failed));
    state.northTwoCheckedAt = r.checked_at;
  }],

  ["S10", "bad webhook signature refused", async function () {
    const res = await gw("POST", "/webhook", { rawBody: "{}", headers: { "X-Hub-Signature": "sha256=00" } });
    check(res.status === 401, "401", res.status);
    check(res.body.error === "bad_signature", "bad_signature", res.body.error);
  }],

  ["S11", "unknown route is JSON 404", async function () {
    const res = await gw("GET", "/nope");
    check(res.status === 404, "404", res.status);
    check(res.body.error === "route_not_found", "route_not_found", res.body.error);
    check(typeof res.body.request_id === "string" && res.body.request_id !== "", "a request_id", res.body.request_id);
  }],

  ["S12", "recheck through the gateway", async function () {
    const before = state.northTwoCheckedAt || (await getIssue("NORTH-2")).properties.readiness.checked_at;
    const res = await gw("POST", "/v1/stories/NORTH-2/recheck", { key: true });
    check(res.status === 202, "202", res.status);
    const after = await waitFor(async function () {
      const r = (await getIssue("NORTH-2")).properties.readiness;
      return r.state === "Graded" && r.checked_at !== before ? r.checked_at : null;
    }, "a new checked_at").catch(function () { return null; });
    check(!!after, "a new checked_at", before);
  }],

  ["S13", "no update loop", async function () {
    const first = (await getIssue("NORTH-1")).fields.comment.comments.length;
    await pause(3000);
    const issue = await getIssue("NORTH-1");
    check(issue.fields.comment.comments.length === first, first + " comments", issue.fields.comment.comments.length);
    const movedBack = issue.fields.comment.comments.filter(function (c) { return c.body.indexOf("Moved back") === 0; });
    check(movedBack.length === 1, "exactly one \"Moved back\" comment", movedBack.length);
  }]
];

// Run every step, print one line each, then the summary.
async function main() {
  let failures = 0;
  for (const [id, name, run] of steps) {
    try {
      await run();
      console.log("PASS " + id + " " + name);
    } catch (err) {
      failures = failures + 1;
      console.log("FAIL " + id + " " + name + " (" + err.message + ")");
    }
  }
  if (failures === 0) {
    console.log("ALL " + steps.length + " STEPS PASSED");
    process.exit(0);
  }
  console.log(failures + " OF " + steps.length + " STEPS FAILED");
  process.exit(1);
}

main();
