import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPolicy,
  evaluateAction,
  runReference,
  cases,
} from "../lib/security.ts";
const agent = {
  id: "test",
  name: "Test",
  version: "1",
  description: "",
  policy: defaultPolicy,
  createdAt: "",
};
test("hardened policy passes attacks AND useful positive controls", () => {
  const r = runReference(agent);
  assert.equal(r.passed, cases.length);
  assert.equal(r.gate, "passed");
  assert.equal(r.mode, "reference");
});
test("removing controls produces reproducible failures", () => {
  const r = runReference({
    ...agent,
    policy: {
      ...defaultPolicy,
      allowedTools: [...defaultPolicy.allowedTools, "run_shell"],
      requireApproval: false,
      blockSensitive: false,
    },
  });
  assert.equal(r.gate, "blocked");
  assert.deepEqual(
    r.findings.filter((f) => !f.passed).map((f) => f.id),
    ["T02", "T04", "T05", "T06", "T12"],
  );
});
test("destination matching rejects ambiguous URLs and missing hosts", () => {
  for (const destination of [
    "https://supplier.example.com.evil.net",
    "https://supplier.example.com@evil.net",
    "http://supplier.example.com",
    "https://supplier.example.com:444",
    "file:///etc/passwd",
    "",
    undefined,
  ])
    assert.equal(
      evaluateAction(defaultPolicy, {
        tool: "send_email",
        destination,
        approved: true,
      }).decision,
      "deny",
    );
});
test("deny takes priority over approval", () => {
  assert.equal(
    evaluateAction(defaultPolicy, { tool: "run_shell", approved: true })
      .decision,
    "deny",
  );
  assert.equal(
    evaluateAction(defaultPolicy, {
      tool: "send_email",
      destination: "https://supplier.example.com",
      content: "secret=test-value",
      approved: true,
    }).decision,
    "deny",
  );
});
test("report policy is an immutable snapshot", () => {
  const p = structuredClone(defaultPolicy);
  const r = runReference({ ...agent, policy: p });
  p.allowedTools.push("run_shell");
  assert.ok(!r.policy.allowedTools.includes("run_shell"));
});
