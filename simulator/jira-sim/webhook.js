// Sends signed webhooks the way Jira does, with a timeout and retries.
// The signature lets Intake prove the call really came from "Jira".
// Delivery happens after the simulator has answered its caller, so callers never wait for it.

// "crypto" is Node's built-in toolbox for hashes and signatures.
const crypto = require("crypto");

// How long one delivery attempt may take, in milliseconds.
const TIMEOUT_MS = 3000;

// How many attempts in total, and how long to wait before the 2nd and 3rd.
const WAITS_MS = [1000, 2000];

// Make the signature header: "sha256=" plus the HMAC-SHA256 of the exact body text.
function sign(rawBody, signingKey) {
  return "sha256=" + crypto.createHmac("sha256", signingKey).update(rawBody).digest("hex");
}

// Wait a number of milliseconds.
function pause(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Build a sender. Options: url, signingKey, log (the JSON log helper).
function createSender(options) {
  // Deliver one webhook body. Retries on a network error or any 5xx, up to 3 attempts.
  async function deliver(payload) {
    // Turn the body into text once, so the signature matches exactly what we send.
    const rawBody = JSON.stringify(payload);
    // Sign it with the shared secret.
    const signature = sign(rawBody, options.signingKey);
    // The issue this webhook is about, for the log line.
    const key = payload.issue.key;
    // The last status we saw, or null after a network error.
    let status = null;
    // Try up to 3 times.
    for (let attempt = 1; attempt <= WAITS_MS.length + 1; attempt++) {
      try {
        // POST the body with a timeout, so a dead gateway never holds us for long.
        const res = await fetch(options.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Hub-Signature": signature },
          body: rawBody,
          signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        status = res.status;
        // Read and drop the answer so the connection can be reused.
        await res.text();
        // Anything below 500 is a final answer. Only 2xx counts as delivered.
        if (status < 500) {
          if (status >= 200 && status < 300) {
            options.log({ level: "info", event: "webhook_delivered", key: key, webhook_event: payload.webhookEvent, attempts: attempt, status: status });
          } else {
            options.log({ level: "warn", event: "webhook_failed", key: key, webhook_event: payload.webhookEvent, attempts: attempt, status: status });
          }
          return;
        }
      } catch (err) {
        // A network error or a timeout. We will retry.
        status = null;
      }
      // Wait before the next attempt, if there is one.
      if (attempt <= WAITS_MS.length) {
        await pause(WAITS_MS[attempt - 1]);
      }
    }
    // Every attempt failed.
    options.log({ level: "warn", event: "webhook_failed", key: key, webhook_event: payload.webhookEvent, attempts: WAITS_MS.length + 1, status: status });
  }

  return { deliver: deliver };
}

module.exports = { createSender: createSender, sign: sign };
