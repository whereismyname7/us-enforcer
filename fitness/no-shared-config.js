// An architecture test. It does not check what the code does.
// It checks whether the code still obeys ADR-001:
// each service owns its own files and config, and no service reaches into another's.

// "fs" is the built-in tool for reading files and folders.
const fs = require("fs");
// "path" is the built-in tool for joining folder names safely on any system.
const path = require("path");

// The folder that holds one sub-folder per service.
const SERVICES_DIR = "services";

// The config files each service owns. Nobody else may name them.
const OWNED_CONFIG = {
  rules: ["rules.yaml"],
  impact: ["impact-map.yaml", "adr-rules.yaml", "owners.yaml"]
};

// Collect every .js file inside a folder, including sub-folders.
function listJsFiles(dir) {
  // Start with an empty list.
  let found = [];
  // Read what is inside this folder.
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  // Look at each thing we found.
  for (const entry of entries) {
    // Build the full path to it.
    const full = path.join(dir, entry.name);
    // If it is a folder, look inside it too.
    if (entry.isDirectory()) {
      // Skip downloaded libraries. They are not our code.
      if (entry.name === "node_modules") {
        continue;
      }
      // Add everything we find deeper down.
      found = found.concat(listJsFiles(full));
    } else if (entry.name.endsWith(".js")) {
      // It is one of our JavaScript files, so keep it.
      found.push(full);
    }
  }
  // Hand the list back.
  return found;
}

// Turn a Windows path with backslashes into one with forward slashes,
// so the same test works on Windows, macOS and Linux.
function normalise(p) {
  return path.normalize(p).split(path.sep).join("/");
}

// Does a text name this file as a whole file name? "adr-rules.yaml" does not name "rules.yaml".
function namesFile(text, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^A-Za-z0-9_-])" + escaped + "(?![A-Za-z0-9_-])").test(text);
}

// Every string written in quotes on one line: "...", '...' or `...`.
function stringsOn(line) {
  const out = [];
  const pattern = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    out.push(match[2]);
  }
  return out;
}

// Read the list of services from the folder names.
const serviceNames = fs
  .readdirSync(SERVICES_DIR, { withFileTypes: true })
  .filter(function (e) { return e.isDirectory(); })
  .map(function (e) { return e.name; });

// Every broken rule we find goes in here.
const violations = [];

// Record one broken rule, with everything a person needs to fix it.
function report(file, line, service, other, rule, found, fix) {
  violations.push({ file: normalise(file), line: line, service: service, owner: other, rule: rule, found: found, fix: fix });
}

// Check one service at a time.
for (const service of serviceNames) {
  // Find every JavaScript file that belongs to this service.
  const files = listJsFiles(path.join(SERVICES_DIR, service));

  // Read each file line by line.
  for (const file of files) {
    // Load the whole file as text and split it into lines, so we can report a line number.
    const lines = fs.readFileSync(file, "utf8").split("\n");

    // Look at each line.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // (a) A relative require that lands inside another service's folder.
      const req = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
      if (req && req[1].charAt(0) === ".") {
        // Work out where that relative path actually points.
        const resolved = normalise(path.join(path.dirname(file), req[1]));
        for (const other of serviceNames) {
          if (other !== service && resolved.indexOf(SERVICES_DIR + "/" + other + "/") === 0) {
            report(file, i + 1, service, other, "ADR-001: a service must not import another service's files", req[1], "Copy the helper into " + SERVICES_DIR + "/" + service + "/ or use an event; never import " + other + "'s code");
          }
        }
      }

      // (b) and (c): any string that points into, or names the config of, another service.
      for (const text of stringsOn(line)) {
        for (const other of serviceNames) {
          if (other === service) {
            continue;
          }
          // (b) A path into another service's folder.
          if (text.indexOf(SERVICES_DIR + "/" + other + "/") !== -1 || text.indexOf("../" + other + "/") !== -1) {
            // The require check above already reported this exact line and text.
            const already = violations.some(function (v) { return v.file === normalise(file) && v.line === i + 1 && v.found === text; });
            if (!already) {
              report(file, i + 1, service, other, "ADR-001: a service must not reach into another service's folder", text, "Remove the path; each service reads only its own folder");
            }
          }
          // (c) The name of a config file another service owns.
          for (const owned of OWNED_CONFIG[other] || []) {
            if (namesFile(text, owned)) {
              report(file, i + 1, service, other, "ADR-001: a service must not read another service's config", text, owned + " belongs to " + other + "; ask for the result in an event instead");
            }
          }
        }
      }
    }
  }
}

// ---- The report ----

// A blank line, then a title, so the output is easy to read.
console.log("");
console.log("Architecture fitness test: no shared config");
console.log("Rule source: docs/adr/adr-001-each-service-owns-its-config.md");
console.log("Services checked: " + serviceNames.join(", "));
console.log("");

// If we found nothing, say so and finish successfully.
if (violations.length === 0) {
  console.log("PASS - no service reaches into another service's files or config.");
  console.log("");
  // Exit code 0 means success. A build pipeline reads this number.
  process.exit(0);
}

// Otherwise, print every problem we found.
console.log("FAIL - " + violations.length + " violation(s) found.");
console.log("");
// Print each one on its own block.
for (const v of violations) {
  console.log("  " + v.file + ":" + v.line);
  console.log("    found          : " + v.found);
  console.log("    offender       : " + v.service);
  console.log("    owner          : " + v.owner);
  console.log("    rule           : " + v.rule);
  console.log("    how to fix     : " + v.fix);
  console.log("");
}
// Exit code 1 means failure. This is what stops a build pipeline.
process.exit(1);
