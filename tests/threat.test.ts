import test from "node:test";
import assert from "node:assert/strict";
import { detectThreat } from "../lib/platform/threat.ts";
const result = {
  model: "test-bert",
  revision: "test-revision",
  score: 0.9,
  windows: 1,
  durationMs: 20,
};
test("validated calibration threshold is used instead of the experimental default", async () => {
  const assessment = await detectThreat(
    "http://127.0.0.1:8765",
    "example",
    "lab",
    async () => Response.json({ ...result, threshold: 0.95 }),
  );
  assert.equal(assessment.threshold, 0.95);
  assert.equal(assessment.label, "benign");
});
test("scoring uses injection score and preserves observation evidence", async () => {
  const assessment = await detectThreat(
    "http://127.0.0.1:8765",
    "test text",
    "tool",
    async (url, init) => {
      assert.equal(String(url), "http://127.0.0.1:8765/detect");
      assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(init?.body as string), { text: "test text" });
      return Response.json(result);
    },
  );
  assert.equal(assessment.label, "injection");
  assert.equal(assessment.source, "tool");
  assert.equal(assessment.text, "test text");
  assert.equal(assessment.result?.revision, "test-revision");
  const benign = await detectThreat(
    "http://localhost:8765",
    "test",
    "lab",
    async () => Response.json({ ...result, score: 0.1 }),
  );
  assert.equal(benign.label, "benign");
});
test("missing configuration and unsafe addresses never call inference", async () => {
  for (const url of [
    undefined,
    "https://example.com",
    "http://127.0.0.1:8765/other",
    "http://user:pass@localhost:8765",
    "http://localhost:8765/?x=y",
  ]) {
    const assessment = await detectThreat(url, "text", "lab", async () => {
      throw Error("must not call");
    });
    assert.equal(assessment.status, "unavailable");
    assert.equal(assessment.result, undefined);
  }
});
test("failed, oversized and malformed inference never becomes a benign result", async () => {
  for (const response of [
    new Response("offline", { status: 503 }),
    Response.json({ ...result, score: 2 }),
    Response.json({ ...result, revision: "" }),
    new Response("x".repeat(5000)),
    new Response("not json"),
  ]) {
    const assessment = await detectThreat(
      "http://localhost:8765",
      "text",
      "lab",
      async () => response,
    );
    assert.equal(assessment.status, "unavailable");
    assert.equal(assessment.label, undefined);
  }
  const timedOut = await detectThreat(
    "http://localhost:8765",
    "text",
    "lab",
    async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
  );
  assert.equal(timedOut.status, "unavailable");
});
