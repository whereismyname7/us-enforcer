// Intake: the anti-corruption layer. Jira's field names stop here (ADR-003).
// A webhook arrives, we read the story and its CR fresh, translate them, and publish StoryChanged.
const crypto = require("crypto");
const express = require("express");
const { Kafka, logLevel } = require("kafkajs");

const JIRA_URL = process.env.JIRA_URL || "http://jira-sim:3000";
const TOPIC = "readiness.story-changes";

const kafka = new Kafka({ clientId: "intake", brokers: [process.env.KAFKA_BROKER || "redpanda:29092"], logLevel: logLevel.NOTHING });
const producer = kafka.producer();
let connected = false;

function log(fields) {
  console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), service: "intake" }, fields)));
}

// Read one issue from Jira, or null if it does not exist.
async function getIssue(key) {
  const res = await fetch(JIRA_URL + "/rest/api/v3/issue/" + encodeURIComponent(key), { signal: AbortSignal.timeout(2000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Jira answered " + res.status);
  return res.json();
}

// Jira's words become our words. Nothing downstream knows what "iWant" is.
function buildStoryChanged(issue, cr) {
  return {
    event_id: crypto.randomUUID(),
    type: "StoryChanged",
    version: 1,
    occurred_at: new Date().toISOString(),
    story_key: issue.key,
    story_updated_at: issue.updated,
    story: {
      summary: issue.summary || "",
      as_a: issue.asA || "",
      i_want: issue.iWant || "",
      so_that: issue.soThat || "",
      acceptance_criteria: issue.acceptanceCriteria || "",
      technical_notes: issue.technicalNotes || ""
    },
    change_request: cr && {
      key: cr.key,
      status: cr.status,
      impacted_systems: cr.impactedSystems || [],
      out_of_scope: cr.outOfScope || []
    }
  };
}

const app = express();
app.use(express.json());

// Healthy once we can publish.
app.get("/health", function (req, res) {
  res.status(connected ? 200 : 503).json({ status: connected ? "ok" : "starting", service: "intake" });
});

app.post("/webhook", async function (req, res) {
  const key = req.body && req.body.issue && req.body.issue.key;
  try {
    const issue = key && (await getIssue(key));
    if (!issue || issue.type !== "Story") {
      return res.status(202).json({ accepted: false });
    }
    const cr = issue.crKey ? await getIssue(issue.crKey) : null;
    const event = buildStoryChanged(issue, cr);
    // Keyed by story, so one story's events stay in order.
    await producer.send({ topic: TOPIC, messages: [{ key: event.story_key, value: JSON.stringify(event) }] });
    log({ level: "info", event: "published", story_key: key, event_id: event.event_id, request_id: req.get("X-Request-Id") });
    res.status(202).json({ accepted: true, event_id: event.event_id });
  } catch (err) {
    log({ level: "error", event: "publish_failed", story_key: key, message: String(err.message) });
    res.status(503).json({ error: "unavailable", message: "Retry later" });
  }
});

async function main() {
  app.listen(3000);
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({ topics: [{ topic: TOPIC, numPartitions: 3, replicationFactor: 1 }] }).catch(function () {});
  await admin.disconnect();
  await producer.connect();
  connected = true;
  log({ level: "info", event: "started", topic: TOPIC });
}

// If the event log is not there, stop. Docker restarts us.
main().catch(function (err) {
  log({ level: "error", event: "failed", message: String(err.message) });
  process.exit(1);
});
