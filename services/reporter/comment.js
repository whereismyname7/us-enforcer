// Builds the plain-text comment the Reporter posts on a story after grading it.
// grade is the readiness value from section 8.4 of the build spec.

function buildComment(grade) {
  const lines = [];
  // First line: the level, in words a BA understands at a glance.
  if (grade.level === 4) {
    lines.push("Story readiness: L4 of 4. Ready for development.");
  } else {
    lines.push("Story readiness: L" + grade.level + " of 4. Fix the blocking items to reach L" + (grade.level + 1) + ".");
  }
  // The blocking items, lowest level first.
  if (grade.failed.length > 0) {
    lines.push("");
    lines.push("Blocking:");
    grade.failed.forEach(function (c) { lines.push("- L" + c.level + " " + c.id + ": " + c.message); });
  }
  // The warnings. They never lower the level.
  if (grade.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    grade.warnings.forEach(function (c) { lines.push("- L" + c.level + " " + c.id + ": " + c.message); });
  }
  // Who and what is affected.
  lines.push("");
  lines.push("Impacted containers: " + (grade.impacted_names.length ? grade.impacted_names.join(", ") : "none found"));
  lines.push("Teams: " + (grade.teams.length ? grade.teams.join(", ") : "none"));
  lines.push("Checked at " + grade.checked_at + " for the version saved at " + grade.story_updated_at + ".");
  return lines.join("\n");
}

module.exports = { buildComment: buildComment };
