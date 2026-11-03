// An architecture test for security at the border: no secret value is ever written in a file.
// Secrets come from the environment. A file may hold only a ${...} placeholder or a dev-only-... default.
// It scans every text file except .git/, node_modules/, .env and images.

// "fs" is the built-in tool for reading files and folders.
const fs = require("fs");
// "path" is the built-in tool for joining folder names safely on any system.
const path = require("path");

// Folders and files we never scan.
const SKIP_DIRS = [".git", "node_modules"];
const SKIP_FILES = [".env"];

// Picture and other binary types. They are not text.
const BINARY_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".pdf", ".pptx", ".zip", ".woff", ".woff2"];

// A word like password, secret, api key or token, then ":" or "=", then a value of 8 or more characters.
const SECRET_LIKE = /(password|secret|api[_-]?key|token)\s*[:=]\s*["']?([^\s"'$]{8,})/ig;

// Collect every file to scan, starting from the repository root.
function listFiles(dir) {
  let found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.indexOf(entry.name) === -1) {
        found = found.concat(listFiles(full));
      }
    } else if (SKIP_FILES.indexOf(entry.name) === -1 && BINARY_EXTENSIONS.indexOf(path.extname(entry.name).toLowerCase()) === -1) {
      found.push(full);
    }
  }
  return found;
}

// Forward slashes on every system.
function normalise(p) {
  return path.normalize(p).split(path.sep).join("/");
}

// Every broken rule we find goes in here.
const violations = [];
// How many files we read.
let scanned = 0;

for (const file of listFiles(".")) {
  const buffer = fs.readFileSync(file);
  // A zero byte means a binary file, whatever its name says.
  if (buffer.indexOf(0) !== -1) {
    continue;
  }
  scanned = scanned + 1;
  const lines = buffer.toString("utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    SECRET_LIKE.lastIndex = 0;
    let match;
    while ((match = SECRET_LIKE.exec(lines[i])) !== null) {
      const value = match[2];
      // Allowed: a placeholder filled from the environment, or a clearly fake development value.
      if (value.indexOf("${") === 0 || value.indexOf("dev-only") !== -1) {
        continue;
      }
      violations.push({ file: normalise(file), line: i + 1, word: match[1], fix: "Read it from the environment and write ${" + match[1].toUpperCase().replace(/[^A-Z]/g, "_") + "} here, or use a dev-only-... value for tests" });
    }
  }
}

// ---- The report ----
console.log("");
console.log("Architecture fitness test: no secrets in files");
console.log("Rule source: README.md, security rule; docs/adr/adr-009-one-api-gateway.md");
console.log("Files scanned: " + scanned);
console.log("");

if (violations.length === 0) {
  console.log("PASS - no secret values found; only ${...} placeholders and dev-only defaults.");
  console.log("");
  process.exit(0);
}

console.log("FAIL - " + violations.length + " violation(s) found.");
console.log("");
for (const v of violations) {
  // Never print the value itself: the report must not leak what it found.
  console.log("  " + v.file + ":" + v.line);
  console.log("    looks like     : a " + v.word + " value");
  console.log("    rule           : secrets come from the environment, never from a file");
  console.log("    how to fix     : " + v.fix);
  console.log("");
}
process.exit(1);
