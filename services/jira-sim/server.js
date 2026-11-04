// A small stand-in for Jira. Data lives in memory, so a restart starts empty.
// In the real product this is Jira plus a thin app: a workflow validator and a readiness field.
const express = require("express");

const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://gateway/webhook";
const ISSUE = "/rest/api/v3/issue";

let issues = new Map();
let counters = {};
let lastTick = 0;

function log(fields) {
  console.log(JSON.stringify(Object.assign({ ts: new Date().toISOString(), service: "jira-sim" }, fields)));
}

// "updated" always moves forward, so a grade for an older version can be recognised.
function tick() {
  lastTick = Math.max(Date.now(), lastTick + 1);
  return new Date(lastTick).toISOString();
}

// Tell our system a story changed. Try three times, because a lost webhook leaves a story Pending.
async function sendWebhook(key) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookEvent: "jira:issue_updated", issue: { key: key } }),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) return;
      log({ level: "warn", event: "webhook_failed", key: key, status: res.status, attempt: attempt });
    } catch (err) {
      log({ level: "warn", event: "webhook_failed", key: key, message: String(err.message), attempt: attempt });
    }
    await new Promise(function (resolve) { setTimeout(resolve, 1000 * attempt); });
  }
}

// Any human edit makes the old grade worthless: back to Pending, and check again.
function storyChanged(story) {
  story.updated = tick();
  story.status = "Pending";
  story.missing = [];
  sendWebhook(story.key);
}

// A story has two values. status is its readiness: Pending or L0 to L4. workflowStatus is its board column.
// A person may edit a story's text, but never these. They go through the Reporter and the gate.
function editable(type, fields) {
  if (type !== "Story") return fields;
  const copy = Object.assign({}, fields);
  ["status", "workflowStatus", "missing", "comments", "updated", "key", "type"].forEach(function (f) { delete copy[f]; });
  return copy;
}

const app = express();
app.use(express.json());

// Let Swagger UI call this API from another port.
app.use(function (req, res, next) {
  res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET,POST,PUT" });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", function (req, res) {
  res.json({ status: "ok", service: "jira-sim" });
});

// Create a story or a Change Request. A CR may choose its key, such as CR-12.
app.post(ISSUE, function (req, res) {
  const fields = (req.body && req.body.fields) || {};
  const type = fields.issuetype && fields.issuetype.name;
  if (type !== "Story" && type !== "Change Request") {
    return res.status(400).json({ errorMessages: ["issuetype must be Story or Change Request"] });
  }
  const project = (fields.project && fields.project.key) || (type === "Story" ? "NORTH" : "CR");
  counters[project] = (counters[project] || 0) + 1;
  const key = req.body.key || project + "-" + counters[project];
  if (issues.has(key)) {
    return res.status(409).json({ errorMessages: [key + " already exists"] });
  }
  const issue = Object.assign({}, editable(type, fields), { key: key, type: type, comments: [] });
  if (type === "Story") issue.workflowStatus = "Refinement";
  delete issue.issuetype;
  delete issue.project;
  issues.set(key, issue);
  log({ level: "info", event: "issue_created", key: key });
  if (type === "Story") storyChanged(issue);
  res.status(201).json({ key: key });
});

app.get(ISSUE + "/:key", function (req, res) {
  const issue = issues.get(req.params.key);
  if (!issue) return res.status(404).json({ errorMessages: ["Issue does not exist"] });
  res.json(issue);
});

// Edit a story or a CR. Editing a CR re-checks every story that implements it.
app.put(ISSUE + "/:key", function (req, res) {
  const issue = issues.get(req.params.key);
  if (!issue) return res.status(404).json({ errorMessages: ["Issue does not exist"] });
  Object.assign(issue, editable(issue.type, (req.body && req.body.fields) || {}));
  if (issue.type === "Story") {
    storyChanged(issue);
  } else {
    for (const story of issues.values()) {
      if (story.crKey === issue.key) storyChanged(story);
    }
  }
  res.sendStatus(204);
});

// THE GATE. It reads only the stored status, so it stays closed when our services are down.
app.post(ISSUE + "/:key/transitions", function (req, res) {
  const story = issues.get(req.params.key);
  if (!story) return res.status(404).json({ errorMessages: ["Issue does not exist"] });
  if (story.type !== "Story" || story.status !== "L4") {
    log({ level: "info", event: "gate_refused", key: story.key, readiness: story.status });
    return res.status(400).json({ errorMessages: ["This story is not ready for development. See the readiness comment for what is missing."], errors: { readiness: story.status } });
  }
  story.workflowStatus = "Ready for Dev";
  res.sendStatus(204);
});

// The Reporter writes a grade here. One comment per change, and a story that dropped below L4 moves back.
app.put(ISSUE + "/:key/readiness", function (req, res) {
  const story = issues.get(req.params.key);
  if (!story) return res.status(404).json({ errorMessages: ["Issue does not exist"] });
  const grade = req.body;
  // The grade is for an older version of the story, so a newer check is already on its way.
  if (grade.story_updated_at !== story.updated) return res.sendStatus(409);
  story.status = grade.level;
  story.missing = grade.missing;
  let comment = grade.comment;
  if (story.workflowStatus === "Ready for Dev" && grade.level !== "L4") {
    story.workflowStatus = "Refinement";
    comment = "Moved back to Refinement: readiness dropped to " + grade.level + ".\n\n" + comment;
  }
  const fingerprint = JSON.stringify([grade.level, grade.missing]);
  if (story.lastGrade !== fingerprint) {
    story.comments.push({ author: "story-readiness-bot", body: comment });
    story.lastGrade = fingerprint;
  }
  res.sendStatus(204);
});

// The developer board shows only stories that passed the gate.
app.get("/board", function (req, res) {
  const ready = Array.from(issues.values()).filter(function (i) { return i.workflowStatus === "Ready for Dev"; });
  res.json({ issues: ready.map(function (i) { return { key: i.key, summary: i.summary, status: i.status }; }) });
});

// Start over, for the demo.
app.post("/admin/reset", function (req, res) {
  issues = new Map();
  counters = {};
  res.sendStatus(204);
});

app.listen(3000, function () {
  log({ level: "info", event: "started" });
});
