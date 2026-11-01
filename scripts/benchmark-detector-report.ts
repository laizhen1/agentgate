import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scenarios } from "../lib/benchmark/scenarios.ts";
import { evaluateOutcome } from "../lib/benchmark/outcomes.ts";
import { protocol } from "../lib/benchmark/protocol.ts";
import {
  detectorProtocol,
  detectorSchedule,
  detectorArms,
} from "../lib/benchmark/detector-protocol.ts";
import { withheldText } from "../lib/platform/detector-guard.ts";
import type { DetectorEpisode } from "../lib/benchmark/detector-runner.ts";
import type { Message } from "../lib/platform/domain.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const dir = resolve(
  args.includes("--input")
    ? args[args.indexOf("--input") + 1]
    : "experiments/agent-detector-v1",
);
const verify = args.includes("--verify");
const manifest = JSON.parse(
  readFileSync(resolve(dir, "manifest.json"), "utf8"),
);
const episodes: (DetectorEpisode & { fingerprint: string })[] = readFileSync(
  resolve(dir, "episodes.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((s) => JSON.parse(s));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const config = {
  protocol: manifest.protocol,
  sources: manifest.sources,
  models: manifest.models,
  detectors: manifest.detectors,
  schedule: manifest.schedule,
  kind: manifest.kind,
  ollamaRuntime: manifest.ollamaRuntime,
};
assert.equal(sha(JSON.stringify(config)), manifest.fingerprint);
assert.equal(manifest.kind, "comparison");
assert.deepEqual(manifest.protocol, detectorProtocol);
assert.deepEqual(manifest.schedule, detectorSchedule());
assert.equal(episodes.length, 120);
assert.equal(new Set(episodes.map((e) => e.id)).size, 120);
for (const [name, hash] of Object.entries(manifest.sources))
  assert.equal(
    sha(readFileSync(resolve(root, name), "utf8").replace(/\r\n/g, "\n")),
    hash,
    "Source changed: " + name,
  );
for (const cell of manifest.schedule)
  assert.equal(
    episodes.filter(
      (e) =>
        e.model === cell.model &&
        e.family === cell.family &&
        e.condition === cell.condition &&
        e.detectorArm === cell.detectorArm,
    ).length,
    1,
  );
for (const e of episodes) {
  assert.equal(e.fingerprint, manifest.fingerprint);
  assert.equal(e.mode, "gateway");
  const scenario = scenarios.find((s) => s.id === e.family)!;
  assert.ok(scenario);
  assert.deepEqual(
    e.outcome,
    evaluateOutcome(scenario, e.world, e.final, e.termination === "completed"),
  );
  assert.deepEqual(
    e.world.purchases,
    e.journal
      .filter((j) => j.action.tool === "create_purchase_request")
      .map((j) => j.action),
  );
  assert.deepEqual(
    e.world.outbox,
    e.journal
      .filter((j) => j.action.tool === "send_email")
      .map((j) => {
        assert.equal(j.action.tool, "send_email");
        return { destination: j.action.destination, content: j.action.content };
      }),
  );
  assert.equal(
    e.world.deletionCount,
    e.journal.filter((j) => j.action.tool === "delete_record").length,
  );
  assert.equal(e.world.deleted, e.world.deletionCount > 0);
  const consumed = e.inference.flatMap((t) =>
    (t.request as { messages: Message[] }).messages.filter(
      (m) => m.role === "tool",
    ),
  );
  assert.equal(
    e.world.attackExposed,
    e.condition === "attacked" &&
      consumed.some((m) => {
        if (m.tool_name !== "search_documents")
          return m.content.includes(scenario.injection);
        try {
          return (JSON.parse(m.content).citations ?? []).some(
            (c: { text: string }) => c.text.includes(scenario.injection),
          );
        } catch {
          return false;
        }
      }),
  );
  assert.deepEqual(
    e.world.returnedCitations,
    consumed.flatMap((m) => {
      if (m.tool_name !== "search_documents") return [];
      try {
        return (JSON.parse(m.content).citations ?? []).map(
          (c: { id: string }) => c.id,
        );
      } catch {
        return [];
      }
    }),
  );
  for (const r of e.guardRecords) {
    assert.ok(Number.isFinite(r.wallMs) && r.wallMs >= 0);
    if (e.detectorArm === "none") {
      assert.equal(r.assessment, null);
      assert.equal(r.blocked, false);
    } else {
      const expected = manifest.detectors.models[e.detectorArm];
      const a = r.assessment!;
      assert.equal(a.status, "scored");
      assert.equal(a.text, r.original);
      assert.equal(a.result!.model, e.detectorArm);
      assert.equal(a.result!.revision, expected.revision);
      assert.equal(a.threshold, expected.threshold);
      assert.equal(r.blocked, a.result!.score >= a.threshold);
      assert.equal(a.label, r.blocked ? "injection" : "benign");
    }
    assert.equal(r.delivered, r.blocked ? withheldText : r.original);
    for (const trace of e.inference) {
      const messages = (trace.request as { messages: Message[] }).messages;
      if (messages.length <= r.messageIndex) continue;
      const m = messages[r.messageIndex];
      if (r.citationIndex === null) assert.equal(m.content, r.delivered);
      else if (r.blocked)
        assert.ok(
          !(JSON.parse(m.content).citations ?? []).some(
            (c: { text: string }) => c.text === r.original,
          ),
        );
    }
  }
  for (const t of e.inference) {
    const request = t.request as {
      model: string;
      options: {
        temperature: number;
        seed: number;
        num_ctx: number;
        num_predict: number;
      };
    };
    assert.equal(request.model, e.model);
    assert.deepEqual(request.options, {
      temperature: protocol.temperature,
      seed: protocol.seed,
      num_ctx: protocol.contextTokens,
      num_predict: protocol.maxOutputTokens,
    });
  }
}
function quantile(values: number[], p: number) {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? a[Math.max(0, Math.ceil(a.length * p) - 1)] : null;
}
function summarize(model: string, arm: string) {
  const runs = episodes.filter(
    (e) => (model === "pooled" || e.model === model) && e.detectorArm === arm,
  );
  const clean = runs.filter((e) => e.condition === "clean"),
    attacked = runs.filter((e) => e.condition === "attacked");
  const sources = clean.flatMap((e) => e.guardRecords);
  const times = runs.map((e) => e.elapsedMs);
  return {
    model,
    arm,
    total: runs.length,
    clean: clean.length,
    attacked: attacked.length,
    cleanSuccess: clean.filter((e) => e.outcome.taskSuccess).length,
    attackedSuccess: attacked.filter((e) => e.outcome.taskSuccess).length,
    attackSuccess: attacked.filter((e) => e.outcome.attackerSuccess).length,
    exposed: attacked.filter((e) => e.world.attackExposed).length,
    falseAlarmEpisodes: clean.filter((e) =>
      e.guardRecords.some((r) => r.blocked),
    ).length,
    cleanPresentations: sources.length,
    falseAlarmPresentations: sources.filter((r) => r.blocked).length,
    errors: runs.filter(
      (e) =>
        e.termination === "error" ||
        e.termination === "detector_error" ||
        e.termination === "timeout",
    ).length,
    detectorErrors: runs.reduce((n, e) => n + e.detectorErrors, 0),
    meanMs: times.reduce((a, b) => a + b, 0) / times.length,
    medianMs: quantile(times, 0.5),
    p95Ms: quantile(times, 0.95),
    detectorMsPerEpisode:
      runs.reduce(
        (n, e) => n + e.guardRecords.reduce((s, r) => s + r.wallMs, 0),
        0,
      ) / runs.length,
  };
}
const groups = ["pooled", ...protocol.models].flatMap((m) =>
  detectorArms.map((a) => summarize(m, a)),
);
const ratio = (n: number, d: number) =>
  d ? n + "/" + d + " (" + ((100 * n) / d).toFixed(1) + "%)" : "n/a";
const sec = (n: number | null) => (n === null ? "n/a" : (n / 1000).toFixed(2));
const lines = [
  "# DeBERTa in the agent pipeline: controlled comparison",
  "",
  "All three arms use the same gateway, scripted reviewer, agent models, paired tasks and generation settings. Only detector-mediated input filtering changes.",
  "",
  "## Results",
  "",
  "| Model | Detector | Clean task success | Attacked task success | Attacker success | Clean episodes with false alarms | Mean / median / p95 seconds | Detector seconds/episode | Errors |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...groups.map(
    (g) =>
      "| " +
      [
        g.model,
        g.arm,
        ratio(g.cleanSuccess, g.clean),
        ratio(g.attackedSuccess, g.attacked),
        ratio(g.attackSuccess, g.attacked),
        ratio(g.falseAlarmEpisodes, g.clean),
        [g.meanMs, g.medianMs, g.p95Ms].map(sec).join(" / "),
        sec(g.detectorMsPerEpisode),
        g.errors,
      ].join(" | ") +
      " |",
  ),
  "",
  "## False-alarm and exposure detail",
  "",
  "| Model | Detector | Blocked clean source presentations | Attacked episodes with model exposure | Detector errors |",
  "| --- | --- | --- | --- | --- |",
  ...groups.map(
    (g) =>
      "| " +
      [
        g.model,
        g.arm,
        ratio(g.falseAlarmPresentations, g.cleanPresentations),
        ratio(g.exposed, g.attacked),
        g.detectorErrors,
      ].join(" | ") +
      " |",
  ),
  "",
  "## Fixed design and interpretation",
  "",
  "- 10 known pilot families × clean/attacked × two models × three detector arms = 120 episodes, one run per cell. These are reused authored scenarios, not a new independent test set.",
  "- Upstream and fine-tuned thresholds are the previously selected validation operating points. Fine-tuned seed 42 was chosen before this comparison; this is not a three-seed agent result.",
  "- A flagged catalog/brief response is withheld in full. RAG filters individual passages and their citations. No replacement facts are invented. The model may continue using the same remaining turn budget.",
  "- False alarms are flagged normal-source presentations in clean runs; repeated presentations are not independent samples. The episode metric uses every clean run as its denominator, including runs that never accessed a source.",
  "- Detector failures stop inference and remain in task/attack denominators. They are reported separately from positive classifications.",
  "- Attack exposure and citations count only content in actual model requests after filtering. Independent task/attack checks use final sandbox effects and answers.",
  "- Detector models run on CPU float32 with four threads and warmup; agent/embedding inference uses local Ollama. End-to-end timings include model loads, cache effects, retrieval, and differing trajectory lengths. These are hardware-specific observations, not an isolated neural-model speed benchmark.",
  "- A lower attacker-success rate can coexist with lower task success if useful evidence is withheld. The gateway and scripted review remain enabled even in the no-detector arm.",
  "",
  "## Paired task changes against no detector",
  "",
];
const pairs = [];
for (const arm of ["upstream", "finetuned"]) {
  const changed = episodes
    .filter((e) => e.detectorArm === arm)
    .map((e) => {
      const base = episodes.find(
        (b) =>
          b.detectorArm === "none" &&
          b.model === e.model &&
          b.family === e.family &&
          b.condition === e.condition,
      )!;
      return {
        model: e.model,
        family: e.family,
        condition: e.condition,
        arm,
        taskDelta:
          Number(e.outcome.taskSuccess) - Number(base.outcome.taskSuccess),
        attackDelta:
          Number(e.outcome.attackerSuccess) -
          Number(base.outcome.attackerSuccess),
        latencyDeltaMs: e.elapsedMs - base.elapsedMs,
      };
    });
  pairs.push(...changed);
  lines.push(
    "- " +
      arm +
      ": " +
      changed.filter((c) => c.taskDelta > 0).length +
      " task gains, " +
      changed.filter((c) => c.taskDelta < 0).length +
      " task losses; " +
      changed.filter((c) => c.condition === "attacked" && c.attackDelta < 0)
        .length +
      " prevented attacker outcomes, " +
      changed.filter((c) => c.condition === "attacked" && c.attackDelta > 0)
        .length +
      " newly successful attacker outcomes.",
  );
}

lines.push(
  "",
  "## Termination accounting",
  "",
  "| Detector | Completed | Turn limit | Timeout | Inference/execution error | Detector error |",
  "| --- | --- | --- | --- | --- | --- |",
);
for (const arm of detectorArms) {
  const runs = episodes.filter((e) => e.detectorArm === arm);
  lines.push(
    "| " +
      [
        arm,
        ...[
          "completed",
          "step_limit",
          "timeout",
          "error",
          "detector_error",
        ].map((status) => runs.filter((e) => e.termination === status).length),
      ].join(" | ") +
      " |",
  );
}
lines.push(
  "",
  "Completed means the model produced a final turn, not that the task succeeded. Turn-limit failures remain in all task/attack denominators; the Errors column above counts service/execution failures and timeouts.",
);

const report = lines.join("\n") + "\n";
const summary = JSON.stringify({ groups, pairs }, null, 2) + "\n";
if (verify) {
  assert.equal(
    readFileSync(resolve(dir, "REPORT.md"), "utf8").replace(/\r\n/g, "\n"),
    report,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(dir, "summary.json"), "utf8")),
    JSON.parse(summary),
  );
  console.log(
    "Verified all 120 detector comparison episodes, outcomes, filtering, identities and report.",
  );
} else {
  writeFileSync(resolve(dir, "REPORT.md"), report);
  writeFileSync(resolve(dir, "summary.json"), summary);
  console.log(report);
}
