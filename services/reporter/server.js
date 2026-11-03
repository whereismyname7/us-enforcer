// The Reporter service: combines the Rules and Impact results into a level L0-L4,
// writes it back to Jira as the bot, and keeps the latest grade for the readiness API.
// It is the only service that writes to Jira and the only one that uses Redis.

// Load express, the library that answers web requests.
const express = require("express");

// Our own parts, one job each.
const { createStore } = require("./store");
const { createJiraClient } = require("./jira-client");
const { createBreaker } = require("./breaker");
const { createOutbox } = require("./outbox");
const { createConsumer } = require("./consumer");

// A name for this service, printed in every log line.
const SERVICE = "reporter";

// The port we listen on inside the container.
const PORT = Number(process.env.PORT || 3000);

// Where the event log, Redis and Jira live, seen from inside the Docker network.
const KAFKA_BROKER = process.env.KAFKA_BROKER || "redpanda:29092";
const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const JIRA_URL = process.env.JIRA_URL || "http://jira-sim:3000";

// How long we wait for Jira on each call, in milliseconds.
const JIRA_TIMEOUT_MS = Number(process.env.JIRA_TIMEOUT_MS || 2000);

// Our own service account. Every write to Jira is made as this account.
const BOT_ACCOUNT = process.env.BOT_ACCOUNT || "story-readiness-bot";

// The breaker opens after this many failures in a row, for this long.
const BREAKER_THRESHOLD = Number(process.env.BREAKER_THRESHOLD || 3);
const BREAKER_COOLDOWN_MS = Number(process.env.BREAKER_COOLDOWN_MS || 10000);

// How often the outbox retries failed writes.
const OUTBOX_RETRY_MS = Number(process.env.OUTBOX_RETRY_MS || 5000);

// Print one structured log line as JSON, like every Lab2 service.
function log(fields) {
  const line = { ts: new Date().toISOString(), service: SERVICE, instance: process.env.HOSTNAME || "local" };
  Object.assign(line, fields);
  console.log(JSON.stringify(line));
}

// Wire the parts together.
const store = createStore({ url: REDIS_URL, log: log });
const jira = createJiraClient({ baseUrl: JIRA_URL, timeoutMs: JIRA_TIMEOUT_MS, actor: BOT_ACCOUNT });
const breaker = createBreaker({ threshold: BREAKER_THRESHOLD, cooldownMs: BREAKER_COOLDOWN_MS, log: log });
const outbox = createOutbox({ store: store, jira: jira, breaker: breaker, retryMs: OUTBOX_RETRY_MS, log: log });
const consumer = createConsumer({ broker: KAFKA_BROKER, clientId: SERVICE, log: log, store: store, outbox: outbox });

// Create the application object.
const app = express();

// LIVENESS. "Am I alive?" It checks nothing outside this process.
app.get("/health", function (req, res) {
  res.json({ status: "ok", service: SERVICE });
});

// READINESS. Ready only when Redis answers PING and the consumer has joined its group.
app.get("/ready", async function (req, res) {
  // Redis first: without it we cannot grade or answer the API.
  let redisOk = store.isReady();
  if (redisOk) {
    try {
      await store.ping();
    } catch (err) {
      redisOk = false;
    }
  }
  if (!redisOk) {
    res.status(503).json({ ready: false, service: SERVICE, reason: "redis_not_connected" });
    return;
  }
  // Then the consumer.
  if (!consumer.isReady()) {
    res.status(503).json({ ready: false, service: SERVICE, reason: "consumer_not_ready" });
    return;
  }
  res.json({ ready: true, service: SERVICE });
});

// The readiness API: the last grade of one story. The gateway checks the API key first.
app.get("/v1/stories/:key/readiness", async function (req, res) {
  const requestId = req.get("X-Request-Id") || null;
  const key = req.params.key;
  // Without Redis we cannot answer. Say so at once instead of making the caller wait.
  if (!store.isReady()) {
    res.status(503).json({ error: "store_unavailable", message: "The grade store is not answering. Retry in a minute.", request_id: requestId });
    return;
  }
  try {
    const grade = await store.getGrade(key);
    if (!grade) {
      res.status(404).json({ error: "not_graded", message: "No grade yet for " + key, request_id: requestId });
      return;
    }
    res.json(grade);
  } catch (err) {
    log({ level: "error", event: "grade_read_failed", story_key: key, request_id: requestId, message: String(err.message) });
    res.status(503).json({ error: "store_unavailable", message: "The grade store is not answering. Retry in a minute.", request_id: requestId });
  }
});

// Anything else does not exist. Say so in JSON.
app.use(function (req, res) {
  res.status(404).json({ error: "route_not_found", message: "No such route on reporter", request_id: req.get("X-Request-Id") || null });
});

// Start listening first, so /health answers while Redis and Kafka are still starting.
const server = app.listen(PORT, async function () {
  log({ level: "info", event: "started", port: PORT });
  // Then connect, patiently. /ready stays 503 until both are up.
  await store.connect();
  outbox.start();
  consumer.start();
});

// Graceful stop: stop the outbox, disconnect Kafka and Redis, then exit 0.
process.on("SIGTERM", async function () {
  log({ level: "info", event: "stopping" });
  outbox.stop();
  await consumer.stop();
  await store.quit();
  server.close(function () {
    process.exit(0);
  });
});
