import assert from "node:assert/strict";
const origin = process.env.AGENTGATE_TEST_ORIGIN || "http://localhost:5173";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Integration test must target a local development server.",
);
const anonymous = await fetch(origin + "/api/workspace");
assert.equal(anonymous.status, 401, "anonymous reads are rejected");
const login = await fetch(origin + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
assert.ok(cookie, "local sign-in sets a development cookie");
async function post(body, extra = {}) {
  const response = await fetch(origin + "/api/workspace", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text };
  }
  return { status: response.status, data };
}
let seeded = await post({ operation: "seed" });
assert.equal(seeded.status, 200, JSON.stringify(seeded.data));
const count = seeded.data.agents.length;
seeded = await post({ operation: "seed" });
assert.equal(seeded.data.agents.length, count, "seeding is idempotent");
for (const [version, expected, gate] of [
  ["0.1-baseline", 7, "blocked"],
  ["0.2-hardened", 12, "passed"],
]) {
  const agent = seeded.data.agents.find((a) => a.version === version);
  assert.ok(agent);
  const result = await post({ operation: "run", agentId: agent.id });
  assert.equal(result.status, 200);
  assert.equal(result.data.run.passed, expected);
  assert.equal(result.data.run.gate, gate);
  const state = await (
    await fetch(origin + "/api/workspace", { headers: { Cookie: cookie } })
  ).json();
  assert.ok(
    state.runs.some((r) => r.id === result.data.run.id),
    "report survives a fresh request",
  );
}
assert.equal(
  (await post({ operation: "seed" }, { Origin: "https://untrusted.example" }))
    .status,
  403,
);
assert.equal((await post({ operation: "register", name: "x" })).status, 400);
assert.equal(
  (
    await post({
      operation: "run",
      agentId: "00000000-0000-4000-8000-000000000000",
    })
  ).status,
  404,
);
console.log(
  "API integration passed: anonymous access, local sign-in, idempotent seeds, baseline/hardened reports, persistence, CSRF, invalid input, missing agent.",
);
