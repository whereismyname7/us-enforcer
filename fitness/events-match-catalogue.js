// An architecture test for ADR-002: services talk only through events, and every event is written down.
// (a) Every topic name used in services/**/*.js appears in docs/event-catalogue.md.
// (b) Every event schema has an example, and the example matches the schema's required fields and constants.

// "fs" is the built-in tool for reading files and folders.
const fs = require("fs");
// "path" is the built-in tool for joining folder names safely on any system.
const path = require("path");

// Where to look.
const SERVICES_DIR = "services";
const CATALOGUE = path.join("docs", "event-catalogue.md");
const EVENTS_DIR = path.join("api", "events");
const EXAMPLES_DIR = path.join(EVENTS_DIR, "examples");

// A topic name: readiness. followed by lower-case words and dashes.
const TOPIC = /readiness\.[a-z-]+/g;

// Collect every .js file inside a folder, including sub-folders, skipping node_modules.
function listJsFiles(dir) {
  let found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        found = found.concat(listJsFiles(full));
      }
    } else if (entry.name.endsWith(".js")) {
      found.push(full);
    }
  }
  return found;
}

// Forward slashes on every system.
function normalise(p) {
  return path.normalize(p).split(path.sep).join("/");
}

// Every string written in quotes on one line.
function stringsOn(line) {
  const out = [];
  const pattern = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    out.push(match[2]);
  }
  return out;
}

// Every broken rule we find goes in here.
const violations = [];

// (a) Topics used in code must be in the catalogue.
const catalogue = fs.existsSync(CATALOGUE) ? fs.readFileSync(CATALOGUE, "utf8") : "";
const topicsSeen = new Set();
for (const file of listJsFiles(SERVICES_DIR)) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const text of stringsOn(lines[i])) {
      for (const topic of text.match(TOPIC) || []) {
        topicsSeen.add(topic);
        if (catalogue.indexOf(topic) === -1) {
          violations.push({ file: normalise(file), line: i + 1, rule: "ADR-002: every topic is in the event catalogue", found: topic, fix: "Add " + topic + " to " + normalise(CATALOGUE) + ", or use a topic that is already there" });
        }
      }
    }
  }
}

// (b) Each schema needs a matching example.
const schemas = fs.readdirSync(EVENTS_DIR).filter(function (f) { return f.endsWith(".schema.json"); });
for (const schemaFile of schemas) {
  const schemaPath = path.join(EVENTS_DIR, schemaFile);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  // "StoryChanged.v1.schema.json" has the example "StoryChanged.v1.json".
  const typeName = schemaFile.split(".")[0];
  const examplePath = path.join(EXAMPLES_DIR, typeName + ".v1.json");
  if (!fs.existsSync(examplePath)) {
    violations.push({ file: normalise(schemaPath), line: 1, rule: "ADR-002: every event has an example", found: "missing " + normalise(examplePath), fix: "Write an example event at " + normalise(examplePath) });
    continue;
  }
  const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  // Every required top-level field is present.
  for (const field of schema.required || []) {
    if (!(field in example)) {
      violations.push({ file: normalise(examplePath), line: 1, rule: "ADR-002: the example has every required field", found: "missing " + field, fix: "Add " + field + " to the example, or remove it from required in " + normalise(schemaPath) });
    }
  }
  // type and version equal the schema's constants.
  for (const field of ["type", "version"]) {
    const prop = schema.properties && schema.properties[field];
    if (!prop || !("const" in prop)) {
      violations.push({ file: normalise(schemaPath), line: 1, rule: "ADR-002: type and version are constants", found: field + " has no const", fix: "Give " + field + " a const value in the schema" });
    } else if (example[field] !== prop.const) {
      violations.push({ file: normalise(examplePath), line: 1, rule: "ADR-002: the example matches the schema", found: field + " is " + JSON.stringify(example[field]) + ", schema says " + JSON.stringify(prop.const), fix: "Make the example and the schema agree" });
    }
  }
}

// ---- The report ----
console.log("");
console.log("Architecture fitness test: events match the catalogue");
console.log("Rule source: docs/adr/adr-002-events-between-services.md");
console.log("Topics found in code: " + Array.from(topicsSeen).sort().join(", "));
console.log("Schemas checked: " + schemas.join(", "));
console.log("");

if (violations.length === 0) {
  console.log("PASS - every topic is in the catalogue and every schema has a matching example.");
  console.log("");
  process.exit(0);
}

console.log("FAIL - " + violations.length + " violation(s) found.");
console.log("");
for (const v of violations) {
  console.log("  " + v.file + ":" + v.line);
  console.log("    found          : " + v.found);
  console.log("    rule           : " + v.rule);
  console.log("    how to fix     : " + v.fix);
  console.log("");
}
process.exit(1);
