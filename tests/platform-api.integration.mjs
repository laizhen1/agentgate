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
  policy: {
    ...state.org.policy,
    allowedTools: Array.from(
      new Set([...state.org.policy.allowedTools, "create_purchase_request"]),
    ),
  },
  twoPerson: false,
});
assert.equal(updated.status, 200);
const after = await get(orgId);
assert.equal(after.org.policyVersion, state.org.policyVersion + 1);
assert.equal(after.integrity.valid, true);
assert.equal(after.revision, state.revision + 1);
const tokenResult = await post({
  operation: "mcpToken",
  orgId,
  name: "CI MCP client",
});
assert.equal(tokenResult.status, 200, JSON.stringify(tokenResult.data));
async function mcp(method, params, id) {
  const response = await fetch(origin + "/api/mcp?orgId=" + orgId, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tokenResult.data.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text);
}
const initialized = await mcp(
  "initialize",
  {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "agentgate-ci", version: "1.0.0" },
  },
  1,
);
assert.equal(initialized.result.serverInfo.name, "agentgate");
const listed = await mcp("tools/list", {}, 2);
assert.ok(
  listed.result.tools.some((tool) => tool.name === "create_purchase_request"),
);
const called = await mcp(
  "tools/call",
  {
    name: "create_purchase_request",
    arguments: {
      vendorId: "acme-supply",
      sku: "LAP-14",
      quantity: 1,
      unitPrice: 899,
      currency: "USD",
      category: "laptops",
    },
  },
  3,
);
assert.match(called.result.content[0].text, /"status":"executed"/);
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
  const sessionCountBeforeUnavailableRun = (await get(orgId)).org.sessions
    .length;
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
    sessionCountBeforeUnavailableRun,
    "Missing model must not produce a fake run.",
  );
}
console.log(
  "Platform APIs passed: sign-in, persistence, roles, policy versioning, audit integrity, CSRF, MCP initialize/list/call, and explicit model availability.",
);
