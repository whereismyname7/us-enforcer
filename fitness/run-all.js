// Runs the three architecture fitness functions in order.
// Exit code 0 only if all three pass; 1 if any fails. A build pipeline reads this number.
// Run with: docker compose run --rm fitness

// Node's built-in tool for running another program and waiting for it.
const { spawnSync } = require("child_process");
// "path" joins folder names safely on any system.
const path = require("path");

// The three rules, in the order they run.
const RULES = ["no-shared-config.js", "events-match-catalogue.js", "no-secrets.js"];

// Remember which ones failed.
const failed = [];

for (const rule of RULES) {
  // Run one rule with the same Node, from the repository root, and show its output as it comes.
  const run = spawnSync(process.execPath, [path.join(__dirname, rule)], { stdio: "inherit" });
  if (run.status !== 0) {
    failed.push(rule);
  }
}

// One summary line.
if (failed.length === 0) {
  console.log("ALL " + RULES.length + " FITNESS FUNCTIONS PASSED");
  process.exit(0);
}
console.log(failed.length + " OF " + RULES.length + " FITNESS FUNCTIONS FAILED: " + failed.join(", "));
process.exit(1);
