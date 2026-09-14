import assert from "node:assert/strict";
import test from "node:test";
import {
  actionHash,
  createSession,
  defaultGovernance,
  executeSandbox,
  judge,
  newOrg,
} from "../lib/platform/domain.ts";

const purchase = {
  tool: "create_purchase_request" as const,
  vendorId: "acme-supply",
  sku: "LAP-14",
  quantity: 1,
  unitPrice: 899,
  currency: "USD",
  category: "laptops",
};

test("procurement policy allows, escalates, and denies by business risk", () => {
  const org = newOrg(crypto.randomUUID(), "Test", "owner", "owner@example.com");
  assert.equal(
    judge(purchase, org.policy, defaultGovernance).decision,
    "allow",
  );
  assert.equal(
    judge({ ...purchase, quantity: 2 }, org.policy, defaultGovernance).decision,
    "approval",
  );
  assert.equal(
    judge(
      { ...purchase, vendorId: "shadow-vendor" },
      org.policy,
      defaultGovernance,
    ).decision,
    "deny",
  );
  assert.equal(
    judge(purchase, org.policy, defaultGovernance, 24_500).decision,
    "deny",
  );
});

test("purchase execution remains an isolated draft", () => {
  const org = newOrg(crypto.randomUUID(), "Test", "owner", "owner@example.com");
  const session = createSession(org, "owner", "buy laptop", "gateway");
  const result = executeSandbox(session, purchase);
  assert.match(result, /sandbox purchase request/i);
  assert.equal(session.sandbox.purchaseRequests?.[0].total, 899);
});

test("approval fingerprint binds the governance snapshot", async () => {
  const org = newOrg(crypto.randomUUID(), "Test", "owner", "owner@example.com");
  const session = createSession(org, "owner", "buy laptop", "gateway");
  const proposalId = crypto.randomUUID();
  const first = await actionHash(org.id, session, proposalId, purchase);
  session.governance!.monthlyBudget += 1;
  const second = await actionHash(org.id, session, proposalId, purchase);
  assert.notEqual(first, second);
});
