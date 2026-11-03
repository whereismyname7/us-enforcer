// ADR checks: one check per entry in adr-rules.yaml, for example I-ADR-001 and I-ADR-002.
// Level 3, blocking. A story that breaks an accepted decision is not refined yet.

// The shared text helpers. This service keeps its own copy (ADR-001).
const { findTerms, result } = require("../match");
const { storyTexts, impactedContainers } = require("./containers");

function adrChecks(event, config) {
  const all = storyTexts(event.story).ALL;
  const impactedIds = impactedContainers(event, config).map(function (c) { return c.id; });

  return (config.adrRules.rules || []).map(function (rule) {
    const id = "I-" + rule.id;
    // Broken if the forbidden pattern appears, for example "reads the catalog product table".
    let broken = !!rule.forbid_pattern && new RegExp(rule.forbid_pattern, "i").test(all);
    // Broken if every listed container is impacted and the story never mentions the required word.
    const when = rule.when_containers || [];
    if (when.length > 0) {
      const allImpacted = when.every(function (c) { return impactedIds.indexOf(c) !== -1; });
      if (allImpacted && findTerms(all, rule.must_mention_any || []).length === 0) {
        broken = true;
      }
    }
    return broken
      ? result(id, 3, "block", false, rule.message)
      : result(id, 3, "block", true, rule.id + " respected");
  });
}

module.exports = { adrChecks: adrChecks };
