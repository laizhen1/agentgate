import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DetectorEpisode } from "../lib/benchmark/detector-runner.ts";
import type { Message } from "../lib/platform/domain.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = join(root, "experiments/agent-detector-v1");
test("published detector evidence rejects missing cells, changed outcomes and reintroduced blocked text", () => {
  const mutations: ((rows: DetectorEpisode[]) => void)[] = [
    (rows) => {
      rows.pop();
    },
    (rows) => {
      rows[0].outcome.taskSuccess = !rows[0].outcome.taskSuccess;
    },
    (rows) => {
      const e = rows.find((e) =>
        e.guardRecords.some((r) => r.blocked && r.citationIndex === null),
      )!;
      const r = e.guardRecords.find(
        (r) => r.blocked && r.citationIndex === null,
      )!;
      const request = e.inference
        .map((t) => t.request as { messages: Message[] })
        .find((t) => t.messages.length > r.messageIndex)!;
      request.messages[r.messageIndex].content = r.original;
    },
  ];
  for (const mutate of mutations) {
    const temp = mkdtempSync(join(tmpdir(), "agentgate-detector-verify-"));
    try {
      copyFileSync(
        join(evidence, "manifest.json"),
        join(temp, "manifest.json"),
      );
      const rows = readFileSync(join(evidence, "episodes.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s)) as DetectorEpisode[];
      mutate(rows);
      writeFileSync(
        join(temp, "episodes.jsonl"),
        rows.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          join(root, "scripts/benchmark-detector-report.ts"),
          "--input",
          temp,
          "--verify",
        ],
        { encoding: "utf8" },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /AssertionError/);
      assert.doesNotMatch(result.stderr, /ENOENT/);
    } finally {
      assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
      assert.ok(temp.includes("agentgate-detector-verify-"));
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
