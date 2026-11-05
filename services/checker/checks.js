// Every check, as one pure function: story in, results out. No network, no clock.
// A failed check at level N means the story cannot be above level N - 1.

// example fitnees violation
// const JIRA_URL = process.env.JIRA_URL || "http://jira-sim:3000";

// Does a term from rules.yaml appear in a text? "stock*" matches any word starting with stock.
function has(text, term) {
  if (term === "?") return text.includes("?");
  const stem = term.endsWith("*") ? term.slice(0, -1) : term;
  const safe = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    "\\b" + safe + (term.endsWith("*") ? "\\w*" : "\\b"),
    "i",
  ).test(text);
}

function firstFound(text, terms) {
  return terms.find(function (t) {
    return has(text, t);
  });
}

// Which target containers does this text touch?
function findImpacted(text, config) {
  return config.containers.filter(function (c) {
    return firstFound(text, config.impact_keywords[c.id] || []);
  });
}

function runChecks(event, config) {
  const s = event.story;
  const cr = event.change_request;
  const all = [
    s.summary,
    s.i_want,
    s.so_that,
    s.acceptance_criteria,
    s.technical_notes,
  ].join("\n");
  const criteria = s.acceptance_criteria
    .split("\n")
    .map(function (l) {
      return l.trim();
    })
    .filter(Boolean);
  const notGwt = criteria.filter(function (l) {
    return !new RegExp(config.gwt_pattern, "i").test(l);
  });
  const impacted = findImpacted(all, config);
  const impactedIds = impacted.map(function (c) {
    return c.id;
  });
  const vague = firstFound(
    [s.i_want, s.so_that, s.acceptance_criteria].join("\n"),
    config.vague_words,
  );
  const open = firstFound(all, config.open_questions);

  const checks = [];
  function add(id, level, passed, message) {
    checks.push({
      id: id,
      level: level,
      passed: !!passed,
      message: passed ? "" : message,
    });
  }

  // L1 Draft: it has the shape of a story.
  add(
    "TITLE",
    1,
    new RegExp(config.title_pattern).test(s.summary),
    'Title must look like "[Area] Short phrase"',
  );
  add(
    "ROLE-GOAL-BENEFIT",
    1,
    s.as_a && s.i_want && s.so_that,
    "Fill in As a, I want and So that",
  );

  // L2 Defined: it can be tested.
  add(
    "GIVEN-WHEN-THEN",
    2,
    criteria.length > 0 && notGwt.length === 0,
    criteria.length
      ? notGwt.length + " criteria are not Given/When/Then"
      : "No acceptance criteria",
  );
  add(
    "NEGATIVE-CASE",
    2,
    firstFound(s.acceptance_criteria, config.negative_words),
    "Add a negative case (error, empty, not allowed)",
  );
  add(
    "MEASURABLE",
    2,
    !vague && !open,
    vague
      ? 'Unmeasurable: "' + vague + '". Use a number'
      : 'Open question left: "' + open + '"',
  );

  // L3 Refined: its impact on the architecture is known and allowed.
  add("CR-LINKED", 3, cr, "No Change Request linked");
  add(
    "CONTAINERS-FOUND",
    3,
    impacted.length > 0,
    "No impacted container found; mention the business area",
  );
  for (const rule of config.adr_rules) {
    const forbidden =
      rule.forbid_pattern && new RegExp(rule.forbid_pattern, "i").test(all);
    const applies =
      rule.when_containers &&
      rule.when_containers.every(function (id) {
        return impactedIds.includes(id);
      });
    const missing = applies && !firstFound(all, rule.must_mention_any);
    add(rule.id, 3, !forbidden && !missing, rule.message);
  }

  // L4 Dev-ready: approved, in scope and owned.
  add(
    "CR-APPROVED",
    4,
    cr && cr.status === "Approved",
    cr ? cr.key + " is " + cr.status : "No CR to check",
  );
  const creep = cr && firstFound(all, cr.out_of_scope);
  add(
    "IN-SCOPE",
    4,
    !creep,
    '"' + creep + '" is out of scope for ' + (cr && cr.key),
  );
  const undeclared = impacted.find(function (c) {
    return (
      !cr ||
      !cr.impacted_systems.some(function (sys) {
        return c.name.toLowerCase().includes(sys.toLowerCase());
      })
    );
  });
  add(
    "IMPACT-DECLARED",
    4,
    !undeclared,
    (undeclared && undeclared.name) + " is impacted but not declared by the CR",
  );
  const owner = /data owner:\s*([a-z ]+)/i.exec(s.technical_notes);
  const ownerOk =
    owner &&
    impacted.some(function (c) {
      return c.name.toLowerCase().includes(owner[1].trim().toLowerCase());
    });
  add(
    "DATA-OWNER",
    4,
    ownerOk,
    'Name the data owner in technical notes: "Data owner: <container>"',
  );

  return {
    checks: checks,
    impacted: impacted.map(function (c) {
      return c.name;
    }),
  };
}

module.exports = { runChecks: runChecks };
