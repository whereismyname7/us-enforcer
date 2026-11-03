// Template checks: R-TPL-01 (the title) and R-TPL-02 (As a / I want / so that).
// Level 1, blocking. A story without these is not even a draft.
// Like every check, a pure function: (event, config) => [check, ...]. No I/O.

// The shared text helpers. This service keeps its own copy (ADR-001).
const { result } = require("../match");

function templateChecks(event, config) {
  const story = event.story;

  // R-TPL-01: the title looks like "[Area] Short phrase".
  const titleOk = new RegExp(config.template.title_pattern).test(story.summary || "");
  const tpl01 = titleOk
    ? result("R-TPL-01", 1, "block", true, "Title follows [Area] short phrase")
    : result("R-TPL-01", 1, "block", false, "Title must look like \"[Area] Short phrase\"");

  // R-TPL-02: every required field has some text in it. The blank ones are listed.
  const missing = config.template.required_fields.filter(function (name) {
    return String(story[name] || "").trim() === "";
  });
  const tpl02 = missing.length === 0
    ? result("R-TPL-02", 1, "block", true, "As a / I want / so that are filled")
    : result("R-TPL-02", 1, "block", false, "Missing: " + missing.join(", "));

  return [tpl01, tpl02];
}

module.exports = { templateChecks: templateChecks };
