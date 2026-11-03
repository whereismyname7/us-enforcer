// The Rules service: template, acceptance criteria, wording, INVEST and CR checks.
// This file answers /health and /ready, loads rules.yaml once, and starts consumer.js.
// You can run three copies of it (docker compose up -d --scale rules=3); Kafka shares the work.

// Load express, the library that answers web requests.
const express = require("express");

// The event loop and the config loader.
const { loadConfig, createConsumer, CHECK_IDS } = require("./consumer");

// A name for this service, printed in every log line.
const SERVICE = "rules";

// The port we listen on inside the container.
const PORT = Number(process.env.PORT || 3000);

// Where the event log lives, seen from inside the Docker network.
const KAFKA_BROKER = process.env.KAFKA_BROKER || "redpanda:29092";

// Print one structured log line as JSON, like every Lab2 service.
function log(fields) {
  const line = { ts: new Date().toISOString(), service: SERVICE, instance: process.env.HOSTNAME || "local" };
  Object.assign(line, fields);
  console.log(JSON.stringify(line));
}

// Load rules.yaml once. A broken config file must stop the service at once, loudly.
let config;
try {
  config = loadConfig();
  log({ level: "info", event: "rules_loaded", checks: CHECK_IDS.length, version: config.version });
} catch (err) {
  log({ level: "error", event: "rules_load_failed", message: String(err.message) });
  process.exit(1);
}

// The Kafka reader and writer.
const consumer = createConsumer({ broker: KAFKA_BROKER, clientId: SERVICE, log: log });

// Create the application object.
const app = express();

// LIVENESS. "Am I alive?" It checks nothing outside this process.
app.get("/health", function (req, res) {
  res.json({ status: "ok", service: SERVICE });
});

// READINESS. Ready once the consumer has joined its group.
app.get("/ready", function (req, res) {
  if (consumer.isReady()) {
    res.json({ ready: true, service: SERVICE });
    return;
  }
  res.status(503).json({ ready: false, service: SERVICE, reason: "consumer_not_ready" });
});

// Anything else does not exist. Say so in JSON.
app.use(function (req, res) {
  res.status(404).json({ error: "route_not_found", message: "No such route on rules", request_id: req.get("X-Request-Id") || null });
});

// Start listening first, so /health answers while Kafka is still starting.
const server = app.listen(PORT, function () {
  log({ level: "info", event: "started", port: PORT });
  // Then connect to Kafka, patiently. /ready stays 503 until the group is joined.
  consumer.start(config);
});

// Graceful stop: disconnect the consumer and producer, then exit 0.
process.on("SIGTERM", async function () {
  log({ level: "info", event: "stopping" });
  await consumer.stop();
  server.close(function () {
    process.exit(0);
  });
});
