// Day 4 load test: 100 BAs save a story at the same moment.
// Then we check our SLO: 95 percent of stories graded within 10 seconds.
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// Where the Jira simulator is, inside the Docker network.
const JIRA = __ENV.JIRA_URL || "http://jira-sim:3000";

// Our SLI: the share of stories graded within 10 seconds of being saved.
const gradedWithinSlo = new Rate("graded_within_slo");

export const options = {
  scenarios: {
    burst: { executor: "shared-iterations", vus: 10, iterations: 100, maxDuration: "60s" }
  },
  thresholds: {
    // The simulator must accept every story quickly.
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<300"],
    // The SLO from docs/slo/readiness-slo.md.
    graded_within_slo: ["rate>=0.95"]
  }
};

// One fake BA saves one story. The simulator numbers it LOAD-1, LOAD-2 ...
export default function () {
  const body = JSON.stringify({
    fields: {
      project: { key: "LOAD" },
      issuetype: { name: "Story" },
      summary: "[Catalog] Show product badge",
      asA: "shopper",
      iWant: "to see a badge on the product page",
      soThat: "I notice new arrivals",
      acceptanceCriteria: "Given a product is new, When I open its page, Then I see a New badge.\nGiven a product is not new, When I open its page, Then no badge is shown.",
      technicalNotes: "Data owner: Catalog."
    }
  });
  const res = http.post(JIRA + "/rest/api/3/issue", body, { headers: { "Content-Type": "application/json" } });
  check(res, { "story created (201)": function (r) { return r.status === 201; } });
}

// After the burst, wait up to 20 seconds, then measure how long each grade took.
export function teardown() {
  let issues = [];
  for (let i = 0; i < 40; i++) {
    const res = http.get(JIRA + "/rest/api/3/search?jql=" + encodeURIComponent("project = LOAD") + "&maxResults=1000");
    issues = res.json("issues") || [];
    const pending = issues.filter(function (x) { const r = x.properties && x.properties.readiness; return !r || r.state !== "Graded"; });
    if (pending.length === 0) break;
    sleep(0.5);
  }
  for (const x of issues) {
    const r = x.properties && x.properties.readiness;
    const ok = !!r && r.state === "Graded" && (Date.parse(r.checked_at) - Date.parse(x.fields.updated)) <= 10000;
    gradedWithinSlo.add(ok);
  }
}
