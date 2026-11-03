// Small text helpers shared by every check in this service.
// Each service keeps its own copy of this file. There is no shared code folder (ADR-001).

// Escape characters that have a special meaning inside a regular expression.
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Build one case-insensitive pattern for one word or phrase from a config file.
// "?" matches a question mark anywhere.
// "reserv*" (ending in a star) matches any word that starts with "reserv".
// Anything else must match as a whole word or phrase.
function termRegex(term) {
  if (term === "?") {
    return /\?/;
  }
  if (term.endsWith("*")) {
    return new RegExp("\\b" + escapeRegex(term.slice(0, -1)) + "\\w*", "i");
  }
  return new RegExp("(^|[^A-Za-z0-9])" + escapeRegex(term) + "(?=$|[^A-Za-z0-9])", "i");
}

// Return the configured terms found in a text, without their trailing star, in config order.
function findTerms(text, terms) {
  return terms
    .filter(function (term) { return termRegex(String(term)).test(text || ""); })
    .map(function (term) { return String(term).replace(/\*$/, ""); });
}

// Make two names comparable: "Warehouse Service", "warehouse" and "Warehouse" all become "warehouse".
function normaliseName(name) {
  return String(name).toLowerCase().replace(/\s+service$/, "").replace(/[^a-z0-9]/g, "");
}

// Build one check result in the shape every StoryChecked event uses.
function result(id, level, severity, passed, message) {
  return { id: id, level: level, severity: severity, passed: passed, message: message };
}

module.exports = { escapeRegex: escapeRegex, termRegex: termRegex, findTerms: findTerms, normaliseName: normaliseName, result: result };
