// Intake's only two calls to Jira: read an issue, and link a story to a CR.
// Every call has a timeout, so a slow Jira can never hold a webhook for long.
// Intake reads; it never writes grades. Only the Reporter writes those.

// The error we throw when Jira does not answer, times out, or answers 5xx.
// server.js turns it into 503 jira_unavailable, so the simulator retries the webhook.
class JiraUnavailable extends Error {}

// Build a client. Options: baseUrl, timeoutMs, actor (our bot's account id).
function createJiraClient(options) {
  // Make one HTTP call and return { status, body }.
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
      // A network error or a timeout.
      throw new JiraUnavailable(method + " " + path + " failed: " + err.message);
    }
    // A 5xx means Jira is in trouble right now.
    if (res.status >= 500) {
      throw new JiraUnavailable(method + " " + path + " answered " + res.status);
    }
    // Read the answer. Some answers, such as 201 for a link, have no body.
    const raw = await res.text();
    return { status: res.status, body: raw ? JSON.parse(raw) : null };
  }

  // Read one issue. Returns null if it does not exist.
  async function getIssue(key) {
    const result = await call("GET", "/rest/api/3/issue/" + encodeURIComponent(key));
    if (result.status === 404) {
      return null;
    }
    if (result.status !== 200) {
      throw new Error("GET issue " + key + " answered " + result.status);
    }
    return result.body;
  }

  // Link a story to a CR as the bot: "story Implements CR".
  async function linkImplements(storyKey, crKey) {
    const result = await call("POST", "/rest/api/3/issueLink", {
      type: { name: "Implements" },
      inwardIssue: { key: storyKey },
      outwardIssue: { key: crKey }
    });
    if (result.status !== 201) {
      throw new Error("POST issueLink answered " + result.status);
    }
  }

  return { getIssue: getIssue, linkImplements: linkImplements };
}

module.exports = { createJiraClient: createJiraClient, JiraUnavailable: JiraUnavailable };
