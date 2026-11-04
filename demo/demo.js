// One story from start to finish, through the running system. Run with: docker compose run --rm demo
const JIRA = process.env.JIRA_URL || "http://jira-sim:3000";
const GATEWAY = process.env.GATEWAY_URL || "http://gateway";
const ISSUE = "/rest/api/v3/issue";

const NOTES = "Checkout publishes a StockReserved event to Warehouse. Data owner: Warehouse.";
const CR = {
  key: "CR-12",
  fields: {
    issuetype: { name: "Change Request" },
    summary: "Customers can reserve stock during checkout",
    status: "Approved",
    impactedSystems: ["Checkout"],
    outOfScope: ["discount", "delivery fee"]
  }
};
const WEAK_STORY = {
  fields: {
    project: { key: "NORTH" },
    issuetype: { name: "Story" },
    summary: "[Cart] Reserve stock",
    asA: "customer",
    iWant: "my items reserved",
    soThat: "they don't sell out",
    acceptanceCriteria: "Stock should be reserved quickly at checkout. Reservation time TBD.",
    crKey: "CR-12"
  }
};
const FIXED_STORY = {
  fields: {
    acceptanceCriteria: "Given an item is in my cart, When I start checkout, Then 1 unit is reserved within 2 seconds.\nGiven the item is out of stock, When I start checkout, Then I see an out-of-stock message.",
    technicalNotes: NOTES
  }
};
const SCOPE_CREEP = { fields: { technicalNotes: NOTES + " Also apply a discount to reserved items." } };

async function call(method, url, body, headers) {
  const res = await fetch(url, {
    method: method,
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: body && JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, body: text && res.headers.get("content-type").includes("json") ? JSON.parse(text) : text };
}

const getStory = async function () { return (await call("GET", JIRA + ISSUE + "/NORTH-1")).body; };
const moveToReady = function () { return call("POST", JIRA + ISSUE + "/NORTH-1/transitions", { to: "Ready for Dev" }); };

// Wait until the story has a grade for the version saved right now.
async function waitForGrade() {
  for (let i = 0; i < 40; i++) {
    const story = await getStory();
    if (story.status && story.status !== "Pending") return story;
    await new Promise(function (resolve) { setTimeout(resolve, 500); });
  }
  throw new Error("no grade after 20 seconds");
}

let failures = 0;
function expect(what, actual, wanted) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + what + (ok ? "" : " (wanted " + wanted + ", got " + actual + ")"));
}

async function onBoard() {
  return (await call("GET", JIRA + "/board")).body.issues.some(function (i) { return i.key === "NORTH-1"; });
}

async function main() {
  await call("POST", JIRA + "/admin/reset");
  await call("POST", JIRA + ISSUE, CR);

  console.log("\n1. A BA saves a weak story.");
  await call("POST", JIRA + ISSUE, WEAK_STORY);
  let story = await waitForGrade();
  expect("the story's status is L1", story.status, "L1");
  expect("a comment says what is missing", story.comments.length, 1);
  console.log("\n" + story.comments[0].body + "\n");

  console.log("2. The BA tries to move it to Ready for Dev.");
  expect("the gate refuses it", (await moveToReady()).status, 400);

  console.log("\n3. The architect declares Warehouse on the CR, and the BA fixes the story.");
  await call("PUT", JIRA + ISSUE + "/CR-12", { fields: { impactedSystems: ["Checkout", "Warehouse"] } });
  await call("PUT", JIRA + ISSUE + "/NORTH-1", FIXED_STORY);
  expect("it is Pending straight after the save", (await getStory()).status, "Pending");
  story = await waitForGrade();
  expect("the story's status is L4", story.status, "L4");

  console.log("\n4. The gate opens and developers see it.");
  expect("the gate allows it", (await moveToReady()).status, 204);
  expect("it is on the developer board", await onBoard(), true);

  console.log("\n5. Next day, someone adds work the CR puts out of scope.");
  await call("PUT", JIRA + ISSUE + "/NORTH-1", SCOPE_CREEP);
  story = await waitForGrade();
  expect("the story drops to L3", story.status, "L3");
  expect("it moves back to Refinement", story.workflowStatus, "Refinement");
  expect("it leaves the board", await onBoard(), false);
  console.log("\n" + story.comments[story.comments.length - 1].body + "\n");

  console.log("6. The readiness API, through the gateway.");
  const path = GATEWAY + "/v1/stories/NORTH-1/readiness";
  expect("no key is refused", (await call("GET", path)).status, 401);
  const graded = await call("GET", path, undefined, { "X-Api-Key": "dev-only-api-key" });
  expect("with the key it answers L3", graded.body.status, "L3");
  const lookup = await call("GET", GATEWAY + "/v1/statuses");
  expect("the lookup lists all 6 statuses", lookup.body.statuses.length, 6);

  console.log(failures === 0 ? "\nDEMO PASSED" : "\nDEMO FAILED: " + failures + " step(s)");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(function (err) {
  console.log("DEMO FAILED: " + err.message);
  process.exit(1);
});
