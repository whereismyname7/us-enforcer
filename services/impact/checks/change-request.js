// CR impact check: I-CR-01 (level 3, block).
// Every container the story touches must be declared in the CR's "Impacted systems".
// Declared impact (the CR) and detected impact (the C4 diagram) must agree.

// The shared text helpers. This service keeps its own copy (ADR-001).
const { normaliseName, result } = require("../match");
const { impactedContainers } = require("./containers");

function changeRequestImpactChecks(event, config) {
  const crs = event.change_requests || [];

  // No CR at all: R-CR-01 in the Rules service already blocks, so this check passes.
  if (crs.length === 0) {
    return [result("I-CR-01", 3, "block", true, "No CR linked (see R-CR-01)")];
  }

  // Every system any CR declares, made comparable.
  const declared = [];
  for (const cr of crs) {
    for (const system of cr.impacted_systems || []) {
      declared.push(normaliseName(system));
    }
  }

  // The impacted containers no CR declares, by id or by name.
  const undeclared = impactedContainers(event, config).filter(function (c) {
    return declared.indexOf(c.id) === -1 && declared.indexOf(normaliseName(c.name)) === -1;
  });

  if (undeclared.length === 0) {
    return [result("I-CR-01", 3, "block", true, "All impacted containers are declared by the CR")];
  }
  const names = undeclared.map(function (c) { return c.name; }).join(", ");
  const keys = crs.map(function (cr) { return cr.key; }).join(", ");
  return [result("I-CR-01", 3, "block", false, names + " impacted but not declared by " + keys)];
}

module.exports = { changeRequestImpactChecks: changeRequestImpactChecks };
