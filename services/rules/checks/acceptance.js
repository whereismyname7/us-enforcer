// Acceptance criteria checks: R-AC-01 (Given/When/Then) and R-AC-02 (a negative case).
// Level 2, blocking. A story at L2 is testable.

// The shared text helpers. This service keeps its own copy (ADR-001).
const { findTerms, result } = require("../match");

// Every non-empty, trimmed line of acceptance_criteria is one criterion.
function acLines(story) {
  return String(story.acceptance_criteria || "")
    .split("\n")
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line !== ""; });
}

function acceptanceChecks(event, config) {
  const lines = acLines(event.story);
  // The Given/When/Then shape, ignoring upper and lower case.
  const gwt = new RegExp(config.acceptance.gwt_pattern, "i");

  // R-AC-01: at least one criterion, and every one is Given/When/Then.
  let ac01;
  if (lines.length === 0) {
    ac01 = result("R-AC-01", 2, "block", false, "No acceptance criteria");
  } else {
    const notGwt = lines.filter(function (line) { return !gwt.test(line); });
    ac01 = notGwt.length === 0
      ? result("R-AC-01", 2, "block", true, lines.length + " criteria, all Given/When/Then")
      : result("R-AC-01", 2, "block", false, notGwt.length + " criteria are not Given/When/Then");
  }

  // R-AC-02: some criterion covers an error, an empty case or a refusal.
  const hasNegative = lines.some(function (line) { return findTerms(line, config.acceptance.negative_words).length > 0; });
  const ac02 = hasNegative
    ? result("R-AC-02", 2, "block", true, "Has a negative or error case")
    : result("R-AC-02", 2, "block", false, "Add a negative case (error, empty, not allowed)");

  return [ac01, ac02];
}

module.exports = { acceptanceChecks: acceptanceChecks, acLines: acLines };
