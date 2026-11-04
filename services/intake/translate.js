// The anti-corruption layer (ADR-005). The simulator's field names stop here.
// These pure functions turn a story card into the event fields every other service uses.
// If Jira's shape changes, only this file changes.

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

// The relations we understand. The card already shows each link from the story's side.
const RELATIONS = ["implements", "is_implemented_by", "blocks", "is_blocked_by"];

// Turn the card's links into our links: { relation, key, issue_type, status }.
function translateLinks(links) {
  return (links || [])
    .filter(function (l) { return RELATIONS.indexOf(l.relation) !== -1; })
    .map(function (l) { return { relation: l.relation, key: l.key, issue_type: text(l.type), status: text(l.status) }; });
}

// Turn a story card into the event's "story" object.
function translateStory(card) {
  return {
    summary: text(card.summary),
    as_a: text(card.asA),
    i_want: text(card.iWant),
    so_that: text(card.soThat),
    acceptance_criteria: text(card.acceptanceCriteria),
    technical_notes: text(card.technicalNotes),
    due_date: date(card.dueDate),
    status: text(card.status),
    links: translateLinks(card.links)
  };
}

// Turn a Change Request card into one entry of "change_requests".
function translateChangeRequest(card) {
  return {
    key: card.key,
    status: text(card.status),
    impacted_systems: list(card.impactedSystems),
    in_scope: list(card.inScope),
    out_of_scope: list(card.outOfScope),
    target_date: date(card.targetDate),
    updated_at: text(card.updated)
  };
}

// The keys of every CR the story implements. Intake fetches each one fresh.
function implementedCrKeys(story) {
  return story.links
    .filter(function (l) { return l.relation === "implements" && l.issue_type === "Change Request"; })
    .map(function (l) { return l.key; });
}

// Build one StoryChanged v1 event.
// card: the story. crCards: the CRs it implements. trigger: why we publish.
function buildStoryChanged(card, crCards, trigger, eventId, occurredAt) {
  return {
    event_id: eventId,
    type: "StoryChanged",
    version: 1,
    occurred_at: occurredAt,
    story_key: card.key,
    story_updated_at: text(card.updated),
    trigger: trigger,
    story: translateStory(card),
    change_requests: crCards.map(translateChangeRequest)
  };
}

module.exports = {
  translateLinks: translateLinks,
  translateStory: translateStory,
  translateChangeRequest: translateChangeRequest,
  implementedCrKeys: implementedCrKeys,
  buildStoryChanged: buildStoryChanged
};
