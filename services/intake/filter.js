// Decides which webhooks Intake acts on. A pure function: payload in, decision out, no I/O.
// The decision is { act, reason, trigger }. "trigger" says why a StoryChanged is published.
// The table is in section 8.1 of the build spec.

// Story fields whose change means the story must be checked again.
const STORY_CONTENT_FIELDS = ["summary", "asA", "iWant", "soThat", "acceptanceCriteria", "technicalNotes", "dueDate"];

// Change Request fields whose change means every linked story must be checked again.
const CR_FIELDS = ["summary", "status", "impactedSystems", "inScope", "outOfScope", "targetDate", "issuelinks"];

// Small helpers that build the two kinds of answer.
function act(trigger) {
  return { act: true, reason: null, trigger: trigger };
}
function ignore(reason) {
  return { act: false, reason: reason, trigger: null };
}

// payload: the webhook body. botAccount: our own service account.
function decide(payload, botAccount) {
  // Who made the change.
  const actor = payload && payload.user ? payload.user.accountId : null;
  // Our own writes (grades, labels, comments) must never start another check. This stops an update loop.
  if (actor === botAccount) {
    return ignore("bot_event");
  }
  // What kind of issue changed.
  const fields = payload && payload.issue && payload.issue.fields ? payload.issue.fields : {};
  const issueType = fields.issuetype ? fields.issuetype.name : null;
  // created or updated.
  const eventName = payload ? payload.webhookEvent : null;
  // The names of every field in the changelog.
  const items = payload && payload.changelog && Array.isArray(payload.changelog.items) ? payload.changelog.items : [];
  const changed = items.map(function (i) { return i.field; });

  // Stories.
  if (issueType === "Story") {
    // A new story is always checked.
    if (eventName === "jira:issue_created") {
      return act("story_created");
    }
    if (eventName === "jira:issue_updated") {
      // Any content field changed.
      if (changed.some(function (f) { return STORY_CONTENT_FIELDS.indexOf(f) !== -1; })) {
        return act("story_updated");
      }
      // Only links changed.
      if (changed.indexOf("issuelinks") !== -1) {
        return act("links_changed");
      }
    }
    // Anything else, for example a status change, does not change the grade.
    return ignore("no_content_change");
  }

  // Change Requests.
  if (issueType === "Change Request") {
    // A new CR has no stories linked to it yet.
    if (eventName === "jira:issue_created") {
      return ignore("cr_without_stories");
    }
    // A change to its status, impact, scope, date or links: re-check every linked story.
    if (eventName === "jira:issue_updated" && changed.some(function (f) { return CR_FIELDS.indexOf(f) !== -1; })) {
      return act("cr_changed");
    }
    return ignore("no_content_change");
  }

  // Any other issue type is not ours to grade.
  return ignore("not_a_story");
}

module.exports = { decide: decide, STORY_CONTENT_FIELDS: STORY_CONTENT_FIELDS, CR_FIELDS: CR_FIELDS };
