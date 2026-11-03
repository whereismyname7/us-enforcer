// The outbox: grades that could not be written to Jira wait in Redis and are retried.
// deliver() is the one way a grade reaches Jira. If Jira is down, the grade is saved, not lost.
// A loop runs every OUTBOX_RETRY_MS and repeats the write once the breaker is closed.

// Build the outbox. Options: store, jira, breaker, retryMs, log.
function createOutbox(options) {
  // The loop's timer, so we can stop it.
  let timer = null;
  // True while the loop is running, so two runs never overlap.
  let busy = false;

  // Log what a successful write did.
  function logOutcome(storyKey, result, extra) {
    if (result.outcome === "superseded") {
      options.log(Object.assign({ level: "info", event: "superseded", story_key: storyKey }, extra));
    }
    if (result.outcome === "missing") {
      options.log(Object.assign({ level: "warn", event: "story_missing", story_key: storyKey }, extra));
    }
    if (result.moved_back) {
      options.log(Object.assign({ level: "info", event: "moved_back", story_key: storyKey }, extra));
    }
  }

  // Try to write one grade now. Returns "written", "superseded", "missing", "outboxed" or "dropped".
  async function deliver(storyKey, grade) {
    const context = { story_key: storyKey, source_event_id: grade.source_event_id };
    try {
      // The whole write (read, property, comment, labels, move back) is one unit for the breaker.
      const result = await options.breaker.call(function () { return options.jira.writeGrade(grade, storyKey); }, context);
      logOutcome(storyKey, result, { source_event_id: grade.source_event_id });
      return result.outcome;
    } catch (err) {
      options.log({ level: "error", event: "jira_write_failed", story_key: storyKey, source_event_id: grade.source_event_id, reason: String(err.message), retryable: !!err.retryable });
      // Jira is down: keep the grade and try again later.
      if (err.retryable) {
        const entry = await options.store.saveOutbox(storyKey, grade);
        options.log({ level: "warn", event: "outbox_saved", story_key: storyKey, attempts: entry.attempts });
        return "outboxed";
      }
      // Jira refused the write itself (a 4xx). Retrying would not help.
      return "dropped";
    }
  }

  // One pass over every waiting grade.
  async function flushOnce() {
    // Without Redis there is nothing to read.
    if (!options.store.isReady()) {
      return;
    }
    for (const storyKey of await options.store.listOutbox()) {
      // While the breaker is open, wait for the cooldown.
      if (options.breaker.isOpen()) {
        return;
      }
      const entry = await options.store.getOutbox(storyKey);
      if (!entry) {
        continue;
      }
      try {
        const result = await options.breaker.call(function () { return options.jira.writeGrade(entry.grade, storyKey); }, { story_key: storyKey });
        // Done: remove it, unless a newer grade replaced it meanwhile.
        await options.store.deleteOutbox(storyKey, entry.grade.checked_at);
        options.log({ level: "info", event: "outbox_flushed", story_key: storyKey, attempts: entry.attempts, outcome: result.outcome, level_written: entry.grade.level });
        logOutcome(storyKey, result, { from: "outbox" });
      } catch (err) {
        if (err.retryable) {
          // Still down. Count the attempt and try again next time.
          await options.store.bumpOutbox(storyKey, entry.grade.checked_at);
          options.log({ level: "warn", event: "outbox_retry_failed", story_key: storyKey, attempts: entry.attempts + 1, reason: String(err.message) });
        } else {
          // Jira refused it for good. Drop it.
          await options.store.deleteOutbox(storyKey, entry.grade.checked_at);
          options.log({ level: "error", event: "outbox_dropped", story_key: storyKey, reason: String(err.message) });
        }
      }
    }
  }

  // Run flushOnce, then schedule the next run.
  async function tick() {
    if (!busy) {
      busy = true;
      try {
        await flushOnce();
      } catch (err) {
        options.log({ level: "error", event: "outbox_loop_failed", message: String(err.message) });
      }
      busy = false;
    }
    timer = setTimeout(tick, options.retryMs);
  }

  // Start the loop.
  function start() {
    timer = setTimeout(tick, options.retryMs);
  }

  // Stop the loop.
  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { deliver: deliver, flushOnce: flushOnce, start: start, stop: stop };
}

module.exports = { createOutbox: createOutbox };
