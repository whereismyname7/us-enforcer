// The Reporter's writes to Jira, all as our bot (X-Actor: story-readiness-bot).
// The Reporter is the only service that writes to Jira, so this is the one place
// that has to cope with Jira being slow or down. Every call has a timeout.

// The plain-text comment builder.
const { buildComment } = require("./comment");

// The labels the Reporter owns. Every other label on the story is kept.
const OWN_LABEL = /^readiness-L[0-4]$/;
const SECURITY_LABEL = "needs-security-review";

// The transition back to Refinement.
const REFINEMENT_TRANSITION = "11";

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

  // Step 3 of grading: write one grade back to the story.
  // Returns { outcome: "written" | "superseded" | "missing", moved_back }.
  async function writeGrade(grade, storyKey) {
    const path = "/rest/api/3/issue/" + encodeURIComponent(storyKey);

    // 1. Read the story. If it changed since it was checked, a newer check is already on its way.
    const read = await call("GET", path);
    if (read.status === 404) {
      return { outcome: "missing", moved_back: false };
    }
    expect(read, [200], "GET issue");
    const issue = read.body;
    if (issue.fields.updated !== grade.story_updated_at) {
      return { outcome: "superseded", moved_back: false };
    }

    // 2. Store the grade as the readiness property. The gate reads this.
    expect(await call("PUT", path + "/properties/readiness", grade), [200, 201, 204], "PUT readiness");

    // 3. Tell the BA what is missing, in plain words.
    expect(await call("POST", path + "/comment", { body: buildComment(grade) }), [201], "POST comment");

    // 4. Replace our own labels; keep everyone else's.
    const labels = (issue.fields.labels || []).filter(function (l) { return !OWN_LABEL.test(l) && l !== SECURITY_LABEL; });
    for (const l of ["readiness-L" + grade.level].concat(grade.labels || [])) {
      if (labels.indexOf(l) === -1) {
        labels.push(l);
      }
    }
    expect(await call("PUT", path, { fields: { labels: labels } }), [204], "PUT labels");

    // 5. A story already in Ready for Dev that dropped below L4, without an override, goes back.
    const status = issue.fields.status ? issue.fields.status.name : "";
    const overridden = !!(issue.properties && issue.properties.override);
    if (status === "Ready for Dev" && grade.level < 4 && !overridden) {
      expect(await call("POST", path + "/transitions", { transition: { id: REFINEMENT_TRANSITION } }), [204], "POST transition");
      expect(await call("POST", path + "/comment", { body: "Moved back to Refinement: readiness dropped to L" + grade.level + "." }), [201], "POST comment");
      return { outcome: "written", moved_back: true };
    }
    return { outcome: "written", moved_back: false };
  }

  return { writeGrade: writeGrade };
}

module.exports = { createJiraClient: createJiraClient };
