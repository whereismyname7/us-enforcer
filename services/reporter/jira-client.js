// The Reporter's writes to Jira, all as our bot (X-Actor: story-readiness-bot).
// The Reporter is the only service that writes to Jira, so this is the one place
// that has to cope with Jira being slow or down. Every call has a timeout.

// The plain-text comment builder.
const { buildComment } = require("./comment");

// The labels the Reporter owns. Every other label on the story is kept.
const OWN_LABEL = /^readiness-L[0-4]$/;
const SECURITY_LABEL = "needs-security-review";

// Each failed check as the card shows it: "R-AC-01: 1 criteria are not Given/When/Then".
function asLines(list) {
  return (list || []).map(function (c) { return c.id + ": " + c.message; });
}

// Does the card already show exactly this grade? Then the BA has already been told, and we add no comment.
function alreadyShown(card, grade) {
  return card.level === "L" + grade.level &&
    JSON.stringify(card.missing) === JSON.stringify(asLines(grade.failed)) &&
    JSON.stringify(card.warnings) === JSON.stringify(asLines(grade.warnings));
}

// Build a client. Options: baseUrl, timeoutMs, actor.
function createJiraClient(options) {
  // Make one HTTP call. Throws an error with retryable true when Jira is down.
  async function call(method, path, body) {
    let res;
    try {
      // AbortSignal.timeout cancels the call if it takes too long.
      res = await fetch(options.baseUrl + path, {
        method: method,
        headers: { "Content-Type": "application/json", "X-Actor": options.actor },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs)
      });
    } catch (err) {
      // A network error or a timeout: Jira is down for us.
      const e = new Error(method + " " + path + " failed: " + err.message);
      e.retryable = true;
      throw e;
    }
    // Read the answer. Many write answers have no body.
    const raw = await res.text();
    // A 5xx means Jira is in trouble: retry later.
    if (res.status >= 500) {
      const e = new Error(method + " " + path + " answered " + res.status);
      e.retryable = true;
      e.status = res.status;
      throw e;
    }
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  }

  // Throw a non-retryable error for an answer we did not expect, such as a 400.
  function expect(result, wanted, what) {
    if (wanted.indexOf(result.status) === -1) {
      const e = new Error(what + " answered " + result.status);
      e.retryable = false;
      e.status = result.status;
      throw e;
    }
  }

  // Step 3 of grading: write one grade back to the story, in one call with at most one comment.
  // Returns { outcome: "written" | "superseded" | "missing", moved_back, commented }.
  async function writeGrade(grade, storyKey) {
    const path = "/rest/api/v3/issue/" + encodeURIComponent(storyKey);

    // 1. Read the card. If the story changed since it was checked, a newer check is already on its way.
    const read = await call("GET", path);
    if (read.status === 404) {
      return { outcome: "missing", moved_back: false, commented: false };
    }
    expect(read, [200], "GET issue");
    const card = read.body;
    if (card.updated !== grade.story_updated_at) {
      return { outcome: "superseded", moved_back: false, commented: false };
    }

    // 2. Replace our own labels; keep everyone else's.
    const labels = (card.labels || []).filter(function (l) { return !OWN_LABEL.test(l) && l !== SECURITY_LABEL; });
    for (const l of ["readiness-L" + grade.level].concat(grade.labels || [])) {
      if (labels.indexOf(l) === -1) {
        labels.push(l);
      }
    }

    // 3. A story already in Ready for Dev that dropped below L4, without an override, goes back.
    const movedBack = card.status === "Ready for Dev" && grade.level < 4 && !card.override;

    // 4. One comment per change: none if the card already shows this grade, and the move back goes in the same comment.
    let comment = null;
    if (movedBack) {
      comment = "Moved back to Refinement: readiness dropped to L" + grade.level + ".\n\n" + buildComment(grade);
    } else if (!alreadyShown(card, grade)) {
      comment = buildComment(grade);
    }

    // 5. One call: the grade, the comment, the labels and the move back.
    const body = { value: grade, comment: comment, labels: labels, status: movedBack ? "Refinement" : null };
    expect(await call("PUT", path + "/readiness", body), [204], "PUT readiness");
    return { outcome: "written", moved_back: movedBack, commented: comment !== null };
  }

  return { writeGrade: writeGrade };
}

module.exports = { createJiraClient: createJiraClient };
