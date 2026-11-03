// A circuit breaker for our writes to Jira, the same idea as Lab2's catalog service.
// A circuit breaker is the electrical fuse in your home, for software.
// After several failures in a row it stops trying for a while, so we fail fast
// instead of waiting on a Jira that is down.

// Build a breaker. Options: threshold (failures in a row), cooldownMs, log.
function createBreaker(options) {
  // How many failures in a row we have had.
  let failures = 0;
  // The time, in milliseconds, until which the breaker stays open.
  let openUntil = 0;

  // Is the breaker open right now?
  function isOpen() {
    return Date.now() < openUntil;
  }

  // Run one unit of work through the breaker.
  async function call(work, context) {
    // Read the clock once.
    const now = Date.now();
    // If the breaker is open, do not even try. Fail immediately.
    if (now < openUntil) {
      options.log(Object.assign({ level: "warn", event: "breaker_open", reopens_in_ms: openUntil - now }, context || {}));
      const err = new Error("circuit_open");
      // Retryable: the outbox will try again once the breaker closes.
      err.retryable = true;
      throw err;
    }
    try {
      const value = await work();
      // It worked, so reset the failure count to zero.
      failures = 0;
      return value;
    } catch (err) {
      // Only Jira being down counts: a timeout, a network error or a 5xx.
      if (err.retryable) {
        failures = failures + 1;
        // Enough failures in a row: open the breaker and stop trying for a while.
        if (failures >= options.threshold) {
          openUntil = Date.now() + options.cooldownMs;
          options.log(Object.assign({ level: "warn", event: "breaker_opened", failures: failures, cooldown_ms: options.cooldownMs }, context || {}));
        }
      }
      // Pass the failure up to the caller.
      throw err;
    }
  }

  return { call: call, isOpen: isOpen, failures: function () { return failures; } };
}

module.exports = { createBreaker: createBreaker };
