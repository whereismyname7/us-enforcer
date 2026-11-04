// The "Ready for Dev" rule. This is the simulator's copy of the Jira workflow validator.
// It reads only the story's card (what is stored right now), so it is instant and works when our services are down.
// Every function here is pure: it looks at the data it is given and changes nothing.

// The error a BA sees when the story is not ready yet.
const NOT_READY_MESSAGE = "This story is not ready for development. See the readiness comment for what is missing.";

// The error for an override that is missing a role, a name or a reason.
const BAD_OVERRIDE_MESSAGE = "Override needs an allowed role, a name and a reason of at least 5 characters";

// Does the story implement a Change Request?
function hasCrLink(card) {
  return (card.links || []).some(function (l) {
    return l.relation === "implements" && l.type === "Change Request";
  });
}

// Rule 1, "Ready": a fresh L4 grade and a CR link. The card shows "Pending" for a missing or stale grade.
function passesReadyRule(card) {
  return card.type === "Story" && card.level === "L4" && hasCrLink(card);
}

// Rule 2, "Override": an allowed role, a name and a reason of at least 5 characters.
// roles is the list from OVERRIDE_ROLES, for example ["architect", "product-owner"].
function isValidOverride(override, roles) {
  // An override must be an object.
  if (!override || typeof override !== "object") {
    return false;
  }
  // The role must be one of the allowed roles.
  if (roles.indexOf(override.role) === -1) {
    return false;
  }
  // Somebody must put their name on it.
  if (typeof override.by !== "string" || override.by.trim() === "") {
    return false;
  }
  // The reason must say something real, at least 5 characters.
  return typeof override.reason === "string" && override.reason.trim().length >= 5;
}

// Decide one attempt to move a story to Ready for Dev.
// Returns { allowed: true, via: "ready" | "override" }, or { allowed: false, body } with the 400 body.
function evaluate(card, override, roles) {
  // The caller sent an override, so judge the override.
  if (override !== undefined && override !== null) {
    // A badly formed override is refused with its own message.
    if (!isValidOverride(override, roles)) {
      return { allowed: false, body: { errorMessages: [BAD_OVERRIDE_MESSAGE], errors: {} } };
    }
    // A good override always lets the story through, and leaves a trace.
    return { allowed: true, via: "override" };
  }
  // No override, so the story must pass the ready rule.
  if (passesReadyRule(card)) {
    return { allowed: true, via: "ready" };
  }
  // Refuse, and say which level the story is at: "L1", or "Pending" if this version is not graded yet.
  return { allowed: false, body: { errorMessages: [NOT_READY_MESSAGE], errors: { readiness: card.level } } };
}

// Make these functions available to store.js and the tests.
module.exports = {
  hasCrLink: hasCrLink,
  passesReadyRule: passesReadyRule,
  isValidOverride: isValidOverride,
  evaluate: evaluate
};
