import test from "node:test";
import assert from "node:assert/strict";
import {
  newOrg,
  createSession,
  applyReply,
  type ModelReply,
} from "../lib/platform/domain.ts";
import { chunks, searchDocuments } from "../lib/platform/retrieval.ts";

function fixture() {
  const org = newOrg("org", "Knowledge", "owner", "owner@example.com");
  org.documents = [
    {
      id: "doc",
      title: "Warranty",
      source: "Supplier brief",
      version: "v1",
      text: "Warranty is two years.",
      enabled: true,
      createdAt: "now",
      createdBy: "owner",
    },
    {
      id: "disabled",
      title: "Old",
      source: "Old",
      version: "v0",
      text: "Excluded secret",
      enabled: false,
      createdAt: "now",
      createdBy: "owner",
    },
  ];
  return org;
}
test("retrieval sends only enabled organization passages and resolves citations locally", async () => {
  const org = fixture();
  const result = await searchDocuments(
    org,
    "owner",
    "warranty",
    "http://127.0.0.1:8766",
    async (_, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.chunks.length, 1);
      assert.equal(body.chunks[0].text, "Warranty is two years.");
      return Response.json({
        model: "embed",
        revision: "r1",
        hits: [{ id: body.chunks[0].id, score: 0.8 }],
      });
    },
  );
  assert.equal(result.citations[0].source, "Supplier brief");
  assert.equal(result.citations[0].version, "v1");
  assert.equal(result.status, "evidence");
});
test("authorization, revoked tokens and policy are checked before retrieval", async () => {
  const org = fixture();
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error("unexpected");
  };
  for (const actor of ["outsider", "mcp:revoked"])
    await assert.rejects(
      searchDocuments(org, actor, "query", "http://127.0.0.1:8766", fetcher),
    );
  org.policy.allowedTools = [];
  await assert.rejects(
    searchDocuments(org, "owner", "query", "http://127.0.0.1:8766", fetcher),
  );
  assert.equal(calls, 0);
});
test("foreign, duplicate and malformed citations fail closed", async () => {
  for (const hits of [
    [{ id: "another-org", score: 0.9 }],
    [
      { id: "doc:v1:0", score: 0.9 },
      { id: "doc:v1:0", score: 0.9 },
    ],
    [{ id: "doc:v1:0", score: 9 }],
  ]) {
    await assert.rejects(
      searchDocuments(
        fixture(),
        "owner",
        "query",
        "http://127.0.0.1:8766",
        async () => Response.json({ model: "embed", revision: "r", hits }),
      ),
      /invalid evidence/,
    );
  }
});
test("empty corpus produces explicit insufficient evidence without calling service", async () => {
  const org = fixture();
  org.documents!.forEach((d) => {
    d.enabled = false;
  });
  assert.equal(
    (await searchDocuments(org, "owner", "query")).status,
    "insufficient_evidence",
  );
});
test("chunks cover the end of long documents with overlap", () => {
  const org = fixture();
  org.documents![0].text = "x".repeat(1500) + "END";
  const passages = chunks(org.documents!);
  assert.ok(passages.at(-1)?.text.endsWith("END"));
  assert.equal(passages[1].offset, 680);
});
test("document tool cannot execute when current policy revokes access even in baseline mode", async () => {
  const org = fixture();
  const session = createSession(org, "owner", "Find warranty", "unprotected");
  org.policy.allowedTools = [];
  const reply: ModelReply = {
    model: "test",
    inputTokens: 1,
    outputTokens: 1,
    durationMs: 1,
    message: {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          function: {
            name: "search_documents",
            arguments: { query: "warranty" },
          },
        },
      ],
    },
  };
  let called = false;
  await applyReply(org, session, reply, async () => {
    called = true;
    return "evidence";
  });
  assert.equal(called, false);
  assert.equal(session.proposals[0].status, "blocked");
});
test("document evidence enters the tool trace and service failures do not become fabricated evidence", async () => {
  for (const fail of [false, true]) {
    const org = fixture();
    const session = createSession(org, "owner", "Find warranty", "gateway");
    const reply: ModelReply = {
      model: "test",
      inputTokens: 1,
      outputTokens: 1,
      durationMs: 1,
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "search_documents",
              arguments: { query: "warranty" },
            },
          },
        ],
      },
    };
    await applyReply(org, session, reply, async () => {
      if (fail) throw Error("offline");
      return "[doc:v1:0] Two years";
    });
    assert.equal(session.proposals[0].status, fail ? "blocked" : "executed");
    assert.match(
      session.messages.at(-1)!.content,
      fail ? /No evidence/ : /doc:v1:0/,
    );
  }
});
