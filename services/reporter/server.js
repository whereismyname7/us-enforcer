// Reporter: StoryChecked in, a level and a comment out. It is the only service that writes to Jira.
const express = require("express");
const { Kafka, logLevel } = require("kafkajs");

const JIRA_URL = process.env.JIRA_URL || "http://jira-sim:3000";
const TOPIC = "readiness.check-results";

const kafka = new Kafka({ clientId: "reporter", brokers: [process.env.KAFKA_BROKER || "redpanda:29092"], logLevel: logLevel.NOTHING });
const consumer = kafka.consumer({ groupId: "reporter-grading" });

// Every status a story can have, for the lookup endpoint.
const STATUSES = [
  { status: "Pending", description: "Saved and waiting for its check. The gate stays closed." },
  { status: "L0", description: "Not a draft. It does not have the shape of a story yet." },
  { status: "L1", description: "Draft. It has a title, a role, a goal and a benefit." },
  { status: "L2", description: "Defined. Its acceptance criteria can be tested." },
  { status: "L3", description: "Refined. It is linked to a CR, and its impact is known and follows the ADRs." },
  { status: "L4", description: "Dev-ready. The CR is approved, it is in scope and it has a data owner. Only L4 passes the gate." }
];

// In memory for the proof of concept. Event ids we already handled, and the latest grade per story.
const alreadyApplied = new Set();
const grades = new Map();
let listening = false;

function log(fields) {
  console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), service: "reporter" }, fields)));
}

// The lowest failed level decides: a failure at L2 means the story is L1. Nothing failed means L4.
function computeLevel(checks) {
  const failed = checks.filter(function (c) { return !c.passed; }).map(function (c) { return c.level; });
  return failed.length === 0 ? 4 : Math.min.apply(null, failed) - 1;
}

// The comment a BA reads: the level and exactly what is missing.
function buildComment(level, failed, impacted) {
  const lines = [level === 4 ? "Story readiness: L4 of 4. Ready for development." : "Story readiness: L" + level + " of 4. Fix these to reach L4:"];
  failed.forEach(function (c) { lines.push("- L" + c.level + " " + c.id + ": " + c.message); });
  lines.push("", "Impacted containers: " + (impacted.join(", ") || "none found"));
  return lines.join("\n");
}

async function handle(payload) {
  const result = JSON.parse(payload.message.value.toString());
  if (result.type !== "StoryChecked" || result.version !== 1) return;
  // Idempotent: the same event twice has the same effect as once.
  if (alreadyApplied.has(result.event_id)) {
    log({ level: "warn", event: "duplicate_ignored", event_id: result.event_id });
    return;
  }
  const level = computeLevel(result.checks);
  const failed = result.checks.filter(function (c) { return !c.passed; }).sort(function (a, b) { return a.level - b.level; });
  const grade = {
    level: "L" + level,
    missing: failed.map(function (c) { return c.id + ": " + c.message; }),
    impacted_containers: result.impacted_containers,
    story_updated_at: result.story_updated_at,
    comment: buildComment(level, failed, result.impacted_containers)
  };
  const res = await fetch(JIRA_URL + "/rest/api/v3/issue/" + encodeURIComponent(result.story_key) + "/readiness", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(grade),
    signal: AbortSignal.timeout(2000)
  });
  // Jira is in trouble: throw, so the message is not committed and Kafka delivers it again.
  if (res.status >= 500) throw new Error("Jira answered " + res.status);
  alreadyApplied.add(result.event_id);
  // 409: the story changed after this check, so a newer grade is on its way. 404: the story is gone.
  if (!res.ok) {
    log({ level: "info", event: "grade_dropped", story_key: result.story_key, status: res.status });
    return;
  }
  grades.set(result.story_key, grade);
  // The SLI from docs/slo/readiness-slo.md: how long from the save to the grade.
  log({ level: "info", event: "graded", story_key: result.story_key, grade_level: grade.level, lag_ms: Date.now() - Date.parse(result.story_updated_at) });
}

const app = express();

// Healthy once we are reading events.
app.get("/health", function (req, res) {
  res.status(listening ? 200 : 503).json({ status: listening ? "ok" : "starting", service: "reporter" });
});

// The lookup: every status and what it means.
app.get("/v1/statuses", function (req, res) {
  res.json({ statuses: STATUSES });
});

// The readiness API, reached through the gateway.
app.get("/v1/stories/:key/readiness", function (req, res) {
  const grade = grades.get(req.params.key);
  if (!grade) return res.status(404).json({ error: "not_graded", message: "No grade yet for " + req.params.key });
  res.json({ status: grade.level, missing: grade.missing, impacted_containers: grade.impacted_containers, story_updated_at: grade.story_updated_at });
});

async function main() {
  app.listen(3000);
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({ waitForLeaders: true, topics: [{ topic: TOPIC, numPartitions: 3, replicationFactor: 1 }] }).catch(function () {});
  await admin.disconnect();
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });
  await consumer.run({ eachMessage: handle });
  listening = true;
  log({ level: "info", event: "listening", topic: TOPIC });
}

main().catch(function (err) {
  log({ level: "error", event: "failed", message: String(err.message) });
  process.exit(1);
});
