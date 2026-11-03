// Turns all check results for one story into one readiness level, L0 to L4.
// A level is reached only when every blocking check at that level and below has passed.

// checks: every result from Rules and Impact together.
function computeLevel(checks) {
  // Keep only the blocking checks that failed. Warnings never lower the level.
  const failedBlocking = checks.filter(function (c) { return c.severity === "block" && !c.passed; });
  // Nothing blocking failed, so the story is dev-ready.
  if (failedBlocking.length === 0) {
    return 4;
  }
  // The lowest failed level decides. A failure at L2 means the story is L1.
  const lowest = Math.min.apply(null, failedBlocking.map(function (c) { return c.level; }));
  return lowest - 1;
}

module.exports = { computeLevel: computeLevel };
