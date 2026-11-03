// INVEST checks that a rule can decide: Valuable, Negotiable, Small and Independent.
// R-INV-V (level 1, warn), R-INV-N (4, warn), R-INV-S (4, warn), R-INV-I (4, block).
// Whether a story is truly valuable stays a human call; these only catch the obvious.

// The shared text helpers. This service keeps its own copy (ADR-001).
const { findTerms, normaliseName, result } = require("../match");
const { storyTexts } = require("./wording");
const { acLines } = require("./acceptance");

function investChecks(event, config) {
  const story = event.story;
  const text = storyTexts(story);

  // R-INV-V: "so that" states a benefit, not a repeat of "I want".
  const want = normaliseName(story.i_want || "");
  const benefit = normaliseName(story.so_that || "");
  const invV = want !== "" && benefit !== "" && want !== benefit
    ? result("R-INV-V", 1, "warn", true, "So that states a benefit")
    : result("R-INV-V", 1, "warn", false, "So that repeats I want; state the benefit");

  // R-INV-I: no "depends on" style phrase, and no open "is blocked by" link.
  const phrases = [];
  for (const pattern of config.invest.dependency_phrases) {
    const match = new RegExp(pattern, "i").exec(text.ALL);
    if (match) {
      phrases.push(match[0]);
    }
  }
  const blockers = (story.links || [])
    .filter(function (l) { return l.relation === "is_blocked_by" && l.status !== "Done"; })
    .map(function (l) { return l.key; });
  const dependsOn = phrases.concat(blockers);
  const invI = dependsOn.length === 0
    ? result("R-INV-I", 4, "block", true, "Independent")
    : result("R-INV-I", 4, "block", false, "Depends on other work: " + dependsOn.join(", "));

  // R-INV-N: no implementation detail in the story itself. It belongs in technical notes.
  const detail = findTerms(text.STORY, config.invest.implementation_words);
  const invN = detail.length === 0
    ? result("R-INV-N", 4, "warn", true, "No implementation detail in the story")
    : result("R-INV-N", 4, "warn", false, "Implementation detail belongs in technical notes: " + detail.join(", "));

  // R-INV-S: not too many criteria.
  const count = acLines(story).length;
  const invS = count <= config.acceptance.max_criteria
    ? result("R-INV-S", 4, "warn", true, "Size OK")
    : result("R-INV-S", 4, "warn", false, count + " criteria; consider splitting");

  return [invV, invI, invN, invS];
}

module.exports = { investChecks: investChecks };
