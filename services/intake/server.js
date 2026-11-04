// The Intake service: turns a signed Jira webhook into a StoryChanged event with fresh story and CR data.
// Intake is the anti-corruption layer (ADR-005): Jira's field names stop here.
// It also answers POST /v1/stories/:key/recheck, reached through the gateway.

// Load express, the library that answers web requests.
const express = require("express");

// Node's built-in toolbox, used here for crypto.randomUUID().
const crypto = require("crypto");

// Our own parts, one job each.
const signature = require("./signature");
const filter = require("./filter");
const translate = require("./translate");
const { createJiraClient, JiraUnavailable } = require("./jira-client");
const { createPublisher } = require("./publisher");

// A name for this service, printed in every log line.
const SERVICE = "intake";

// The port we listen on inside the container.
const PORT = Number(process.env.PORT || 3000);

// Where the event log lives, seen from inside the Docker network.
const KAFKA_BROKER = process.env.KAFKA_BROKER || "redpanda:29092";

// Where Jira (the simulator in v1) lives, and how long we wait for it.
const JIRA_URL = process.env.JIRA_URL || "http://jira-sim:3000";
const JIRA_TIMEOUT_MS = Number(process.env.JIRA_TIMEOUT_MS || 2000);

// The shared value Jira signs webhooks with. It always comes from the environment.
const SIGNING_KEY_TEXT = process.env.WEBHOOK_SECRET || "";

// Our own service account. Webhooks caused by it are ignored.
const BOT_ACCOUNT = process.env.BOT_ACCOUNT || "story-readiness-bot";

// Print one structured log line as JSON, like every Lab2 service.
function log(fields) {
  const line = { ts: new Date().toISOString(), service: SERVICE, instance: process.env.HOSTNAME || "local" };
  Object.assign(line, fields);
  console.log(JSON.stringify(line));
}

// The Jira client and the Kafka producer.
const jira = createJiraClient({ baseUrl: JIRA_URL, timeoutMs: JIRA_TIMEOUT_MS, actor: BOT_ACCOUNT });
const publisher = createPublisher({ broker: KAFKA_BROKER, clientId: SERVICE, log: log });

// ---------------------------------------------------------------------
// ONE STORY AT A TIME
// Two webhooks for the same story can arrive together. We handle them one after
// the other, so the event published last is always built from the freshest read.
// ---------------------------------------------------------------------

// The work still running for each story key.
const storyQueues = new Map();

// Run work() for one story after any earlier work for the same story has finished.
function withStoryLock(key, work) {
  // The work already queued for this story, or nothing.
  const previous = storyQueues.get(key) || Promise.resolve();
  // Start ours when theirs is done, whether it worked or not.
  const mine = previous.then(work, work);
  storyQueues.set(key, mine);
  // When ours is done and nothing newer is queued, forget the key.
  function cleanUp() {
    if (storyQueues.get(key) === mine) {
      storyQueues.delete(key);
    }
  }
  mine.then(cleanUp, cleanUp);
  return mine;
}

// Find "CR-12" style mentions in the story's text.
function mentionedCrKeys(issue) {
  // The text fields a BA writes in.
  const all = [issue.summary, issue.iWant, issue.soThat, issue.acceptanceCriteria, issue.technicalNotes].map(function (t) { return t || ""; }).join("\n");
  // Every distinct match, in the order found.
  const found = all.match(/\bCR-[0-9]+\b/g) || [];
  return Array.from(new Set(found));
}

// Read a story fresh, auto-link any CR it mentions, read its CRs, and publish StoryChanged.
// Returns the event, or null if the story does not exist.
function publishStory(key, trigger, requestId) {
  return withStoryLock(key, async function () {
    // Read the story as it is saved right now.
    let issue = await jira.getIssue(key);
    // Gone, or not a story: nothing to publish.
    if (!issue || issue.type !== "Story") {
      return null;
    }

    // AUTO-LINK. A BA wrote "CR-12" but forgot the link: add it for them, as the bot.
    const linkedKeys = translate.translateLinks(issue.links).map(function (l) { return l.key; });
    let addedLink = false;
    for (const crKey of mentionedCrKeys(issue)) {
      // Already linked: nothing to do.
      if (linkedKeys.indexOf(crKey) !== -1) {
        continue;
      }
      // It must exist and be a Change Request.
      const cr = await jira.getIssue(crKey);
      if (!cr || cr.type !== "Change Request") {
        continue;
      }
      // Link it and say so.
      await jira.linkImplements(key, crKey);
      log({ level: "info", event: "cr_auto_linked", story_key: key, cr_key: crKey, request_id: requestId });
      addedLink = true;
    }
    // A new link changed the story, so read it again.
    if (addedLink) {
      issue = await jira.getIssue(key);
      if (!issue) {
        return null;
      }
    }

    // Read every CR the story implements, each one fresh.
    const crIssues = [];
    for (const crKey of translate.implementedCrKeys(translate.translateStory(issue))) {
      const cr = await jira.getIssue(crKey);
      if (cr) {
        crIssues.push(cr);
      }
    }

    // Translate and publish. occurred_at is taken after the last read, so later means fresher.
    const event = translate.buildStoryChanged(issue, crIssues, trigger, crypto.randomUUID(), new Date().toISOString());
    await publisher.publish(event);
    log({ level: "info", event: "published", event_id: event.event_id, story_key: key, trigger: trigger, request_id: requestId });
    return event;
  });
}

// The stories linked to a CR, from the CR's own view.
function linkedStoryKeys(crIssue) {
  return translate.translateLinks(crIssue.links)
    .filter(function (l) { return l.issue_type === "Story"; })
    .map(function (l) { return l.key; });
}

// Turn a failure into the right answer: 503 if Jira or Kafka is in trouble.
function answerFailure(res, err, requestId, context) {
  if (err instanceof JiraUnavailable) {
    log({ level: "error", event: "jira_call_failed", request_id: requestId, context: context, message: String(err.message) });
    res.status(503).json({ error: "jira_unavailable", message: "Jira did not answer. Retry later.", request_id: requestId });
    return;
  }
  log({ level: "error", event: "publish_failed", request_id: requestId, context: context, message: String(err.message) });
  res.status(503).json({ error: "publish_failed", message: "The event could not be published. Retry later.", request_id: requestId });
}

// Create the application object.
const app = express();

// LIVENESS. "Am I alive?" It checks nothing outside this process.
app.get("/health", function (req, res) {
  res.json({ status: "ok", service: SERVICE });
});

// READINESS. Ready once the producer is connected and the topics exist.
app.get("/ready", function (req, res) {
  if (publisher.isReady()) {
    res.json({ ready: true, service: SERVICE });
    return;
  }
  res.status(503).json({ ready: false, service: SERVICE, reason: "kafka_not_connected" });
});

// A Jira webhook. The body is read raw, because the signature covers the exact bytes.
app.post("/webhook", express.raw({ type: "*/*", limit: "1mb" }), async function (req, res) {
  // The id the gateway gave this call, so every log line can be joined up.
  const requestId = req.get("X-Request-Id") || null;
  // The exact bytes that were sent.
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  log({ level: "info", event: "webhook_received", request_id: requestId, bytes: raw.length });

  // 1. The signature must match, or we refuse.
  if (!signature.verify(raw, req.get("X-Hub-Signature"), SIGNING_KEY_TEXT)) {
    log({ level: "warn", event: "signature_rejected", request_id: requestId });
    res.status(401).json({ error: "bad_signature", message: "X-Hub-Signature is missing or wrong", request_id: requestId });
    return;
  }

  // 2. Read the JSON.
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch (err) {
    res.status(400).json({ error: "invalid_json", message: "The webhook body is not valid JSON", request_id: requestId });
    return;
  }
  // The issue the webhook is about.
  const issueKey = payload && payload.issue ? payload.issue.key : null;

  // 3. Decide whether to act.
  const decision = filter.decide(payload, BOT_ACCOUNT);
  if (!decision.act) {
    log({ level: "info", event: "webhook_ignored", reason: decision.reason, story_key: issueKey, request_id: requestId });
    res.status(202).json({ accepted: false, reason: decision.reason });
    return;
  }

  try {
    // 4. Which stories to publish for: the story itself, or every story linked to the CR.
    let storyKeys = [issueKey];
    if (decision.trigger === "cr_changed") {
      const cr = await jira.getIssue(issueKey);
      storyKeys = cr ? linkedStoryKeys(cr) : [];
    }
    // 5. Publish one StoryChanged per story, each read fresh.
    const eventIds = [];
    for (const key of storyKeys) {
      const event = await publishStory(key, decision.trigger, requestId);
      if (event) {
        eventIds.push(event.event_id);
      }
    }
    res.status(202).json({ accepted: true, published: eventIds.length, event_ids: eventIds });
  } catch (err) {
    answerFailure(res, err, requestId, "webhook");
  }
});

// Ask for one story to be checked again.
app.post("/v1/stories/:key/recheck", async function (req, res) {
  const requestId = req.get("X-Request-Id") || null;
  const key = req.params.key;
  try {
    const event = await publishStory(key, "recheck", requestId);
    // Unknown story: say so clearly.
    if (!event) {
      res.status(404).json({ error: "story_not_found", message: "No story with key " + key, request_id: requestId });
      return;
    }
    res.status(202).json({ published: 1, event_id: event.event_id });
  } catch (err) {
    answerFailure(res, err, requestId, "recheck");
  }
});

// Anything else does not exist. Say so in JSON.
app.use(function (req, res) {
  res.status(404).json({ error: "route_not_found", message: "No such route on intake", request_id: req.get("X-Request-Id") || null });
});

// Start listening first, so /health answers while Kafka is still starting.
const server = app.listen(PORT, function () {
  log({ level: "info", event: "started", port: PORT });
  // Then connect to Kafka, patiently. /ready stays 503 until this is done.
  publisher.connect();
});

// Graceful stop: disconnect the producer, then exit 0.
process.on("SIGTERM", async function () {
  log({ level: "info", event: "stopping" });
  try {
    await publisher.disconnect();
  } catch (err) {
    // Already gone. Nothing more to do.
  }
  server.close(function () {
    process.exit(0);
  });
});
