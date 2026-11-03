// The anti-corruption layer (ADR-005). Jira's field names stop here.
// These pure functions turn a Jira issue into the event fields every other service uses.
// If Jira renames a field, only this file changes.

// Missing text becomes "".
function text(value) {
  return value === undefined || value === null ? "" : String(value);
}

// Missing lists become [].
function list(value) {
  return Array.isArray(value) ? value.map(String) : [];
}

// Missing dates become null.
function date(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

// The relation name for each link type, seen from the story's side.
// The story is the inward issue when Jira shows the other side as outwardIssue.
const RELATIONS = {
  Implements: { inward: "implements", outward: "is_implemented_by" },
  Blocks: { inward: "blocks", outward: "is_blocked_by" }
};

// Turn Jira's issuelinks into our links: { relation, key, issue_type, status }.
function translateLinks(issuelinks) {
  const out = [];
  for (const link of issuelinks || []) {
    // Skip link types we do not know.
    const names = RELATIONS[link.type && link.type.name];
    if (!names) {
      continue;
    }
    // Which side is the other issue on, and so which relation applies.
    const other = link.outwardIssue || link.inwardIssue;
    const relation = link.outwardIssue ? names.inward : names.outward;
    const otherFields = other.fields || {};
    out.push({
      relation: relation,
      key: other.key,
      issue_type: otherFields.issuetype ? otherFields.issuetype.name : "",
      status: otherFields.status ? otherFields.status.name : ""
    });
  }
  return out;
}

// Turn a Jira story into the event's "story" object.
function translateStory(issue) {
  const f = issue.fields || {};
  return {
    summary: text(f.summary),
    as_a: text(f.asA),
    i_want: text(f.iWant),
    so_that: text(f.soThat),
    acceptance_criteria: text(f.acceptanceCriteria),
    technical_notes: text(f.technicalNotes),
    due_date: date(f.dueDate),
    status: f.status ? text(f.status.name) : "",
    links: translateLinks(f.issuelinks)
  };
}

// Turn a Jira Change Request into one entry of "change_requests".
function translateChangeRequest(issue) {
  const f = issue.fields || {};
  return {
    key: issue.key,
    status: f.status ? text(f.status.name) : "",
    impacted_systems: list(f.impactedSystems),
    in_scope: list(f.inScope),
    out_of_scope: list(f.outOfScope),
    target_date: date(f.targetDate),
    updated_at: text(f.updated)
  };
}

// The keys of every CR the story implements. Intake fetches each one fresh.
function implementedCrKeys(story) {
  return story.links
    .filter(function (l) { return l.relation === "implements" && l.issue_type === "Change Request"; })
    .map(function (l) { return l.key; });
}

// Build one StoryChanged v1 event.
// issue: the Jira story. crIssues: the Jira CRs it implements. trigger: why we publish.
function buildStoryChanged(issue, crIssues, trigger, eventId, occurredAt) {
  return {
    event_id: eventId,
    type: "StoryChanged",
    version: 1,
    occurred_at: occurredAt,
    story_key: issue.key,
    story_updated_at: text(issue.fields.updated),
    trigger: trigger,
    story: translateStory(issue),
    change_requests: crIssues.map(translateChangeRequest)
  };
}

module.exports = {
  translateLinks: translateLinks,
  translateStory: translateStory,
  translateChangeRequest: translateChangeRequest,
  implementedCrKeys: implementedCrKeys,
  buildStoryChanged: buildStoryChanged
};
