// Container checks: which C4 containers does the story touch?
// I-CON-01 (level 3, block), I-UNK-01 (3, warn), I-SIZE-01 (4, warn).
// This file also works out the impacted containers, which the other Impact checks need.

// The shared text helpers. This service keeps its own copy (ADR-001).
const { findTerms, normaliseName, result } = require("../match");

// The texts a check can look in. A missing field counts as "".
//   ALL   = summary, i_want, so_that, acceptance_criteria, technical_notes
//   NOTES = technical_notes
function storyTexts(story) {
  function field(name) {
    return story[name] === undefined || story[name] === null ? "" : String(story[name]);
  }
  return {
    ALL: [field("summary"), field("i_want"), field("so_that"), field("acceptance_criteria"), field("technical_notes")].join("\n"),
    NOTES: field("technical_notes")
  };
}

// The impacted containers, as [{ id, name }], in impact-map.yaml order.
// A container counts if it is in containers.puml and one of its keywords is in the story.
function impactedContainers(event, config) {
  const all = storyTexts(event.story).ALL;
  // Container names by id, from containers.puml.
  const names = {};
  for (const c of config.architecture.containers) {
    names[c.id] = c.name;
  }
  const map = config.impactMap.containers || {};
  return Object.keys(map)
    // Skip ids the diagram does not have. The service warns about them at startup.
    .filter(function (id) { return names[id] !== undefined; })
    // Keep the ones whose keywords appear in the story.
    .filter(function (id) { return findTerms(all, map[id]).length > 0; })
    .map(function (id) { return { id: id, name: names[id] }; });
}

// Does this text name a container, by id or normalised name? Used to compare free text with the diagram.
function namesContainer(text, containers) {
  const wanted = normaliseName(text);
  return containers.some(function (c) {
    return c.id === wanted || normaliseName(c.id) === wanted || normaliseName(c.name) === wanted;
  });
}

function containerChecks(event, config) {
  const all = storyTexts(event.story).ALL;
  const impacted = impactedContainers(event, config);
  const names = impacted.map(function (c) { return c.name; });

  // I-CON-01: at least one container is impacted.
  const con01 = impacted.length > 0
    ? result("I-CON-01", 3, "block", true, "Impacted: " + names.join(", "))
    : result("I-CON-01", 3, "block", false, "No impacted container found; mention the business area");

  // I-UNK-01: every "Something service" or "Something system" in the story is in the diagram.
  const unknown = [];
  for (const match of all.matchAll(/\b([A-Z][A-Za-z]+) (service|system)\b/g)) {
    const known = namesContainer(match[1], config.architecture.containers) || namesContainer(match[0], config.architecture.containers);
    if (!known && unknown.indexOf(match[0]) === -1) {
      unknown.push(match[0]);
    }
  }
  const unk01 = unknown.length === 0
    ? result("I-UNK-01", 3, "warn", true, "No unknown components")
    : result("I-UNK-01", 3, "warn", false, "Not in containers.puml: " + unknown.join(", "));

  // I-SIZE-01: the story does not touch too many containers.
  const size01 = impacted.length <= config.impactMap.max_containers
    ? result("I-SIZE-01", 4, "warn", true, "Touches " + impacted.length + " container(s)")
    : result("I-SIZE-01", 4, "warn", false, "Touches " + impacted.length + " containers; consider splitting");

  return [con01, unk01, size01];
}

module.exports = {
  containerChecks: containerChecks,
  impactedContainers: impactedContainers,
  namesContainer: namesContainer,
  storyTexts: storyTexts
};
