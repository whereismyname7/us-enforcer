// Unit tests for every Impact check, using the sample stories as StoryChanged events
// and this service's own copies of Lab2's containers.puml and openapi.yaml.
// The expected results come from the table in section 10.2 of the build spec.

// The built-in test runner and strict assertions.
const test = require("node:test");
const assert = require("node:assert/strict");

// Node's built-in tools for files and paths.
const fs = require("fs");
const path = require("path");

// The code under test.
const { loadConfig, runChecks, buildResult, unknownMapContainers } = require("../consumer");
const { parseContainers } = require("../architecture");

// The fixtures folder holds the architecture copies, so tests never need the mounted folder.
const FIXTURES = path.join(__dirname, "fixtures");
const config = loadConfig(FIXTURES);

// Load one fixture event by name.
function fixture(name) {
  return require("./fixtures/" + name + ".json");
}

// The ids of failed checks of one severity, sorted so the order does not matter.
function failedIds(checks, severity) {
  return checks.filter(function (c) { return c.severity === severity && !c.passed; }).map(function (c) { return c.id; }).sort();
}

// One check result by id.
function byId(checks, id) {
  return checks.find(function (c) { return c.id === id; });
}

// The facts each impacted group must produce.
const CHECKOUT_WAREHOUSE = { impacted_containers: ["checkout", "warehouse"], impacted_names: ["Checkout Service", "Warehouse Service"], teams: ["Checkout Team", "Warehouse Team"] };
const CHECKOUT = { impacted_containers: ["checkout"], impacted_names: ["Checkout Service"], teams: ["Checkout Team"] };
const CATALOG = { impacted_containers: ["catalog"], impacted_names: ["Catalog Service"], teams: ["Catalog Team"] };
const WAREHOUSE = { impacted_containers: ["warehouse"], impacted_names: ["Warehouse Service"], teams: ["Warehouse Team"] };
const SECURITY = ["needs-security-review"];

// Each row of 10.2: the Impact ids that must fail, and the facts.
const rows = [
  { name: "v1-created", block: ["I-ADR-002", "I-OWN-01", "I-EVT-01"], warn: [], facts: CHECKOUT_WAREHOUSE, labels: [] },
  { name: "v1-linked", block: ["I-ADR-002", "I-CR-01", "I-EVT-01", "I-OWN-01"], warn: [], facts: CHECKOUT_WAREHOUSE, labels: [] },
  { name: "v2-cr-checkout-only", block: ["I-CR-01"], warn: ["I-SEC-01"], facts: CHECKOUT_WAREHOUSE, labels: SECURITY },
  { name: "v2-cr-updated", block: [], warn: ["I-SEC-01"], facts: CHECKOUT_WAREHOUSE, labels: SECURITY },
  { name: "v3-discount", block: [], warn: ["I-SEC-01"], facts: CHECKOUT_WAREHOUSE, labels: SECURITY },
  { name: "gift-wrap", block: ["I-OWN-01"], warn: [], facts: CHECKOUT, labels: [] },
  { name: "paused-demo", block: [], warn: [], facts: CATALOG, labels: [] },
  { name: "draft-cr", block: [], warn: ["I-SEC-01"], facts: CHECKOUT_WAREHOUSE, labels: SECURITY },
  { name: "l0-minimal", block: ["I-OWN-01"], warn: [], facts: WAREHOUSE, labels: [] }
];

// One test per row.
for (const row of rows) {
  test("10.2 row " + row.name + ": the expected Impact checks fail, with the right facts", function () {
    const outcome = runChecks(fixture(row.name), config);
    assert.deepEqual(failedIds(outcome.checks, "block"), row.block.slice().sort());
    assert.deepEqual(failedIds(outcome.checks, "warn"), row.warn.slice().sort());
    assert.deepEqual(outcome.facts, {
      impacted_containers: row.facts.impacted_containers,
      impacted_names: row.facts.impacted_names,
      teams: row.facts.teams,
      labels: row.labels
    });
  });
}

test("always 10 results: 8 fixed checks plus one per ADR rule", function () {
  for (const row of rows) {
    assert.equal(runChecks(fixture(row.name), config).checks.length, 10);
  }
});

test("the containers.puml parser finds the 8 Lab2 containers", function () {
  const containers = parseContainers(fs.readFileSync(path.join(FIXTURES, "containers.puml"), "utf8"));
  assert.deepEqual(containers, [
    { id: "gateway", name: "Gateway" },
    { id: "core", name: "NorthlineCore" },
    { id: "catalog", name: "Catalog Service" },
    { id: "checkout", name: "Checkout Service" },
    { id: "warehouse", name: "Warehouse Service" },
    { id: "catalog_db", name: "Catalog Data" },
    { id: "events", name: "Event Log" },
    { id: "sessions", name: "Session Store" }
  ]);
  assert.deepEqual(unknownMapContainers(config), []);
  assert.deepEqual(config.architecture.apiPaths, ["/v1/items/{id}", "/health"]);
});

test("ADR-001 forbid_pattern fails on reading the catalog product table directly", function () {
  const event = JSON.parse(JSON.stringify(fixture("paused-demo")));
  event.story.technical_notes = "Warehouse reads the catalog product table directly";
  const c = byId(runChecks(event, config).checks, "I-ADR-001");
  assert.equal(c.passed, false);
  assert.equal(c.message, "ADR-001: only Catalog may touch product data. Call GET /v1/items/{id} instead.");
  assert.equal(byId(runChecks(fixture("paused-demo"), config).checks, "I-ADR-001").message, "ADR-001 respected");
});

test("exact messages for the v1 story and the fixed v2 story", function () {
  const v1 = runChecks(fixture("v1-linked"), config).checks;
  assert.equal(byId(v1, "I-CON-01").message, "Impacted: Checkout Service, Warehouse Service");
  assert.equal(byId(v1, "I-CR-01").message, "Warehouse Service impacted but not declared by CR-12");
  assert.equal(byId(v1, "I-OWN-01").message, "Name the data owner in technical notes: \"Data owner: <container>\"");
  assert.equal(byId(v1, "I-EVT-01").message, "Several containers impacted; name the event (e.g. StockReserved) or API path");
  const v2 = runChecks(fixture("v2-cr-updated"), config).checks;
  assert.equal(byId(v2, "I-SEC-01").message, "Needs security review: payment");
  assert.equal(byId(v2, "I-OWN-01").message, "Data owner: Warehouse");
  assert.equal(byId(v2, "I-EVT-01").message, "Named: StockReserved");
  assert.equal(byId(v2, "I-CR-01").message, "All impacted containers are declared by the CR");
  assert.equal(byId(runChecks(fixture("gift-wrap"), config).checks, "I-CR-01").message, "No CR linked (see R-CR-01)");
});

test("unknown components, size and API paths", function () {
  const event = JSON.parse(JSON.stringify(fixture("paused-demo")));
  event.story.technical_notes = "Data owner: Catalog. The Billing service calls /v1/items/{id} and /v1/gift-wrap. Also the Warehouse service and stock and checkout.";
  const checks = runChecks(event, config).checks;
  assert.equal(byId(checks, "I-UNK-01").message, "Not in containers.puml: Billing service");
  assert.equal(byId(checks, "I-SIZE-01").message, "Touches 3 containers; consider splitting");
  assert.equal(byId(checks, "I-API-01").message, "New endpoint needed: /v1/gift-wrap");
});

test("the result event copies the source fields and carries the facts", function () {
  const event = fixture("v2-cr-updated");
  const out = buildResult(event, runChecks(event, config));
  assert.equal(out.type, "StoryChecked");
  assert.equal(out.checker, "impact");
  assert.equal(out.source_event_id, event.event_id);
  assert.equal(out.source_occurred_at, event.occurred_at);
  assert.deepEqual(out.facts.labels, ["needs-security-review"]);
});
