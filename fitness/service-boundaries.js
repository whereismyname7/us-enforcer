// An architecture test: it fails the build when the code breaks our service boundaries.
// Run from the repository root with: docker compose run --rm fitness
const fs = require("fs");
const path = require("path");

const SERVICES = "services";
// Only these services may talk to Jira (ADR-003).
const MAY_CALL_JIRA = ["intake", "reporter", "jira-sim"];
// Only this service may write to Jira.
const MAY_WRITE_JIRA = ["reporter", "jira-sim"];

const names = fs.readdirSync(SERVICES);
const violations = [];

function listJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function (e) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : listJs(full);
    return e.name.endsWith(".js") ? [full] : [];
  });
}

for (const service of names) {
  for (const file of listJs(path.join(SERVICES, service))) {
    fs.readFileSync(file, "utf8").split("\n").forEach(function (line, i) {
      const at = file.split(path.sep).join("/") + ":" + (i + 1);
      // Rule 1: no service reaches into another service's folder.
      if (names.some(function (o) { return o !== service && line.includes("../" + o); })) {
        violations.push(at + " reaches into another service's folder");
      }
      // Rule 2: the rules belong to the Checker.
      if (service !== "checker" && line.includes("rules.yaml") && !line.trim().startsWith("//")) {
        violations.push(at + " reads the Checker's rules.yaml");
      }
      // Rule 3: only Intake and the Reporter know where Jira is.
      if (!MAY_CALL_JIRA.includes(service) && /JIRA_URL|rest\/api/.test(line)) {
        violations.push(at + " calls Jira; everything it needs must be in the event");
      }
      // Rule 4: only the Reporter writes to Jira.
      if (!MAY_WRITE_JIRA.includes(service) && /method:\s*"(PUT|POST|DELETE)"/.test(line)) {
        violations.push(at + " writes to another system; only the Reporter writes to Jira");
      }
    });
  }
}

if (violations.length === 0) {
  console.log("PASS - every service stays inside its boundary.");
  process.exit(0);
}
console.log("FAIL - " + violations.length + " violation(s):");
violations.forEach(function (v) { console.log("  " + v); });
process.exit(1);
