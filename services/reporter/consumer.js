// The Reporter's event loop: StoryChecked in, one grade out per StoryChanged.
// It waits for both results (rules and impact), computes the level, saves it, and writes it to Jira.
// Nothing starts when this file is loaded; server.js calls start(). Tests use buildGrade() only.

// Load the Kafka client library.
const { Kafka, logLevel } = require("kafkajs");

// The level algorithm, copied word for word from the build spec.
const { computeLevel } = require("./level");

// The topic we read. It is listed in docs/event-catalogue.md.
const STORY_CHANGES_TOPIC = "readiness.story-changes";
const CHECK_RESULTS_TOPIC = "readiness.check-results";

// Our reading group. The broker remembers our place under this name.
const GROUP = "reporter-grading";

// Both topics, created at startup by every Kafka service. Repeating it is safe.
const TOPICS = [
  { topic: STORY_CHANGES_TOPIC, numPartitions: 3, replicationFactor: 1 },
  { topic: CHECK_RESULTS_TOPIC, numPartitions: 3, replicationFactor: 1 }
];

// The two checkers we wait for.
const CHECKERS = ["rules", "impact"];

// Sort check results by level, then by id in plain string order.
function sortByLevelThenId(list) {
  return list.slice().sort(function (a, b) {
    if (a.level !== b.level) {
      return a.level - b.level;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Keep only the fields a grade shows for one failed check.
function brief(c) {
  return { id: c.id, level: c.level, message: c.message };
}

// Build the readiness value from the two results for one StoryChanged.
function buildGrade(rulesResult, impactResult, checkedAt) {
  // Every result from both checkers together.
  const checks = rulesResult.checks.concat(impactResult.checks);
  // The facts come from Impact.
  const facts = impactResult.facts || {};
  return {
    state: "Graded",
    level: computeLevel(checks),
    story_updated_at: rulesResult.story_updated_at,
    source_event_id: rulesResult.source_event_id,
    checked_at: checkedAt,
    // Failed blocking checks, then failed warnings, both sorted by level and id.
    failed: sortByLevelThenId(checks.filter(function (c) { return c.severity === "block" && !c.passed; })).map(brief),
    warnings: sortByLevelThenId(checks.filter(function (c) { return c.severity === "warn" && !c.passed; })).map(brief),
    impacted_containers: facts.impacted_containers || [],
    impacted_names: facts.impacted_names || [],
    teams: facts.teams || [],
    labels: facts.labels || []
  };
}

// Wait a number of milliseconds.
function pause(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Build the consumer. Options: broker, clientId, log, store, outbox.
function createConsumer(options) {
  // Create the client the Lab2 way.
  const kafka = new Kafka({
    clientId: options.clientId,
    brokers: [options.broker],
    logLevel: logLevel.ERROR,
    retry: { initialRetryTime: 300, retries: 20 },
    // Send the library's own lines through our log helper, so every line has ts, service, level and event.
    logCreator: function () {
      return function (entry) {
        options.log({ level: entry.level <= logLevel.ERROR ? "error" : "warn", event: "kafka_client_logged", namespace: entry.namespace, message: entry.log.message, error: entry.log.error });
      };
    }
  });
  // The reader. Made fresh on every connection attempt.
  let consumer = null;
  // Has the consumer joined its group? /ready reports this.
  let joined = false;

  // Handle one StoryChecked message.
  async function handle(payload) {
    // Turn the message body from JSON text back into an object.
    let result;
    try {
      result = JSON.parse(payload.message.value.toString());
    } catch (err) {
      options.log({ level: "warn", event: "event_ignored", reason: "invalid_json" });
      return;
    }
    // We only understand StoryChecked version 1 from our two checkers.
    if (!result || result.type !== "StoryChecked" || result.version !== 1 || CHECKERS.indexOf(result.checker) === -1) {
      options.log({ level: "warn", event: "event_ignored", reason: "unknown_type_or_version", type: result ? result.type : null });
      return;
    }
    const storyKey = result.story_key;

    // 1. IDEMPOTENCY. The same event twice has the same effect as once.
    if (!(await options.store.markSeen(result.event_id))) {
      options.log({ level: "warn", event: "duplicate_ignored", story_key: storyKey, event_id: result.event_id });
      return;
    }
    // 2. Drop anything older than the newest change we have seen for this story.
    if (!(await options.store.checkLatest(storyKey, result.source_occurred_at))) {
      options.log({ level: "info", event: "stale_dropped", story_key: storyKey, event_id: result.event_id, source_event_id: result.source_event_id });
      return;
    }
    // 3. Keep this half. Grade only when both halves are here.
    const partial = await options.store.savePartial(result.source_event_id, result.checker, JSON.stringify(result));
    if (!partial.rules || !partial.impact) {
      options.log({ level: "info", event: "result_saved", story_key: storyKey, checker: result.checker, source_event_id: result.source_event_id });
      return;
    }
    await options.store.deletePartial(result.source_event_id);

    // GRADE. Step 1: the level and the readiness value.
    const grade = buildGrade(JSON.parse(partial.rules), JSON.parse(partial.impact), new Date().toISOString());
    // Step 2: keep it for the readiness API.
    await options.store.saveGrade(storyKey, grade);
    // Step 3: write it to Jira, or to the outbox if Jira is down.
    const outcome = await options.outbox.deliver(storyKey, grade);
    // A newer change is on its way, or the story is gone: this grade is not the story's grade.
    if (outcome === "superseded" || outcome === "missing") {
      return;
    }
    // Step 4: the SLI. How long from the save in Jira to the grade.
    // The grade goes in grade_level, because "level" is the log line's own info/warn/error.
    const lagMs = Date.parse(grade.checked_at) - Date.parse(grade.story_updated_at);
    options.log({ level: "info", event: "graded", story_key: storyKey, grade_level: grade.level, lag_ms: lagMs, source_event_id: grade.source_event_id, written: outcome });
  }

  // Connect and start reading, patiently. Keep trying until the broker answers; never exit.
  async function start() {
    for (let attempt = 1; ; attempt++) {
      try {
        // Create both topics. waitForLeaders means "wait until they can take messages".
        const admin = kafka.admin();
        await admin.connect();
        await admin.createTopics({ waitForLeaders: true, topics: TOPICS });
        await admin.disconnect();
        // Open the reader and watch its group membership.
        consumer = kafka.consumer({ groupId: GROUP });
        consumer.on(consumer.events.GROUP_JOIN, function () {
          joined = true;
          options.log({ level: "info", event: "group_joined", group: GROUP });
        });
        consumer.on(consumer.events.CRASH, function (e) {
          joined = false;
          options.log({ level: "error", event: "consumer_crashed", message: String(e.payload.error && e.payload.error.message) });
        });
        consumer.on(consumer.events.STOP, function () {
          joined = false;
        });
        await consumer.connect();
        // fromBeginning true: the very first time the group ever joins, start at the first line.
        await consumer.subscribe({ topic: CHECK_RESULTS_TOPIC, fromBeginning: true });
        // Start reading. The function runs once for every message.
        await consumer.run({ eachMessage: handle });
        options.log({ level: "info", event: "listening", topic: CHECK_RESULTS_TOPIC, group: GROUP });
        return;
      } catch (err) {
        // Not there yet. Clean up, wait two seconds and try again.
        options.log({ level: "warn", event: "kafka_connect_failed", attempt: attempt, message: String(err.message) });
        await stop();
        await pause(2000);
      }
    }
  }

  // Disconnect the reader. Safe to call more than once.
  async function stop() {
    joined = false;
    if (consumer) {
      try {
        await consumer.disconnect();
      } catch (err) {
        // Already gone. Nothing more to do.
      }
    }
  }

  return { start: start, stop: stop, isReady: function () { return joined; } };
}

module.exports = { buildGrade: buildGrade, sortByLevelThenId: sortByLevelThenId, createConsumer: createConsumer };
