// Checks the X-Hub-Signature header on a Jira webhook.
// Jira signs the exact body bytes with a shared secret. If our signature matches, the call is genuine.
// A wrong, missing or changed signature means somebody else sent it, or the body was changed on the way.

// "crypto" is Node's built-in toolbox for hashes and signatures.
const crypto = require("crypto");

// Make the expected header value: "sha256=" plus the hex HMAC-SHA256 of the raw body.
function sign(rawBody, signingKey) {
  return "sha256=" + crypto.createHmac("sha256", signingKey).update(rawBody).digest("hex");
}

// True only if the header matches the body and the shared value exactly.
function verify(rawBody, header, signingKey) {
  // No header, or no value to check with, can never be valid.
  if (typeof header !== "string" || header === "" || !signingKey) {
    return false;
  }
  // Both sides as bytes, so we can compare them safely.
  const expected = Buffer.from(sign(rawBody, signingKey), "utf8");
  const given = Buffer.from(header, "utf8");
  // timingSafeEqual needs two buffers of the same length.
  if (expected.length !== given.length) {
    return false;
  }
  // Compare in constant time, so an attacker cannot learn the signature one character at a time.
  return crypto.timingSafeEqual(expected, given);
}

module.exports = { sign: sign, verify: verify };
