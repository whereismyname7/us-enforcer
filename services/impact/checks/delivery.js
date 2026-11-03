// Delivery checks: what a developer needs before the sprint starts.
// I-OWN-01 (data owner, block), I-EVT-01 (event or API named, block),
// I-API-01 (existing or new endpoint, warn), I-SEC-01 (security review, warn). All level 4.

// The shared text helpers. This service keeps its own copy (ADR-001).
const { findTerms, result } = require("../match");
const { storyTexts, impactedContainers, namesContainer } = require("./containers");

// "Data owner: Warehouse." in the technical notes.
const DATA_OWNER = /data owner:\s*([A-Za-z][A-Za-z ]*?)\s*(?:[.\n;,]|$)/i;

// An event name in the past tense, for example StockReserved.
const EVENT_NAME = /\b[A-Z][a-z]+(?:[A-Z][a-z]*)+ed\b/g;

// An API path, for example /v1/items/{id}.
const API_PATH = /\/v1\/[A-Za-z0-9/{}_-]+/g;

// Every distinct match of a pattern, in the order found.
function distinct(text, pattern) {
  return Array.from(new Set(text.match(pattern) || []));
}

function deliveryChecks(event, config) {
  const text = storyTexts(event.story);
  const impacted = impactedContainers(event, config);

  // I-OWN-01: the notes name the data owner, and it is one of the impacted containers.
  let own01;
  const owner = DATA_OWNER.exec(text.NOTES);
  if (!owner) {
    own01 = result("I-OWN-01", 4, "block", false, "Name the data owner in technical notes: \"Data owner: <container>\"");
  } else if (namesContainer(owner[1], impacted)) {
    own01 = result("I-OWN-01", 4, "block", true, "Data owner: " + owner[1]);
  } else {
    own01 = result("I-OWN-01", 4, "block", false, "Data owner " + owner[1] + " is not an impacted container");
  }

  // I-EVT-01: when several containers are touched, the notes name the event or API that joins them.
  const apiPaths = distinct(text.NOTES, API_PATH);
  const named = distinct(text.NOTES, EVENT_NAME).concat(apiPaths);
  let evt01;
  if (named.length > 0) {
    evt01 = result("I-EVT-01", 4, "block", true, "Named: " + named.join(", "));
  } else if (impacted.length <= 1) {
    evt01 = result("I-EVT-01", 4, "block", true, "Single container; no event needed");
  } else {
    evt01 = result("I-EVT-01", 4, "block", false, "Several containers impacted; name the event (e.g. StockReserved) or API path");
  }

  // I-API-01: every API path named already exists in openapi.yaml; otherwise a new endpoint is needed.
  let api01;
  if (apiPaths.length === 0) {
    api01 = result("I-API-01", 4, "warn", true, "No API named");
  } else {
    const missing = apiPaths.filter(function (p) { return config.architecture.apiPaths.indexOf(p) === -1; });
    api01 = missing.length === 0
      ? result("I-API-01", 4, "warn", true, "Reuses " + apiPaths.join(", "))
      : result("I-API-01", 4, "warn", false, "New endpoint needed: " + missing.join(", "));
  }

  // I-SEC-01: no sensitive-data word anywhere. If there is one, a security review is needed.
  const sensitive = findTerms(text.ALL, config.impactMap.security_words || []);
  const sec01 = sensitive.length === 0
    ? result("I-SEC-01", 4, "warn", true, "No sensitive data words")
    : result("I-SEC-01", 4, "warn", false, "Needs security review: " + sensitive.join(", "));

  return [own01, evt01, api01, sec01];
}

module.exports = { deliveryChecks: deliveryChecks };
