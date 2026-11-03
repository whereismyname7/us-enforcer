// The "Ready for Dev" rule. This is the simulator's copy of the Jira workflow validator.
// It reads only what is stored on the issue, so it is instant and works when our services are down.
// Every function here is pure: it looks at the data it is given and changes nothing.

// The error a BA sees when the story is not ready yet.
const NOT_READY_MESSAGE = "This story is not ready for development. See the readiness comment for what is missing.";

// The error for an override that is missing a role, a name or a reason.
const BAD_OVERRIDE_MESSAGE = "Override needs an allowed role, a name and a reason of at least 5 characters";

// Does the story have an "Implements" link to a Change Request, with the story on the inward side?
// On the story's own view, such a link shows the CR as "outwardIssue".
function hasCrLink(view) {
  // Read the links, or use an empty list if there are none.
  const links = view.fields.issuelinks || [];
  // Keep looking until one link qualifies.
  return links.some(function (link) {
    // The link must be of type Implements.
    if (link.type.name !== "Implements") {
      return false;
    }
    // The story must be the inward issue, so the other side is the outward issue.
    if (!link.outwardIssue) {
      return false;
    }
    // The other side must be a Change Request.
    return link.outwardIssue.fields.issuetype.name === "Change Request";
  });
}

// Is the stored grade for the version that is saved right now?
// A grade for an older version does not count. That is the freshness check.
function isFreshGrade(view) {
  // The readiness property, written by the simulator (Pending) or the Reporter (Graded).
  const readiness = view.properties.readiness;
  // No property, or still Pending, means there is no grade at all.
  if (!readiness || readiness.state !== "Graded") {
    return false;
  }
  // The grade must be for exactly the saved version.
  return readiness.story_updated_at === view.fields.updated;
}

// Rule 1, "Ready": a fresh L4 grade and a CR link.
function passesReadyRule(view) {
  // Only stories are graded.
  if (view.fields.issuetype.name !== "Story") {
    return false;
  }
  // The grade must be fresh.
  if (!isFreshGrade(view)) {
    return false;
  }
  // The level must be the top one.
  if (view.properties.readiness.level !== 4) {
    return false;
  }
  // And the story must implement a Change Request.
  return hasCrLink(view);
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

// The text for errors.readiness: "L1" for a fresh grade, or "Pending" if this version is not graded yet.
function readinessLabel(view) {
  // A stale or missing grade counts as not graded yet.
  if (!isFreshGrade(view)) {
    return "Pending";
  }
  // Otherwise show the level, for example L3.
  return "L" + view.properties.readiness.level;
}

// Decide one attempt to move a story to Ready for Dev.
// Returns { allowed: true, via: "ready" | "override" }, or { allowed: false, body } with the 400 body.
function evaluate(view, override, roles) {
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
  if (passesReadyRule(view)) {
    return { allowed: true, via: "ready" };
  }
  // Refuse, and say which level the story is at.
  return { allowed: false, body: { errorMessages: [NOT_READY_MESSAGE], errors: { readiness: readinessLabel(view) } } };
}

// Make these functions available to store.js and the tests.
module.exports = {
  hasCrLink: hasCrLink,
  isFreshGrade: isFreshGrade,
  passesReadyRule: passesReadyRule,
  isValidOverride: isValidOverride,
  readinessLabel: readinessLabel,
  evaluate: evaluate
};
