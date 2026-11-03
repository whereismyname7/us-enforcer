// The Jira simulator's web server. It answers the Jira Cloud REST paths our services call,
// keeps everything in memory, and sends signed webhooks the way Jira does (ADR-008).
// Switching to real Jira later means changing JIRA_URL and installing the Forge app.

// Load express, the library that answers web requests.
const express = require("express");

// The in-memory issues and the rules for changing them.
const { createStore, SimError } = require("./store");

// The signed webhook sender.
const { createSender } = require("./webhook");

// A name for this service, printed in every log line.
const SERVICE = "jira-sim";

// The port we listen on inside the container.
const PORT = Number(process.env.PORT || 3000);

// Where webhooks go: the API gateway, which passes them to Intake.
const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://gateway/webhook";

// The shared signing value for webhooks. It always comes from the environment.
const SIGNING_KEY_TEXT = process.env.WEBHOOK_SECRET || "";

// Our own service account. Its writes can be made to fail on purpose (chaos).
const BOT_ACCOUNT = process.env.BOT_ACCOUNT || "story-readiness-bot";

// The roles allowed to override the gate, from "architect,product-owner".
const OVERRIDE_ROLES = (process.env.OVERRIDE_ROLES || "architect,product-owner")
  .split(",")
  .map(function (r) { return r.trim(); })
  .filter(function (r) { return r !== ""; });

// The caller when no X-Actor header is sent. Stands in for Jira's login.
const DEFAULT_ACTOR = "ba.user";

// Print one structured log line as JSON, like every Lab2 service.
function log(fields) {
  const line = { ts: new Date().toISOString(), service: SERVICE, instance: process.env.HOSTNAME || "local" };
  Object.assign(line, fields);
  console.log(JSON.stringify(line));
}

// The memory of every issue. The "self" links use the name other containers know us by.
const store = createStore({ botAccount: BOT_ACCOUNT, overrideRoles: OVERRIDE_ROLES, baseUrl: "http://jira-sim:" + PORT });

// The webhook sender.
const sender = createSender({ url: WEBHOOK_URL, signingKey: SIGNING_KEY_TEXT, log: log });

// Chaos settings for the Day 4 breaker demo. They affect only our bot's writes.
let chaos = { fail_bot_writes: false, delay_ms: 0 };

// Create the application object.
const app = express();

// Read JSON bodies up to 1 megabyte. strict false accepts any JSON value, for properties.
app.use(express.json({ limit: "1mb", strict: false }));

// A body that is not valid JSON gets Jira's error shape instead of an HTML page.
app.use(function (err, req, res, next) {
  if (err) {
    res.status(400).json({ errorMessages: ["The request body is not valid JSON"], errors: {} });
    return;
  }
  next();
});

// Work out who is calling. Missing X-Actor means the BA.
app.use(function (req, res, next) {
  req.actor = req.get("X-Actor") || DEFAULT_ACTOR;
  next();
});

// CHAOS. Only non-GET requests from our bot are affected.
app.use(function (req, res, next) {
  // Everybody else, and every read, passes straight through.
  if (req.method === "GET" || req.actor !== BOT_ACCOUNT) {
    next();
    return;
  }
  // Answer 503 if bot writes should fail; otherwise carry on.
  function finish() {
    if (chaos.fail_bot_writes) {
      log({ level: "warn", event: "chaos_refused", method: req.method, path: req.path });
      res.status(503).json({ errorMessages: ["Simulated Jira outage"], errors: {} });
      return;
    }
    next();
  }
  // A delay first, if one is set.
  if (chaos.delay_ms > 0) {
    setTimeout(finish, chaos.delay_ms);
    return;
  }
  finish();
});

// Send webhooks after the answer has gone. A failure here never reaches the caller.
function sendWebhooks(webhooks) {
  for (const payload of webhooks) {
    sender.deliver(payload).catch(function (err) {
      log({ level: "error", event: "webhook_failed", key: payload.issue.key, message: String(err.message) });
    });
  }
}

// Run one handler and turn a SimError into Jira's error answer.
function handle(fn) {
  return function (req, res) {
    try {
      fn(req, res);
    } catch (err) {
      // A known refusal: 400, 404 or 409 with Jira's body.
      if (err instanceof SimError) {
        res.status(err.status).json(err.body);
        return;
      }
      // Anything else is our bug. Never answer 200 for it.
      log({ level: "error", event: "request_failed", method: req.method, path: req.path, message: String(err.message) });
      res.status(500).json({ errorMessages: ["Internal simulator error"], errors: {} });
    }
  };
}

// LIVENESS. "Am I alive?" It checks nothing outside this process.
app.get("/health", function (req, res) {
  res.json({ status: "ok", service: SERVICE });
});

// READINESS. The simulator needs nothing else, so it is ready as soon as it runs.
app.get("/ready", function (req, res) {
  res.json({ ready: true, service: SERVICE });
});

// Create an issue: a Story or a Change Request.
app.post("/rest/api/3/issue", handle(function (req, res) {
  const result = store.createIssue(req.body, req.actor);
  log({ level: "info", event: "issue_created", key: result.body.key, actor: req.actor });
  res.status(201).json(result.body);
  sendWebhooks(result.webhooks);
}));

// Read one issue.
app.get("/rest/api/3/issue/:key", handle(function (req, res) {
  const issue = store.getIssue(req.params.key);
  if (!issue) {
    res.status(404).json({ errorMessages: ["Issue does not exist or you do not have permission to see it."], errors: {} });
    return;
  }
  res.json(issue);
}));

// Change an issue's fields.
app.put("/rest/api/3/issue/:key", handle(function (req, res) {
  const result = store.updateIssue(req.params.key, req.body, req.actor);
  // Log which fields changed, but never the story text itself.
  if (result.webhooks.length > 0) {
    const fields = result.webhooks[0].changelog.items.map(function (i) { return i.field; });
    log({ level: "info", event: "issue_updated", key: req.params.key, actor: req.actor, fields: fields });
  }
  res.status(204).end();
  sendWebhooks(result.webhooks);
}));

// Link two issues: "inward Implements outward" or "inward Blocks outward".
app.post("/rest/api/3/issueLink", handle(function (req, res) {
  const result = store.createLink(req.body, req.actor);
  log({ level: "info", event: result.webhooks.length > 0 ? "link_created" : "link_duplicate_ignored", type: req.body.type.name, inward: req.body.inwardIssue.key, outward: req.body.outwardIssue.key, actor: req.actor });
  res.status(201).end();
  sendWebhooks(result.webhooks);
}));

// Read one issue property, for example "readiness".
app.get("/rest/api/3/issue/:key/properties/:prop", handle(function (req, res) {
  const value = store.getProperty(req.params.key, req.params.prop);
  res.json({ key: req.params.prop, value: value });
}));

// Write one issue property. No webhook.
app.put("/rest/api/3/issue/:key/properties/:prop", handle(function (req, res) {
  store.setProperty(req.params.key, req.params.prop, req.body);
  res.status(200).json({ key: req.params.prop, value: req.body });
}));

// Add a plain-text comment. No webhook.
app.post("/rest/api/3/issue/:key/comment", handle(function (req, res) {
  const result = store.addComment(req.params.key, req.body ? req.body.body : undefined, req.actor);
  res.status(201).json(result);
}));

// List the transitions allowed from the story's status.
app.get("/rest/api/3/issue/:key/transitions", handle(function (req, res) {
  res.json({ transitions: store.listTransitions(req.params.key) });
}));

// Move a story. Ready for Dev runs the gate.
app.post("/rest/api/3/issue/:key/transitions", handle(function (req, res) {
  try {
    const result = store.transition(req.params.key, req.body || {}, req.actor);
    const issue = store.getIssue(req.params.key);
    log({ level: "info", event: "transition_done", key: req.params.key, status: issue.fields.status.name, via: result.via, actor: req.actor });
    res.status(204).end();
    sendWebhooks(result.webhooks);
  } catch (err) {
    // Log a refusal by the gate, then let handle() answer it.
    if (err instanceof SimError && err.status === 400) {
      log({ level: "info", event: "transition_refused", key: req.params.key, readiness: err.body.errors.readiness || null, actor: req.actor });
    }
    throw err;
  }
}));

// Search. Only "project = KEY" is supported.
app.get("/rest/api/3/search", handle(function (req, res) {
  res.json(store.search(req.query.jql, req.query.maxResults));
}));

// The developer board: stories that passed the gate, or were overridden.
app.get("/board", handle(function (req, res) {
  res.json(store.board());
}));

// Delete every issue and reset the counters.
app.post("/admin/reset", handle(function (req, res) {
  store.reset();
  log({ level: "info", event: "reset_done" });
  res.status(204).end();
}));

// Read the chaos settings.
app.get("/admin/chaos", function (req, res) {
  res.json(chaos);
});

// Change the chaos settings.
app.post("/admin/chaos", function (req, res) {
  const body = req.body || {};
  chaos = {
    fail_bot_writes: body.fail_bot_writes === true,
    delay_ms: Math.max(0, Number(body.delay_ms) || 0)
  };
  log({ level: "warn", event: "chaos_changed", fail_bot_writes: chaos.fail_bot_writes, delay_ms: chaos.delay_ms });
  res.json(chaos);
});

// Anything else is not a simulator path.
app.use(function (req, res) {
  res.status(404).json({ errorMessages: ["No such simulator path: " + req.method + " " + req.path], errors: {} });
});

// Warn once if the signing value is missing: Intake would reject every webhook.
if (SIGNING_KEY_TEXT === "") {
  log({ level: "warn", event: "webhook_signing_missing", note: "set WEBHOOK_SECRET" });
}

// Start listening.
const server = app.listen(PORT, function () {
  log({ level: "info", event: "started", port: PORT, webhook_url: WEBHOOK_URL });
});

// Graceful stop: finish open requests, then exit 0.
process.on("SIGTERM", function () {
  log({ level: "info", event: "stopping" });
  server.close(function () {
    process.exit(0);
  });
});
