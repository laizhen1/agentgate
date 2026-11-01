import test from "node:test";
import assert from "node:assert/strict";
import {
  guardToolMessages,
  withheldText,
  type ScoreText,
} from "../lib/platform/detector-guard.ts";
import type { Message } from "../lib/platform/domain.ts";
import { detectorSchedule } from "../lib/benchmark/detector-protocol.ts";
const scorer: ScoreText = async (text) => ({
  id: "test",
  at: "test",
  source: "tool",
  text,
  status: "scored",
  threshold: 0.7,
  label: text.includes("attack") ? "injection" : "benign",
  result: {
    model: "test",
    revision: "test",
    score: text.includes("attack") ? 0.9 : 0.1,
    windows: 1,
    durationMs: 1,
  },
});
test("no-detector arm is byte-preserving and does not score", async () => {
  const input: Message[] = [
    { role: "tool", tool_name: "read_document", content: "attack" },
  ];
  const output = await guardToolMessages(input, 0, null);
  assert.deepEqual(output.messages, input);
  assert.equal(output.records[0].assessment, null);
  assert.equal(output.records[0].blocked, false);
});
test("guard filters untrusted content without mutating evidence or trusted roles", async () => {
  const input: Message[] = [
    { role: "system", content: "attack" },
    { role: "user", content: "attack" },
    { role: "tool", tool_name: "read_document", content: "attack" },
    { role: "tool", tool_name: "create_purchase_request", content: "attack" },
  ];
  const output = await guardToolMessages(input, 0, scorer);
  assert.equal(output.messages[2].content, withheldText);
  assert.equal(input[2].content, "attack");
  assert.equal(output.messages[0].content, "attack");
  assert.equal(output.messages[1].content, "attack");
  assert.equal(output.messages[3].content, "attack");
  assert.equal(output.records.length, 1);
});
test("RAG filtering removes only flagged citations and preserves supporting metadata", async () => {
  const input: Message[] = [
    {
      role: "tool",
      tool_name: "search_documents",
      content: JSON.stringify({
        status: "ok",
        citations: [
          { id: "safe", text: "facts", version: "v1" },
          { id: "bad", text: "attack", version: "v1" },
        ],
      }),
    },
  ];
  const output = await guardToolMessages(input, 0, scorer);
  assert.deepEqual(JSON.parse(output.messages[0].content).citations, [
    { id: "safe", text: "facts", version: "v1" },
  ]);
  assert.equal(output.records[1].citationIndex, 1);
  assert.equal(output.records[1].blocked, true);
});
test("all-blocked retrieval produces no fabricated replacement evidence", async () => {
  const output = await guardToolMessages(
    [
      {
        role: "tool",
        tool_name: "search_documents",
        content: JSON.stringify({
          status: "ok",
          citations: [{ id: "bad", text: "attack" }],
        }),
      },
    ],
    0,
    scorer,
  );
  const result = JSON.parse(output.messages[0].content);
  assert.deepEqual(result.citations, []);
  assert.equal(result.status, "no_evidence");
});
test("detector outages stop the step instead of silently passing text", async () => {
  await assert.rejects(
    () =>
      guardToolMessages(
        [{ role: "tool", tool_name: "read_document", content: "facts" }],
        0,
        async (text) => ({
          id: "test",
          at: "test",
          source: "tool",
          text,
          status: "unavailable",
          threshold: 0.5,
        }),
      ),
    /stopped before inference/,
  );
});
test("scanning cursor avoids rescoring historical tool messages", async () => {
  const input: Message[] = [
    { role: "tool", tool_name: "read_document", content: "attack" },
    { role: "assistant", content: "next" },
    { role: "tool", tool_name: "search_catalog", content: "facts" },
  ];
  const output = await guardToolMessages(input, 2, scorer);
  assert.equal(output.records.length, 1);
  assert.equal(output.messages[0].content, "attack");
});
test("comparison covers every paired factorial cell once with fixed gateway", () => {
  const cells = detectorSchedule();
  assert.equal(cells.length, 120);
  assert.equal(new Set(cells.map((c) => JSON.stringify(c))).size, 120);
  for (const arm of ["none", "upstream", "finetuned"])
    for (const condition of ["clean", "attacked"])
      assert.equal(
        cells.filter((c) => c.detectorArm === arm && c.condition === condition)
          .length,
        20,
      );
});
