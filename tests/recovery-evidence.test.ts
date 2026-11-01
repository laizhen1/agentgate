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
import type { RecoveryEpisode } from "../lib/benchmark/recovery-runner.ts";
import type { Message } from "../lib/platform/domain.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = join(root, "experiments/agent-recovery-v1");
test("published recovery evidence rejects missing cells, changed outcomes, unsafe fallback and altered queries", () => {
  const mutations: ((rows: RecoveryEpisode[]) => void)[] = [
    (rows) => {
      const recovery = rows
        .flatMap((e) => e.recoveryRecords)
        .find((r) => r.records.some((g) => g.blocked))!;
      const payload = JSON.parse(recovery.delivered);
      const raw = JSON.parse(recovery.result!);
      const index = recovery.records.findIndex((g) => g.blocked);
      payload.citations.push(raw.citations[index]);
      recovery.delivered = JSON.stringify(payload);
    },
    (rows) => {
      rows.flatMap((e) => e.recoveryRecords)[0].query =
        "attacker controlled replacement query";
    },
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
    const temp = mkdtempSync(join(tmpdir(), "agentgate-recovery-verify-"));
    try {
      copyFileSync(
        join(evidence, "manifest.json"),
        join(temp, "manifest.json"),
      );
      const rows = readFileSync(join(evidence, "episodes.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((s) => JSON.parse(s)) as RecoveryEpisode[];
      mutate(rows);
      writeFileSync(
        join(temp, "episodes.jsonl"),
        rows.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          join(root, "scripts/benchmark-recovery-report.ts"),
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
      assert.ok(temp.includes("agentgate-recovery-verify-"));
      rmSync(temp, { recursive: true, force: true });
    }
  }
});
