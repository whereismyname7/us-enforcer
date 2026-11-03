// The Reporter's Redis keys (section 8.4 of the build spec). The Reporter owns Redis.
//   seen:<event_id>             1, set with NX, 1 day     duplicate check
//   latest:<story_key>          newest source_occurred_at  stale check
//   partial:<source_event_id>   hash rules / impact, 1 hour
//   grade:<story_key>           the last grade
//   outbox:<story_key>          { grade, attempts, first_failed_at } waiting for Jira

// Load the Redis client. Redis is a small, very fast shared store.
const { createClient } = require("redis");

// How long each key lives, in seconds.
const SEEN_TTL_S = 24 * 60 * 60;
const PARTIAL_TTL_S = 60 * 60;

// Wait a number of milliseconds.
function pause(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Build the store. Options: url, log.
function createStore(options) {
  // Reconnect forever, waiting a little longer each time, up to 2 seconds.
  const client = createClient({
    url: options.url,
    socket: { reconnectStrategy: function (retries) { return Math.min(retries * 200, 2000); } }
  });
  // Log a Redis problem once, not on every reconnect attempt.
  let healthy = false;
  client.on("error", function (err) {
    if (healthy) {
      options.log({ level: "error", event: "redis_error", message: String(err.message) });
    }
    healthy = false;
  });
  client.on("ready", function () {
    healthy = true;
    options.log({ level: "info", event: "redis_connected", url: options.url });
  });

  // Connect, patiently. Keep trying until Redis answers; never exit.
  async function connect() {
    for (let attempt = 1; ; attempt++) {
      try {
        await client.connect();
        return;
      } catch (err) {
        options.log({ level: "warn", event: "redis_connect_failed", attempt: attempt, message: String(err.message) });
        await pause(2000);
      }
    }
  }

  // Is the connection usable right now?
  function isReady() {
    return client.isReady;
  }

  // PING with a 1 second limit, for /ready.
  async function ping() {
    const timeout = new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error("ping_timeout")); }, 1000).unref();
    });
    return Promise.race([client.ping(), timeout]);
  }

  // True the first time we see this event id; false for a repeat.
  async function markSeen(eventId) {
    const answer = await client.set("seen:" + eventId, "1", { NX: true, EX: SEEN_TTL_S });
    return answer === "OK";
  }

  // False if this result is older than the newest we have seen for the story.
  // Otherwise remember the newer time and return true.
  async function checkLatest(storyKey, occurredAt) {
    const key = "latest:" + storyKey;
    const latest = await client.get(key);
    if (latest && Date.parse(occurredAt) < Date.parse(latest)) {
      return false;
    }
    await client.set(key, occurredAt);
    return true;
  }

  // Save one checker's result and return every result saved so far for that StoryChanged.
  async function savePartial(sourceEventId, checker, json) {
    const key = "partial:" + sourceEventId;
    await client.hSet(key, checker, json);
    await client.expire(key, PARTIAL_TTL_S);
    return client.hGetAll(key);
  }

  // Forget the partial results once they have been graded, so a late repeat cannot grade twice.
  async function deletePartial(sourceEventId) {
    await client.del("partial:" + sourceEventId);
  }

  // Save and read the last grade of a story.
  async function saveGrade(storyKey, grade) {
    await client.set("grade:" + storyKey, JSON.stringify(grade));
  }
  async function getGrade(storyKey) {
    const raw = await client.get("grade:" + storyKey);
    return raw ? JSON.parse(raw) : null;
  }

  // Put a grade in the outbox. A newer grade replaces an older one for the same story.
  async function saveOutbox(storyKey, grade) {
    const existing = await getOutbox(storyKey);
    const entry = {
      grade: grade,
      attempts: existing ? existing.attempts + 1 : 1,
      first_failed_at: existing ? existing.first_failed_at : new Date().toISOString()
    };
    await client.set("outbox:" + storyKey, JSON.stringify(entry));
    return entry;
  }

  // Read one outbox entry, or null.
  async function getOutbox(storyKey) {
    const raw = await client.get("outbox:" + storyKey);
    return raw ? JSON.parse(raw) : null;
  }

  // The story keys waiting in the outbox.
  async function listOutbox() {
    const keys = [];
    for await (const key of client.scanIterator({ MATCH: "outbox:*", COUNT: 100 })) {
      keys.push(key.slice("outbox:".length));
    }
    return keys;
  }

  // Count one more failed attempt, if the entry still holds the same grade.
  async function bumpOutbox(storyKey, checkedAt) {
    const current = await getOutbox(storyKey);
    if (current && current.grade.checked_at === checkedAt) {
      current.attempts = current.attempts + 1;
      await client.set("outbox:" + storyKey, JSON.stringify(current));
    }
  }

  // Delete the entry, but only if a newer grade has not replaced it meanwhile.
  async function deleteOutbox(storyKey, checkedAt) {
    const current = await getOutbox(storyKey);
    if (current && current.grade.checked_at === checkedAt) {
      await client.del("outbox:" + storyKey);
    }
  }

  // Close the connection politely.
  async function quit() {
    try {
      await client.quit();
    } catch (err) {
      // Already closed. Nothing more to do.
    }
  }

  return {
    connect: connect,
    isReady: isReady,
    ping: ping,
    markSeen: markSeen,
    checkLatest: checkLatest,
    savePartial: savePartial,
    deletePartial: deletePartial,
    saveGrade: saveGrade,
    getGrade: getGrade,
    saveOutbox: saveOutbox,
    getOutbox: getOutbox,
    listOutbox: listOutbox,
    bumpOutbox: bumpOutbox,
    deleteOutbox: deleteOutbox,
    quit: quit
  };
}

module.exports = { createStore: createStore };
