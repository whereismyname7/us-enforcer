// 100 stories saved at once, then we check the SLO: 95 percent graded within 10 seconds.
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const JIRA = __ENV.JIRA_URL || "http://jira-sim:3000";
const COUNT = 100;
const gradedInTime = new Rate("graded_within_slo");

export const options = {
  scenarios: { burst: { executor: "shared-iterations", vus: 10, iterations: COUNT, maxDuration: "60s" } },
  thresholds: { http_req_failed: ["rate<0.01"], graded_within_slo: ["rate>=0.95"] }
};

// Start fresh so the keys are LOAD-1, LOAD-2, and so on.
export function setup() {
  http.post(JIRA + "/admin/reset");
}

export default function () {
  const body = JSON.stringify({
    fields: {
      project: { key: "LOAD" },
      issuetype: { name: "Story" },
      summary: "[Catalog] Show product badge",
      asA: "shopper",
      iWant: "to see a badge on the product page",
      soThat: "I notice new arrivals",
      acceptanceCriteria: "Given a product is new, When I open its page, Then I see a New badge.\nGiven a product is not new, When I open its page, Then no badge is shown."
    }
  });
  const res = http.post(JIRA + "/rest/api/v3/issue", body, { headers: { "Content-Type": "application/json" } });
  check(res, { "story saved": function (r) { return r.status === 201; } });
}

// Ten seconds after the burst, every story should have a level.
export function teardown() {
  sleep(10);
  for (let i = 1; i <= COUNT; i++) {
    const res = http.get(JIRA + "/rest/api/v3/issue/LOAD-" + i);
    gradedInTime.add(res.status === 200 && res.json("level") !== "Pending");
  }
}
