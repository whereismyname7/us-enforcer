// The simulator's memory: issues, keys, links, comments, properties and timestamps.
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

// The two link types, with the words Jira shows on each side.
// "NORTH-1 Implements CR-12" means NORTH-1 is the inward issue and CR-12 the outward one.
const LINK_TYPES = {
  Implements: { name: "Implements", inward: "implements", outward: "is implemented by" },
  Blocks: { name: "Blocks", inward: "blocks", outward: "is blocked by" }
};

// The story workflow. "from" null means the transition is allowed from any status.
const TRANSITIONS = [
  { id: "11", name: "Refinement", from: null },
  { id: "21", name: "Ready for Dev", from: null },
  { id: "31", name: "In Progress", from: "Ready for Dev" },
  { id: "41", name: "Done", from: "In Progress" }
];

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
  // Split at the last dash.
  const dash = key.lastIndexOf("-");
  return { project: key.slice(0, dash), number: Number(key.slice(dash + 1)) };
}

// Sort issue keys by project, then by number, so NORTH-2 comes before NORTH-10.
function compareKeys(a, b) {
  const pa = keyParts(a);
  const pb = keyParts(b);
  // Different projects sort by name.
  if (pa.project !== pb.project) {
    return pa.project < pb.project ? -1 : 1;
  }
  // Same project sorts by number.
  return pa.number - pb.number;
}

// Read "project = LOAD" (spaces and quotes optional). Returns "LOAD", or null if the JQL is anything else.
function parseJql(jql) {
  // One project, with an optional matching pair of quotes around it.
  const match = /^\s*project\s*=\s*(["']?)([A-Za-z][A-Za-z0-9]*)\1\s*$/i.exec(String(jql || ""));
  // Anything else is not supported by the simulator.
  if (!match) {
    return null;
  }
  // Project keys are upper case in Jira.
  return match[2].toUpperCase();
}

// Clean one incoming field value into the type the simulator stores.
function cleanValue(name, value) {
  // Lists must be lists of text.
  if (ARRAY_FIELDS.indexOf(name) !== -1) {
    // A missing list becomes empty.
    if (value === undefined || value === null) {
      return [];
    }
    // Anything that is not a list is refused.
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
//   baseUrl       used in each issue's "self" link
//   now           a clock function, so tests can control time (default Date.now)
function createStore(options) {
  // Our own bot. Its edits never reset readiness.
  const botAccount = options.botAccount;
  // The roles allowed to override the gate.
  const overrideRoles = options.overrideRoles;
  // The start of every "self" link.
  const baseUrl = options.baseUrl;
  // The clock. Tests pass their own to make two changes land in the same millisecond.
  const clock = options.now || Date.now;

  // Every issue by key.
  let issues;
  // Every link, as { type, inward, outward }.
  let links;
  // The next numeric id, for example 10001.
  let nextId;
  // The highest number used so far in each project.
  let lastNumber;
  // The next comment id.
  let nextCommentId;

  // Delete every issue and start all counters again.
  function reset() {
    issues = new Map();
    links = [];
    nextId = 10001;
    lastNumber = {};
    nextCommentId = 1;
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
    // Only stories are graded.
    if (issue.issuetype !== "Story") {
      return;
    }
    // The bot's own edits do not reset anything. This stops an update loop.
    if (actor === botAccount) {
      return;
    }
    issue.properties.readiness = { state: "Pending", story_updated_at: issue.updated };
    delete issue.properties.override;
  }

  // The small part of the other issue that a link shows.
  function linkedIssueView(key) {
    const other = issues.get(key);
    return { key: key, fields: { issuetype: { name: other.issuetype }, status: { name: other.status } } };
  }

  // The links of one issue, in the shape Jira returns them.
  function linksOf(key) {
    const out = [];
    for (const link of links) {
      // This issue is the inward one, so it shows the other side as outwardIssue.
      if (link.inward === key) {
        out.push({ type: LINK_TYPES[link.type], outwardIssue: linkedIssueView(link.outward) });
      } else if (link.outward === key) {
        // This issue is the outward one, so it shows the other side as inwardIssue.
        out.push({ type: LINK_TYPES[link.type], inwardIssue: linkedIssueView(link.inward) });
      }
    }
    return out;
  }

  // The full issue, exactly as GET /rest/api/v3/issue/{key} returns it.
  function view(issue) {
    // The fields every issue has, in the order Jira lists them.
    const fields = {
      project: { key: issue.project },
      issuetype: { name: issue.issuetype },
      summary: issue.content.summary,
      status: { name: issue.status }
    };
    // Story fields or Change Request fields.
    const names = issue.issuetype === "Story" ? STORY_CONTENT_FIELDS : CR_CONTENT_FIELDS;
    for (const name of names) {
      // Summary and status are already in place.
      if (name === "summary" || name === "status") {
        continue;
      }
      fields[name] = issue.content[name];
    }
    // Labels, links, comments and the two timestamps.
    fields.labels = issue.labels.slice();
    fields.issuelinks = linksOf(issue.key);
    fields.comment = { comments: issue.comments.slice() };
    fields.created = issue.created;
    fields.updated = issue.updated;
    // A deep copy, so a caller can never change our memory by accident.
    return JSON.parse(JSON.stringify({
      id: issue.id,
      key: issue.key,
      self: baseUrl + "/rest/api/v3/issue/" + issue.key,
      fields: fields,
      properties: issue.properties
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

    // Build the stored issue.
    const issue = {
      id: String(nextId),
      key: key,
      project: project,
      issuetype: issuetype,
      // Stories start in Refinement; a CR takes its status from the body, default Draft.
      status: issuetype === "Story" ? "Refinement" : (fields.status ? String(fields.status) : "Draft"),
      content: {},
      labels: cleanValue("labels", fields.labels),
      comments: [],
      properties: {}
    };
    nextId = nextId + 1;
    // Copy the content fields, with defaults for anything missing.
    const names = issuetype === "Story" ? STORY_CONTENT_FIELDS : CR_CONTENT_FIELDS;
    for (const name of names) {
      // A CR's status is kept on its own.
      if (name === "status") {
        continue;
      }
      issue.content[name] = cleanValue(name, fields[name]);
    }
    // Set both timestamps to now.
    touch(issue);
    issue.created = issue.updated;
    // Every new story starts Pending, whoever created it.
    if (issuetype === "Story") {
      issue.properties.readiness = { state: "Pending", story_updated_at: issue.updated };
    }
    // Save it.
    issues.set(key, issue);

    // Answer like Jira, and send one created webhook.
    return {
      body: { id: issue.id, key: key, self: baseUrl + "/rest/api/v3/issue/" + key },
      webhooks: [webhook("jira:issue_created", issue, actor, [])]
    };
  }

  // GET /rest/api/v3/issue/{key}. Returns null when the issue does not exist.
  function getIssue(key) {
    const issue = issues.get(key);
    return issue ? view(issue) : null;
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
    // Did any content field change?
    let contentChanged = false;

    // Look at every content field the caller sent.
    for (const name of contentNames) {
      if (!(name in fields)) {
        continue;
      }
      // A CR's status is stored on its own and logged with from and to.
      if (name === "status") {
        const next = String(fields.status && fields.status.name ? fields.status.name : fields.status);
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
    if (items.length === 0) {
      return { webhooks: [] };
    }
    return { webhooks: [webhook("jira:issue_updated", issue, actor, items)] };
  }

  // POST /rest/api/v3/issueLink: "inward <type> outward".
  function createLink(body, actor) {
    // Read the three parts of the link.
    const typeName = body && body.type && body.type.name ? String(body.type.name) : "";
    const inwardKey = body && body.inwardIssue && body.inwardIssue.key ? String(body.inwardIssue.key) : "";
    const outwardKey = body && body.outwardIssue && body.outwardIssue.key ? String(body.outwardIssue.key) : "";
    // Only the two known link types.
    if (!LINK_TYPES[typeName]) {
      throw new SimError(400, ["Link type must be Implements or Blocks"], {});
    }
    // Both sides are needed.
    if (!inwardKey || !outwardKey) {
      throw new SimError(400, ["Send inwardIssue.key and outwardIssue.key"], {});
    }
    // Both issues must exist.
    const inward = mustGet(inwardKey);
    const outward = mustGet(outwardKey);
    // A duplicate link is ignored, but the caller still gets 201.
    const duplicate = links.some(function (l) {
      return l.type === typeName && l.inward === inwardKey && l.outward === outwardKey;
    });
    if (duplicate) {
      return { webhooks: [] };
    }
    // Save the link.
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

  // GET .../properties/{prop}. Returns the value, or throws 404.
  function getProperty(key, prop) {
    const issue = mustGet(key);
    if (!(prop in issue.properties)) {
      throw new SimError(404, ["The property with key '" + prop + "' does not exist."], {});
    }
    return JSON.parse(JSON.stringify(issue.properties[prop]));
  }

  // PUT .../properties/{prop}. Any JSON value. Never moves "updated".
  function setProperty(key, prop, value) {
    const issue = mustGet(key);
    issue.properties[prop] = JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  // POST .../comment. Plain text in the simulator. Never moves "updated".
  function addComment(key, text, actor) {
    const issue = mustGet(key);
    // An empty comment is refused, like Jira does.
    if (typeof text !== "string" || text.trim() === "") {
      throw new SimError(400, [], { comment: "Comment body can not be empty!" });
    }
    const comment = { id: String(nextCommentId), author: { accountId: actor }, body: text, created: nowIso() };
    nextCommentId = nextCommentId + 1;
    issue.comments.push(comment);
    return { id: comment.id };
  }

  // GET .../transitions: the transitions allowed from the current status.
  function listTransitions(key) {
    const issue = mustGet(key);
    // CRs have no workflow in the simulator.
    if (issue.issuetype !== "Story") {
      return [];
    }
    return TRANSITIONS
      .filter(function (t) { return t.from === null || t.from === issue.status; })
      .map(function (t) { return { id: t.id, name: t.name }; });
  }

  // POST .../transitions. Ready for Dev runs the gate.
  function transition(key, body, actor) {
    const issue = mustGet(key);
    // Find the transition by id or by name.
    const wanted = body && body.transition ? body.transition : {};
    const found = TRANSITIONS.find(function (t) { return t.id === String(wanted.id) || t.name === wanted.name; });
    // Unknown, not a story, or not allowed from here.
    if (!found || issue.issuetype !== "Story" || (found.from !== null && found.from !== issue.status)) {
      throw new SimError(400, ["Transition not allowed from " + issue.status], {});
    }
    // Ready for Dev: ask the gate.
    let via = null;
    if (found.id === "21") {
      const decision = gate.evaluate(view(issue), body.override, overrideRoles);
      if (!decision.allowed) {
        const error = new SimError(400, [], {});
        error.body = decision.body;
        throw error;
      }
      via = decision.via;
      // An override leaves a trace: a property and a comment by the caller.
      if (via === "override") {
        const o = body.override;
        issue.properties.override = { by: o.by, role: o.role, reason: o.reason, at: nowIso() };
        addComment(key, "Override by " + o.by + " (" + o.role + "): " + o.reason, actor);
      }
    }
    // Move the status. A status change never moves "updated".
    const from = issue.status;
    issue.status = found.name;
    // Send a webhook only if the status really changed.
    if (from === found.name) {
      return { via: via, webhooks: [] };
    }
    return { via: via, webhooks: [webhook("jira:issue_updated", issue, actor, [{ field: "status", fromString: from, toString: found.name }])] };
  }

  // GET /rest/api/v3/search?jql=project = KEY&maxResults=N
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
    // Every issue in the project, in key order.
    const keys = Array.from(issues.keys())
      .filter(function (k) { return issues.get(k).project === project; })
      .sort(compareKeys);
    return { total: keys.length, issues: keys.slice(0, max).map(function (k) { return view(issues.get(k)); }) };
  }

  // GET /board: the developer board. Only stories that passed the gate, or were overridden.
  function board() {
    const out = [];
    const keys = Array.from(issues.keys()).sort(compareKeys);
    for (const k of keys) {
      const issue = issues.get(k);
      // Only stories that are in Ready for Dev.
      if (issue.issuetype !== "Story" || issue.status !== "Ready for Dev") {
        continue;
      }
      // Either a fresh L4 with a CR link, or an override.
      const v = view(issue);
      const overridden = !!issue.properties.override;
      if (!gate.passesReadyRule(v) && !overridden) {
        continue;
      }
      const readiness = issue.properties.readiness || {};
      out.push({ key: k, summary: issue.content.summary, level: readiness.level === undefined ? null : readiness.level, override: overridden });
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
    getProperty: getProperty,
    setProperty: setProperty,
    addComment: addComment,
    listTransitions: listTransitions,
    transition: transition,
    search: search,
    board: board
  };
}

module.exports = { createStore: createStore, parseJql: parseJql, SimError: SimError, TRANSITIONS: TRANSITIONS };
