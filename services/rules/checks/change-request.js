// Change Request checks: is the story requested, approved and in scope?
// R-CR-01 (level 3, block), R-CR-02 (4, block), R-CR-03 (4, block), R-CR-04 (4, warn).
// The CR data comes inside the event; Intake read it fresh from Jira (ADR-006).

// The shared text helpers. This service keeps its own copy (ADR-001).
const { findTerms, result } = require("../match");
const { storyTexts } = require("./wording");

function changeRequestChecks(event, config) {
  const crs = event.change_requests || [];
  const text = storyTexts(event.story);
  const keys = crs.map(function (cr) { return cr.key; });

  // R-CR-01: at least one CR is linked.
  const cr01 = crs.length > 0
    ? result("R-CR-01", 3, "block", true, "Linked to " + keys.join(", "))
    : result("R-CR-01", 3, "block", false, "No Change Request linked");

  // R-CR-02: every linked CR is approved.
  let cr02;
  if (crs.length === 0) {
    cr02 = result("R-CR-02", 4, "block", false, "No CR to check");
  } else {
    const notApproved = crs.filter(function (cr) { return cr.status !== config.change_request.approved_status; });
    cr02 = notApproved.length === 0
      ? result("R-CR-02", 4, "block", true, "CR approved")
      : result("R-CR-02", 4, "block", false, notApproved.map(function (cr) { return cr.key + " is " + cr.status; }).join("; "));
  }

  // R-CR-03: nothing the CR explicitly left out appears in the story.
  const outOfScope = [];
  for (const cr of crs) {
    for (const term of findTerms(text.ALL, cr.out_of_scope || [])) {
      outOfScope.push("\"" + term + "\" is out of scope for " + cr.key);
    }
  }
  const cr03 = outOfScope.length === 0
    ? result("R-CR-03", 4, "block", true, "Within CR scope")
    : result("R-CR-03", 4, "block", false, outOfScope.join("; "));

  // R-CR-04: the story is not due after the CR's target date. Dates compare as YYYY-MM-DD text.
  const late = crs.filter(function (cr) {
    return event.story.due_date && cr.target_date && event.story.due_date > cr.target_date;
  });
  const cr04 = late.length === 0
    ? result("R-CR-04", 4, "warn", true, "Due date fits the CR")
    : result("R-CR-04", 4, "warn", false, "Due after CR target date: " + late.map(function (cr) { return cr.key; }).join(", "));

  return [cr01, cr02, cr03, cr04];
}

module.exports = { changeRequestChecks: changeRequestChecks };
