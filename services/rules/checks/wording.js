// Wording checks: R-VAG-01 (unmeasurable words) and R-OPQ-01 (open questions).
// Level 2, blocking. "Quickly" and "TBD" cannot be tested.
// This file also builds the three texts the checks read (section 9.1 of the build spec).

// The shared text helpers. This service keeps its own copy (ADR-001).
const { findTerms, result } = require("../match");

// The texts a check can look in. A missing field counts as "".
//   ALL   = summary, i_want, so_that, acceptance_criteria, technical_notes
//   STORY = i_want, so_that, acceptance_criteria
//   NOTES = technical_notes
function storyTexts(story) {
  function field(name) {
    return story[name] === undefined || story[name] === null ? "" : String(story[name]);
  }
  return {
    ALL: [field("summary"), field("i_want"), field("so_that"), field("acceptance_criteria"), field("technical_notes")].join("\n"),
    STORY: [field("i_want"), field("so_that"), field("acceptance_criteria")].join("\n"),
    NOTES: field("technical_notes")
  };
}

// Put each found term in double quotes and join them with commas: "quickly", "fast".
function quoted(terms) {
  return terms.map(function (t) { return "\"" + t + "\""; }).join(", ");
}

function wordingChecks(event, config) {
  const text = storyTexts(event.story);

  // R-VAG-01: no vague word in I want, so that or the acceptance criteria.
  const vague = findTerms(text.STORY, config.vague_words);
  const vag01 = vague.length === 0
    ? result("R-VAG-01", 2, "block", true, "No unmeasurable words")
    : result("R-VAG-01", 2, "block", false, "Unmeasurable: " + quoted(vague) + ". Use a number");

  // R-OPQ-01: no open question anywhere in the story.
  const open = findTerms(text.ALL, config.open_questions);
  const opq01 = open.length === 0
    ? result("R-OPQ-01", 2, "block", true, "No open questions")
    : result("R-OPQ-01", 2, "block", false, "Open question left: " + quoted(open));

  return [vag01, opq01];
}

module.exports = { wordingChecks: wordingChecks, storyTexts: storyTexts };
