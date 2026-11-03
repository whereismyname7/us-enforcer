// The Impact service: C4 containers, ADR rules, CR impact, data owner, events, APIs and security.
// This file answers /health and /ready, reads the target architecture once, and starts consumer.js.
// The architecture folder is mounted read-only at ARCHITECTURE_DIR; the architect owns it.

// Load express, the library that answers web requests.
const express = require("express");

// The event loop and the config loader.
const { loadConfig, unknownMapContainers, createConsumer } = require("./consumer");

// A name for this service, printed in every log line.
const SERVICE = "impact";

// The port we listen on inside the container.
const PORT = Number(process.env.PORT || 3000);

// Where the event log lives, seen from inside the Docker network.
const KAFKA_BROKER = process.env.KAFKA_BROKER || "redpanda:29092";

// Where containers.puml and openapi.yaml are.
const ARCHITECTURE_DIR = process.env.ARCHITECTURE_DIR || "/architecture";

// Print one structured log line as JSON, like every Lab2 service.
function log(fields) {
  const line = { ts: new Date().toISOString(), service: SERVICE, instance: process.env.HOSTNAME || "local" };
  Object.assign(line, fields);
  console.log(JSON.stringify(line));
}

// Read our config and the architecture once. A broken file must stop the service at once, loudly.
let config;
try {
  config = loadConfig(ARCHITECTURE_DIR);
  log({ level: "info", event: "architecture_loaded", dir: ARCHITECTURE_DIR, containers: config.architecture.containers.map(function (c) { return c.id; }), api_paths: config.architecture.apiPaths.length, adr_rules: config.adrRules.rules.length });
  // A map entry the diagram does not know is skipped, and we say so.
  for (const id of unknownMapContainers(config)) {
    log({ level: "warn", event: "unknown_container_in_map", container: id });
  }
} catch (err) {
  log({ level: "error", event: "architecture_load_failed", message: String(err.message) });
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
  res.status(404).json({ error: "route_not_found", message: "No such route on impact", request_id: req.get("X-Request-Id") || null });
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
