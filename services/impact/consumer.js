// The Impact service's event loop: StoryChanged in, StoryChecked out.
// It runs every I-* check against the target architecture and publishes one result with checker "impact".
// Nothing starts when this file is loaded; server.js calls start(). Tests use runChecks() only.

// Node's built-in tools: files, paths and random ids.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// js-yaml reads our config files. kafkajs talks to the event log.
const yaml = require("js-yaml");
const { Kafka, logLevel } = require("kafkajs");

// The architecture reader and the four groups of checks.
const { loadArchitecture } = require("./architecture");
const { containerChecks, impactedContainers } = require("./checks/containers");
const { adrChecks } = require("./checks/adr");
const { changeRequestImpactChecks } = require("./checks/change-request");
const { deliveryChecks } = require("./checks/delivery");

// The topic we read and the topic we write. Both are listed in docs/event-catalogue.md.
const STORY_CHANGES_TOPIC = "readiness.story-changes";
const CHECK_RESULTS_TOPIC = "readiness.check-results";

// Our reading group. The broker remembers our place under this name, so we can catch up.
const GROUP = "impact-checks";

// Both topics, created at startup by every Kafka service. Repeating it is safe.
const TOPICS = [
  { topic: STORY_CHANGES_TOPIC, numPartitions: 3, replicationFactor: 1 },
  { topic: CHECK_RESULTS_TOPIC, numPartitions: 3, replicationFactor: 1 }
];

// The label added when I-SEC-01 fails.
const SECURITY_LABEL = "needs-security-review";

// Read one YAML file that lives next to this file. Only this service owns them (ADR-001).
function readOwnYaml(name) {
  return yaml.load(fs.readFileSync(path.join(__dirname, name), "utf8"));
}

// Load everything the checks need: our three config files and the target architecture.
function loadConfig(architectureDir) {
  return {
    impactMap: readOwnYaml("impact-map.yaml"),
    adrRules: readOwnYaml("adr-rules.yaml"),
    owners: readOwnYaml("owners.yaml"),
    architecture: loadArchitecture(architectureDir)
  };
}

// The container ids in impact-map.yaml that containers.puml does not have. They are skipped.
function unknownMapContainers(config) {
  const known = config.architecture.containers.map(function (c) { return c.id; });
  return Object.keys(config.impactMap.containers || {}).filter(function (id) { return known.indexOf(id) === -1; });
}

// Run every check on one StoryChanged.
// Returns { checks, facts }: 8 fixed checks plus one per ADR rule, in catalogue order.
function runChecks(event, config) {
  const con = containerChecks(event, config);
  const own = deliveryChecks(event, config);
  const checks = [con[0]]
    .concat(adrChecks(event, config))
    .concat(changeRequestImpactChecks(event, config))
    .concat([con[1], con[2]])
    .concat(own);

  // The facts the Reporter shows: containers, their names, their teams and any label.
  const impacted = impactedContainers(event, config);
  const teams = [];
  for (const c of impacted) {
    const team = config.owners.teams ? config.owners.teams[c.id] : undefined;
    if (team && teams.indexOf(team) === -1) {
      teams.push(team);
    }
  }
  const security = checks.find(function (c) { return c.id === "I-SEC-01"; });
  const facts = {
    impacted_containers: impacted.map(function (c) { return c.id; }),
    impacted_names: impacted.map(function (c) { return c.name; }),
    teams: teams,
    labels: security.passed ? [] : [SECURITY_LABEL]
  };
  return { checks: checks, facts: facts };
}

// Build the StoryChecked v1 event for one StoryChanged.
function buildResult(event, outcome) {
  return {
    event_id: crypto.randomUUID(),
    type: "StoryChecked",
    version: 1,
    occurred_at: new Date().toISOString(),
    story_key: event.story_key,
    story_updated_at: event.story_updated_at,
    source_event_id: event.event_id,
    source_occurred_at: event.occurred_at,
    checker: "impact",
    checks: outcome.checks,
    facts: outcome.facts
  };
}

// Wait a number of milliseconds.
function pause(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// Build the consumer. Options: broker, clientId, log.
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
  // The reader and the writer. Made fresh on every connection attempt.
  let consumer = null;
  let producer = null;
  // Has the consumer joined its group? /ready reports this.
  let joined = false;

  // Handle one message from readiness.story-changes.
  async function handle(config, payload) {
    // Turn the message body from JSON text back into an object.
    let event;
    try {
      event = JSON.parse(payload.message.value.toString());
    } catch (err) {
      options.log({ level: "warn", event: "event_ignored", reason: "invalid_json" });
      return;
    }
    // We only understand StoryChanged version 1. Skip anything else politely.
    if (!event || event.type !== "StoryChanged" || event.version !== 1) {
      options.log({ level: "warn", event: "event_ignored", reason: "unknown_type_or_version", type: event ? event.type : null, version: event ? event.version : null });
      return;
    }
    // Run the checks. A bug in one check must not block the whole partition.
    let outcome;
    try {
      outcome = runChecks(event, config);
    } catch (err) {
      options.log({ level: "error", event: "check_failed", story_key: event.story_key, event_id: event.event_id, message: String(err.message) });
      return;
    }
    // Publish the result, keyed by story_key so one story's results stay in order.
    const out = buildResult(event, outcome);
    await producer.send({ topic: CHECK_RESULTS_TOPIC, messages: [{ key: event.story_key, value: JSON.stringify(out) }] });
    // Log the ids of the blocking checks that failed. Never the story text.
    const failed = outcome.checks.filter(function (c) { return c.severity === "block" && !c.passed; }).map(function (c) { return c.id; });
    options.log({ level: "info", event: "checked", story_key: event.story_key, source_event_id: event.event_id, event_id: out.event_id, failed: failed, impacted_containers: outcome.facts.impacted_containers });
  }

  // Connect and start reading, patiently. Keep trying until the broker answers; never exit.
  async function start(config) {
    for (let attempt = 1; ; attempt++) {
      try {
        // Create both topics. waitForLeaders means "wait until they can take messages".
        const admin = kafka.admin();
        await admin.connect();
        await admin.createTopics({ waitForLeaders: true, topics: TOPICS });
        await admin.disconnect();
        // Open the writer.
        producer = kafka.producer();
        await producer.connect();
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
        // After that the broker remembers our place, so a stopped consumer catches up.
        await consumer.subscribe({ topic: STORY_CHANGES_TOPIC, fromBeginning: true });
        // Start reading. The function runs once for every message.
        await consumer.run({ eachMessage: function (payload) { return handle(config, payload); } });
        options.log({ level: "info", event: "listening", topic: STORY_CHANGES_TOPIC, group: GROUP });
        return;
      } catch (err) {
        // Not there yet. Clean up, wait two seconds and try again.
        options.log({ level: "warn", event: "kafka_connect_failed", attempt: attempt, message: String(err.message) });
        await stop();
        await pause(2000);
      }
    }
  }

  // Disconnect the reader and the writer. Safe to call more than once.
  async function stop() {
    joined = false;
    for (const client of [consumer, producer]) {
      if (client) {
        try {
          await client.disconnect();
        } catch (err) {
          // Already gone. Nothing more to do.
        }
      }
    }
  }

  return { start: start, stop: stop, isReady: function () { return joined; } };
}

module.exports = {
  loadConfig: loadConfig,
  unknownMapContainers: unknownMapContainers,
  runChecks: runChecks,
  buildResult: buildResult,
  createConsumer: createConsumer
};
