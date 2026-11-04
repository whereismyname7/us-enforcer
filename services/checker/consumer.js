// Checker: StoryChanged in, StoryChecked out. Everything it needs is inside the event, so it never calls Jira.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { Kafka, logLevel } = require("kafkajs");
const { runChecks } = require("./checks");

const IN_TOPIC = "readiness.story-changes";
const OUT_TOPIC = "readiness.check-results";

const kafka = new Kafka({ clientId: "checker", brokers: [process.env.KAFKA_BROKER || "redpanda:29092"], logLevel: logLevel.NOTHING });
// The broker remembers our place under this group, so a stopped checker catches up.
const consumer = kafka.consumer({ groupId: "checker-checks" });
const producer = kafka.producer();

function log(fields) {
  console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), service: "checker" }, fields)));
}

// Read our rules and the boxes of the target architecture.
function loadConfig() {
  const config = yaml.load(fs.readFileSync(path.join(__dirname, "rules.yaml"), "utf8"));
  const puml = fs.readFileSync(path.join(__dirname, "target-containers.puml"), "utf8");
  config.containers = Array.from(puml.matchAll(/\bContainer\((\w+),\s*"([^"]+)"/g)).map(function (m) { return { id: m[1], name: m[2] }; });
  return config;
}

async function main() {
  const config = loadConfig();
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: [IN_TOPIC, OUT_TOPIC].map(function (topic) { return { topic: topic, numPartitions: 3, replicationFactor: 1 }; })
  }).catch(function () {});
  await admin.disconnect();
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic: IN_TOPIC, fromBeginning: true });
  log({ level: "info", event: "listening", topic: IN_TOPIC, containers: config.containers.length });

  await consumer.run({
    eachMessage: async function (payload) {
      const event = JSON.parse(payload.message.value.toString());
      if (event.type !== "StoryChanged" || event.version !== 1) {
        log({ level: "warn", event: "event_ignored", type: event.type });
        return;
      }
      const result = runChecks(event, config);
      const out = {
        event_id: crypto.randomUUID(),
        type: "StoryChecked",
        version: 1,
        occurred_at: new Date().toISOString(),
        story_key: event.story_key,
        story_updated_at: event.story_updated_at,
        source_event_id: event.event_id,
        checks: result.checks,
        impacted_containers: result.impacted
      };
      await producer.send({ topic: OUT_TOPIC, messages: [{ key: event.story_key, value: JSON.stringify(out) }] });
      const failed = result.checks.filter(function (c) { return !c.passed; }).map(function (c) { return c.id; });
      log({ level: "info", event: "checked", story_key: event.story_key, source_event_id: event.event_id, failed: failed });
    }
  });
}

main().catch(function (err) {
  log({ level: "error", event: "failed", message: String(err.message) });
  process.exit(1);
});
