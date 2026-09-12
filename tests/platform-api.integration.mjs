import assert from "node:assert/strict";
const origin = process.env.AGENTGATE_TEST_ORIGIN || "http://localhost:5173";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Local development target only.",
);
assert.equal((await fetch(origin + "/api/platform")).status, 401);
const login = await fetch(origin + "/signin-with-chatgpt?return_to=/platform", {
  redirect: "manual",
});
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
assert.ok(cookie);
async function post(body, extra = {}) {
  const response = await fetch(origin + "/api/platform", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }
  return { status: response.status, data };
}
async function get(orgId = "") {
  const response = await fetch(
    origin + "/api/platform" + (orgId ? "?orgId=" + orgId : ""),
    { headers: { Cookie: cookie } },
  );
  assert.equal(response.status, 200);
  return response.json();
}
const initial = await get();
let orgId = initial.organizations.find(
  (o) => o.name === "API verification lab",
)?.id;
if (!orgId) {
  const created = await post({
    operation: "create",
    name: "API verification lab",
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  orgId = created.data.orgId;
}
let state = await get(orgId);
assert.equal(state.integrity.valid, true);
assert.equal(
  state.org.members.find((m) => m.userId === state.userId).role,
  "owner",
);
const updated = await post({
  operation: "policy",
  orgId,
  policy: state.org.policy,
  twoPerson: false,
});
assert.equal(updated.status, 200);
const after = await get(orgId);
assert.equal(after.org.policyVersion, state.org.policyVersion + 1);
assert.equal(after.integrity.valid, true);
assert.equal(after.revision, state.revision + 1);
assert.equal((await post({ operation: "create", name: "x" })).status, 400);
assert.equal(
  (
    await post(
      { operation: "create", name: "Bad origin" },
      { Origin: "https://untrusted.example" },
    )
  ).status,
  403,
);
assert.equal(
  (await post({ operation: "member", orgId, userId: state.userId, role: null }))
    .status,
  400,
);
if (!state.model.configured) {
  assert.equal(
    (
      await post({
        operation: "run",
        orgId,
        prompt: "Search the catalog",
        mode: "gateway",
      })
    ).status,
    503,
  );
  assert.equal(
    (await get(orgId)).org.sessions.length,
    state.org.sessions.length,
    "Missing model must not produce a fake run.",
  );
}
console.log(
  "Platform API passed: sign-in, organization persistence, role, policy versioning, audit integrity, invalid input, CSRF, owner protection, explicit model availability.",
);
