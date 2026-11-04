// The simulator's memory: issues, keys, links, comments, readiness and timestamps.
// Nothing here talks to the network. Each change returns the webhooks to send,
// and server.js sends them after it has answered the caller.
// Everything is lost when the container restarts, on purpose (ADR-008).

// The Ready for Dev rule lives in its own file.
const gate = require("./gate");

// The story fields whose change counts as a content change and moves "updated".
const STORY_CONTENT_FIELDS = ["summary", "asA", "iWant", "soThat", "acceptanceCriteria", "technicalNotes", "dueDate"];

// The Change Request fields whose change counts as a content change.
const CR_CONTENT_FIELDS = ["summary", "status", "impactedSystems", "inScope", "outOfScope", "targetDate"];

// Fields that hold a list of strings.
const ARRAY_FIELDS = ["impactedSystems", "inScope", "outOfScope", "labels"];

// Fields that hold a date such as 2026-12-15, or null.
const DATE_FIELDS = ["dueDate", "targetDate"];

// The two link types. "NORTH-1 Implements CR-12" means NORTH-1 is the inward issue and CR-12 the outward one.
// The card shows each link from its own side: "implements" on the story, "is_implemented_by" on the CR.
const LINK_RELATIONS = {
  Implements: { inward: "implements", outward: "is_implemented_by" },
  Blocks: { inward: "blocks", outward: "is_blocked_by" }
};

// The only two statuses a story can be moved to. Everything else is out of scope.
const STATUSES = ["Refinement", "Ready for Dev"];

// The message Jira gives when an issue key is unknown.
const NOT_FOUND_MESSAGE = "Issue does not exist or you do not have permission to see it.";

// An error that carries a status code and a body in Jira's shape.
class SimError extends Error {
  constructor(status, errorMessages, errors) {
    // Keep the first message as the normal error text, for logs.
    super(errorMessages[0] || "simulator error");
    // The HTTP status to answer with: 400, 404 or 409.
    this.status = status;
    // Jira's error body: a list of messages plus a field-by-field object.
    this.body = { errorMessages: errorMessages, errors: errors || {} };
  }
}

// Turn "NORTH-12" into the parts we sort by: the project and the number.
function keyParts(key) {
  const dash = key.lastIndexOf("-");
  return { project: key.slice(0, dash), number: Number(key.slice(dash + 1)) };
}

// Sort issue keys by project, then by number, so NORTH-2 comes before NORTH-10.
function compareKeys(a, b) {
  const pa = keyParts(a);
  const pb = keyParts(b);
  if (pa.project !== pb.project) {
    return pa.project < pb.project ? -1 : 1;
  }
  return pa.number - pb.number;
}

// Read "project = LOAD" (spaces and quotes optional). Returns "LOAD", or null if the JQL is anything else.
function parseJql(jql) {
  const match = /^\s*project\s*=\s*(["']?)([A-Za-z][A-Za-z0-9]*)\1\s*$/i.exec(String(jql || ""));
  return match ? match[2].toUpperCase() : null;
}

// Clean one incoming field value into the type the simulator stores.
function cleanValue(name, value) {
  // Lists must be lists of text.
  if (ARRAY_FIELDS.indexOf(name) !== -1) {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new SimError(400, [], { [name]: "Must be a list of strings" });
    }
    return value.map(String);
  }
  // Dates are text, or null when not set.
  if (DATE_FIELDS.indexOf(name) !== -1) {
    return value === undefined || value === null || value === "" ? null : String(value);
  }
  // Everything else is plain text; missing text becomes "".
  return value === undefined || value === null ? "" : String(value);
}

// Build a new, empty store. Options:
//   botAccount    the account id of our own service account
//   overrideRoles the roles allowed to override the gate
//   now           a clock function, so tests can control time (default Date.now)
function createStore(options) {
  // Our own bot. Its edits never reset readiness.
  const botAccount = options.botAccount;
  // The roles allowed to override the gate.
  const overrideRoles = options.overrideRoles;
  // The clock. Tests pass their own to make two changes land in the same millisecond.
  const clock = options.now || Date.now;

  // Every issue by key, every link as { type, inward, outward }, and the highest number used per project.
  let issues;
  let links;
  let lastNumber;

  // Delete every issue and start all counters again.
  function reset() {
    issues = new Map();
    links = [];
    lastNumber = {};
  }

  // Start empty.
  reset();

  // The current time as ISO text with milliseconds, in UTC.
  function nowIso() {
    return new Date(clock()).toISOString();
  }

  // Find an issue or answer 404.
  function mustGet(key) {
    const issue = issues.get(key);
    if (!issue) {
      throw new SimError(404, [NOT_FOUND_MESSAGE], {});
    }
    return issue;
  }

  // Find a story or answer 400.
  function mustGetStory(key) {
    const issue = mustGet(key);
    if (issue.issuetype !== "Story") {
      throw new SimError(400, ["Only stories have readiness and a workflow"], {});
    }
    return issue;
  }

  // A content or link change: move "updated" forward.
  // If two changes land in the same millisecond, add 1 ms so "updated" always increases.
  function touch(issue) {
    let ms = clock();
    if (issue.updatedMs !== undefined && ms <= issue.updatedMs) {
      ms = issue.updatedMs + 1;
    }
    issue.updatedMs = ms;
    issue.updated = new Date(ms).toISOString();
  }

  // A human changed a story's content or links: readiness goes back to Pending,
  // and any override is removed, because it was given for an older version.
  function resetReadiness(issue, actor) {
    // Only stories are graded, and the bot's own edits reset nothing. This stops an update loop.
    if (issue.issuetype !== "Story" || actor === botAccount) {
      return;
    }
    issue.readiness = { state: "Pending", story_updated_at: issue.updated };
    issue.override = null;
  }

  // The links of one issue, each seen from this issue's side.
  function linksOf(key) {
    const out = [];
    for (const link of links) {
      const names = LINK_RELATIONS[link.type];
      // This issue is the inward one ("NORTH-1 implements CR-12"), or the outward one.
      const otherKey = link.inward === key ? link.outward : link.outward === key ? link.inward : null;
      if (!otherKey) {
        continue;
      }
      const other = issues.get(otherKey);
      out.push({ relation: link.inward === key ? names.inward : names.outward, key: otherKey, type: other.issuetype, status: other.status });
    }
    return out;
  }

  // Add a plain-text comment. Only the simulator itself calls this (overrides and grades).
  function addComment(issue, text, actor) {
    issue.comments.push({ author: actor, body: text, created: nowIso() });
  }

  // The card: the short view of an issue that GET returns. The level and status come first.
  // "level" is "L0" to "L4" for a grade of the version saved right now, otherwise "Pending".
  function card(issue) {
    // Links, newest comment first.
    const linkList = linksOf(issue.key);
    const comments = issue.comments.slice().reverse();
    // A Change Request has no level.
    if (issue.issuetype !== "Story") {
      return JSON.parse(JSON.stringify({
        key: issue.key,
        type: issue.issuetype,
        status: issue.status,
        summary: issue.content.summary,
        impactedSystems: issue.content.impactedSystems,
        inScope: issue.content.inScope,
        outOfScope: issue.content.outOfScope,
        targetDate: issue.content.targetDate,
        links: linkList,
        labels: issue.labels,
        updated: issue.updated
      }));
    }
    // A grade counts only if it is for the version saved right now.
    const r = issue.readiness;
    const fresh = !!r && r.state === "Graded" && r.story_updated_at === issue.updated;
    // Each failed check as one short line: "R-AC-01: 1 criteria are not Given/When/Then".
    function lines(list) {
      return fresh ? (list || []).map(function (c) { return c.id + ": " + c.message; }) : [];
    }
    return JSON.parse(JSON.stringify({
      key: issue.key,
      type: issue.issuetype,
      level: fresh ? "L" + r.level : "Pending",
      status: issue.status,
      summary: issue.content.summary,
      missing: lines(r && r.failed),
      warnings: lines(r && r.warnings),
      asA: issue.content.asA,
      iWant: issue.content.iWant,
      soThat: issue.content.soThat,
      acceptanceCriteria: issue.content.acceptanceCriteria,
      technicalNotes: issue.content.technicalNotes,
      dueDate: issue.content.dueDate,
      links: linkList,
      labels: issue.labels,
      override: issue.override,
      comments: comments,
      updated: issue.updated,
      checkedAt: fresh ? r.checked_at : null
    }));
  }

  // The webhook body Jira sends after a change.
  function webhook(eventName, issue, actor, items) {
    return {
      webhookEvent: eventName,
      timestamp: clock(),
      user: { accountId: actor },
      issue: { key: issue.key, fields: { issuetype: { name: issue.issuetype }, project: { key: issue.project }, updated: issue.updated } },
      changelog: { items: items }
    };
  }

  // POST /rest/api/v3/issue
  function createIssue(body, actor) {
    // The body must have a fields object.
    const fields = body && typeof body.fields === "object" && body.fields ? body.fields : null;
    if (!fields) {
      throw new SimError(400, ["Send the issue as {\"fields\": {...}}"], {});
    }
    // Read the three required values.
    const project = fields.project && fields.project.key ? String(fields.project.key) : "";
    const issuetype = fields.issuetype && fields.issuetype.name ? String(fields.issuetype.name) : "";
    const summary = fields.summary ? String(fields.summary) : "";
    // Collect what is missing, field by field, the way Jira does.
    const errors = {};
    if (!project) {
      errors.project = "Specify a valid project ID or key";
    }
    if (!issuetype) {
      errors.issuetype = "Specify an issue type";
    } else if (issuetype !== "Story" && issuetype !== "Change Request") {
      errors.issuetype = "The simulator knows only Story and Change Request";
    }
    if (!summary) {
      errors.summary = "You must specify a summary of the issue.";
    }
    if (Object.keys(errors).length > 0) {
      throw new SimError(400, [], errors);
    }

    // Choose the key: the one given, or the next free number in the project.
    let key;
    let number;
    if (body.key !== undefined) {
      key = String(body.key);
      // The given key must belong to the project, for example NORTH-1 in NORTH.
      const match = /^(.+)-([0-9]+)$/.exec(key);
      if (!match || match[1] !== project) {
        throw new SimError(400, [], { key: "Key must look like " + project + "-<number>" });
      }
      // Two issues can never share a key.
      if (issues.has(key)) {
        throw new SimError(409, ["Issue " + key + " already exists"], {});
      }
      number = Number(match[2]);
    } else {
      // Count up from the highest number used, skipping any key already taken.
      number = (lastNumber[project] || 0) + 1;
      while (issues.has(project + "-" + number)) {
        number = number + 1;
      }
      key = project + "-" + number;
    }
    // Remember the highest number, so auto-numbering never reuses one.
    lastNumber[project] = Math.max(lastNumber[project] || 0, number);

    // Build the stored issue. Stories start in Refinement; a CR takes its status from the body, default Draft.
    const issue = {
      key: key,
      project: project,
      issuetype: issuetype,
      status: issuetype === "Story" ? "Refinement" : (fields.status ? String(fields.status) : "Draft"),
      content: {},
      labels: cleanValue("labels", fields.labels),
      comments: [],
      readiness: null,
      override: null
    };
    // Copy the content fields, with defaults for anything missing. A CR's status is kept on its own.
    const names = issuetype === "Story" ? STORY_CONTENT_FIELDS : CR_CONTENT_FIELDS;
    for (const name of names) {
      if (name !== "status") {
        issue.content[name] = cleanValue(name, fields[name]);
      }
    }
    // Set "updated" to now. Every new story starts Pending, whoever created it.
    touch(issue);
    if (issuetype === "Story") {
      issue.readiness = { state: "Pending", story_updated_at: issue.updated };
    }
    issues.set(key, issue);

    // Answer with the new key, and send one created webhook.
    return { body: { key: key }, webhooks: [webhook("jira:issue_created", issue, actor, [])] };
  }

  // GET /rest/api/v3/issue/{key}. Returns the card, or null when the issue does not exist.
  function getIssue(key) {
    const issue = issues.get(key);
    return issue ? card(issue) : null;
  }

  // PUT /rest/api/v3/issue/{key}: merge the given fields into the issue.
  function updateIssue(key, body, actor) {
    const issue = mustGet(key);
    // The body must have a fields object.
    const fields = body && typeof body.fields === "object" && body.fields ? body.fields : null;
    if (!fields) {
      throw new SimError(400, ["Send the change as {\"fields\": {...}}"], {});
    }
    // Which fields may be changed on this issue type.
    const contentNames = issue.issuetype === "Story" ? STORY_CONTENT_FIELDS : CR_CONTENT_FIELDS;
    // The changelog: one item per field whose value really changed.
    const items = [];
    let contentChanged = false;

    for (const name of contentNames) {
      if (!(name in fields)) {
        continue;
      }
      // A CR's status is stored on its own and logged with from and to.
      if (name === "status") {
        const next = String(fields.status);
        if (next !== issue.status) {
          items.push({ field: "status", fromString: issue.status, toString: next });
          issue.status = next;
          contentChanged = true;
        }
        continue;
      }
      // Compare the cleaned new value with the stored one.
      const next = cleanValue(name, fields[name]);
      if (JSON.stringify(next) !== JSON.stringify(issue.content[name])) {
        issue.content[name] = next;
        items.push({ field: name });
        contentChanged = true;
      }
    }
    // Labels can change too, but they are not content.
    if ("labels" in fields) {
      const next = cleanValue("labels", fields.labels);
      if (JSON.stringify(next) !== JSON.stringify(issue.labels)) {
        issue.labels = next;
        items.push({ field: "labels" });
      }
    }
    // A content change moves "updated" and, for a human, resets readiness.
    if (contentChanged) {
      touch(issue);
      resetReadiness(issue, actor);
    }
    // Nothing changed: no webhook.
    return { webhooks: items.length === 0 ? [] : [webhook("jira:issue_updated", issue, actor, items)] };
  }

  // POST /rest/api/v3/issueLink: "inward <type> outward". Used by Intake's auto-link and the smoke test.
  function createLink(body, actor) {
    const typeName = body && body.type && body.type.name ? String(body.type.name) : "";
    const inwardKey = body && body.inwardIssue && body.inwardIssue.key ? String(body.inwardIssue.key) : "";
    const outwardKey = body && body.outwardIssue && body.outwardIssue.key ? String(body.outwardIssue.key) : "";
    if (!LINK_RELATIONS[typeName]) {
      throw new SimError(400, ["Link type must be Implements or Blocks"], {});
    }
    if (!inwardKey || !outwardKey) {
      throw new SimError(400, ["Send inwardIssue.key and outwardIssue.key"], {});
    }
    const inward = mustGet(inwardKey);
    const outward = mustGet(outwardKey);
    // A duplicate link is ignored, but the caller still gets 201.
    if (links.some(function (l) { return l.type === typeName && l.inward === inwardKey && l.outward === outwardKey; })) {
      return { webhooks: [] };
    }
    links.push({ type: typeName, inward: inwardKey, outward: outwardKey });
    // A link is a content change for both issues.
    const webhooks = [];
    for (const issue of [inward, outward]) {
      touch(issue);
      resetReadiness(issue, actor);
      webhooks.push(webhook("jira:issue_updated", issue, actor, [{ field: "issuelinks" }]));
    }
    return { webhooks: webhooks };
  }

  // PUT /rest/api/v3/issue/{key}/readiness: the Reporter writes one grade in one call.
  // body: { value, comment?, labels?, status? }. Never moves "updated". One comment at most.
  function writeReadiness(key, body, actor) {
    const issue = mustGetStory(key);
    if (!body || typeof body.value !== "object" || body.value === null) {
      throw new SimError(400, ["Send the grade as {\"value\": {...}}"], {});
    }
    // The grade itself.
    issue.readiness = JSON.parse(JSON.stringify(body.value));
    // One comment for this grade, if the Reporter sent one.
    if (typeof body.comment === "string" && body.comment.trim() !== "") {
      addComment(issue, body.comment, actor);
    }
    // Labels and an optional move back. These are not content, but they are changes Jira reports.
    const items = [];
    if (Array.isArray(body.labels)) {
      const next = body.labels.map(String);
      if (JSON.stringify(next) !== JSON.stringify(issue.labels)) {
        issue.labels = next;
        items.push({ field: "labels" });
      }
    }
    if (body.status && STATUSES.indexOf(body.status) !== -1 && body.status !== issue.status) {
      items.push({ field: "status", fromString: issue.status, toString: body.status });
      issue.status = body.status;
    }
    return { webhooks: items.length === 0 ? [] : [webhook("jira:issue_updated", issue, actor, items)] };
  }

  // POST /rest/api/v3/issue/{key}/transitions: { "to": "Ready for Dev" } runs the gate; { "to": "Refinement" } moves back.
  function transition(key, body, actor) {
    const issue = mustGetStory(key);
    const to = body ? body.to : undefined;
    if (STATUSES.indexOf(to) === -1) {
      throw new SimError(400, ["Send {\"to\": \"Ready for Dev\"} or {\"to\": \"Refinement\"}"], {});
    }
    // Ready for Dev: ask the gate.
    let via = null;
    if (to === "Ready for Dev") {
      const decision = gate.evaluate(card(issue), body.override, overrideRoles);
      if (!decision.allowed) {
        const error = new SimError(400, [], {});
        error.body = decision.body;
        throw error;
      }
      via = decision.via;
      // An override leaves a trace: stored on the story, and one comment by the caller.
      if (via === "override") {
        const o = body.override;
        issue.override = { by: o.by, role: o.role, reason: o.reason, at: nowIso() };
        addComment(issue, "Override by " + o.by + " (" + o.role + "): " + o.reason, actor);
      }
    }
    // Move the status. A status change never moves "updated". Send a webhook only if it really changed.
    const from = issue.status;
    issue.status = to;
    if (from === to) {
      return { via: via, webhooks: [] };
    }
    return { via: via, webhooks: [webhook("jira:issue_updated", issue, actor, [{ field: "status", fromString: from, toString: to }])] };
  }

  // GET /rest/api/v3/search?jql=project = KEY&maxResults=N. Used by the load test.
  function search(jql, maxResults) {
    const project = parseJql(jql);
    if (!project) {
      throw new SimError(400, ["The simulator supports only the JQL \"project = KEY\""], {});
    }
    // Default 50, never more than 1000.
    let max = Number.parseInt(maxResults, 10);
    if (Number.isNaN(max)) {
      max = 50;
    }
    max = Math.min(Math.max(max, 0), 1000);
    const keys = Array.from(issues.keys())
      .filter(function (k) { return issues.get(k).project === project; })
      .sort(compareKeys);
    return { total: keys.length, issues: keys.slice(0, max).map(function (k) { return card(issues.get(k)); }) };
  }

  // GET /board: the developer board. Only stories in Ready for Dev that passed the gate, or were overridden.
  function board() {
    const out = [];
    for (const k of Array.from(issues.keys()).sort(compareKeys)) {
      const issue = issues.get(k);
      if (issue.issuetype !== "Story" || issue.status !== "Ready for Dev") {
        continue;
      }
      const c = card(issue);
      const overridden = !!issue.override;
      if (gate.passesReadyRule(c) || overridden) {
        out.push({ key: k, summary: c.summary, level: c.level, override: overridden });
      }
    }
    return { issues: out };
  }

  // Everything server.js and the tests may use.
  return {
    reset: reset,
    createIssue: createIssue,
    getIssue: getIssue,
    updateIssue: updateIssue,
    createLink: createLink,
    writeReadiness: writeReadiness,
    transition: transition,
    search: search,
    board: board
  };
}

module.exports = { createStore: createStore, parseJql: parseJql, SimError: SimError, STATUSES: STATUSES };
