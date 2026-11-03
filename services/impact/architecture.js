// Reads the target architecture our stories are checked against (Northline, copied from Lab2).
// containers.puml gives the C4 containers; openapi.yaml gives the API paths that already exist.
// The architect owns these files; Impact only reads them.

// Node's built-in tools for files and paths.
const fs = require("fs");
const path = require("path");

// js-yaml reads the OpenAPI file.
const yaml = require("js-yaml");

// One container per line: Container(id, "Name", ...) or ContainerDb(id, "Name", ...).
const CONTAINER_LINE = /^\s*Container(?:Db)?\(\s*(\w+)\s*,\s*"([^"]+)"/;

// Find every container in the text of a containers.puml file, in file order.
function parseContainers(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const match = CONTAINER_LINE.exec(line);
    if (match) {
      out.push({ id: match[1], name: match[2] });
    }
  }
  return out;
}

// The paths an OpenAPI file declares, for example "/v1/items/{id}".
function parseApiPaths(text) {
  const doc = yaml.load(text) || {};
  return Object.keys(doc.paths || {});
}

// Read both files from one folder, for example /architecture inside the container.
function loadArchitecture(dir) {
  return {
    containers: parseContainers(fs.readFileSync(path.join(dir, "containers.puml"), "utf8")),
    apiPaths: parseApiPaths(fs.readFileSync(path.join(dir, "openapi.yaml"), "utf8"))
  };
}

module.exports = { parseContainers: parseContainers, parseApiPaths: parseApiPaths, loadArchitecture: loadArchitecture };
