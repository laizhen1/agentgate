import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { protocol } from "../lib/benchmark/protocol.ts";
import {
  recoveryProtocol,
  recoveryFrozenFiles,
  recoverySchedule,
} from "../lib/benchmark/recovery-protocol.ts";
import {
  recoveryDevelopment as developmentScenario,
  recoveryScenarios as scenarios,
} from "../lib/benchmark/recovery-scenarios.ts";
import {
  runRecoveryEpisode,
  type RecoveryEpisode,
} from "../lib/benchmark/recovery-runner.ts";
import { detectThreat } from "../lib/platform/threat.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (key: string, fallback: string) =>
  args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const out = resolve(option("--out", "artifacts/agent-recovery-v1"));
const smoke = args.includes("--smoke");
const endpoint = "http://127.0.0.1:8767";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sources = () =>
  Object.fromEntries(
    recoveryFrozenFiles.map((name) => [
      name,
      sha(readFileSync(resolve(root, name), "utf8").replace(/\r\n/g, "\n")),
    ]),
  );
async function json<T = unknown>(url: string, body?: unknown) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!r.ok) throw Error("Preflight service unavailable: HTTP " + r.status);
  return r.json() as Promise<T>;
}
type DetectorMetadata = {
  models: Record<
    string,
    {
      model: string;
      revision: string;
      threshold: number;
      files: Record<string, string>;
    }
  >;
  runtime: unknown;
};
const metadata = await json<DetectorMetadata>(endpoint + "/metadata");
const tags = await json<{ models: { name: string; digest: string }[] }>(
  "http://127.0.0.1:11435/api/tags",
);
const models = [...protocol.models, protocol.embeddingModel].map((name) => {
  const model = tags.models.find((m: { name: string }) => m.name === name);
  if (!model) throw Error("Required Ollama model missing: " + name);
  return { name, digest: model.digest };
});
const read = (name: string) =>
  JSON.parse(readFileSync(resolve(root, name), "utf8"));
for (const arm of ["upstream", "finetuned"]) {
  const selection = read(
    "experiments/deberta-v3/results/" +
      (arm === "upstream" ? "pretrained" : "deberta-lr5e-05-seed42") +
      "/selection.json",
  );
  if (metadata.models[arm].threshold !== selection.threshold)
    throw Error("Threshold mismatch");
  if (
    arm === "finetuned" &&
    metadata.models[arm].revision !== selection.revision
  )
    throw Error("Checkpoint mismatch");
}
const baseFiles = read("experiments/deberta-v1/sources/manifest.json");
for (const entry of baseFiles.filter((e: { path: string }) =>
  e.path.startsWith("base-model/"),
)) {
  if (
    metadata.models.upstream.files[entry.path.slice("base-model/".length)] !==
    entry.sha256
  )
    throw Error("Upstream file identity mismatch: " + entry.path);
}
const schedule = recoverySchedule(smoke);
const config = {
  protocol: recoveryProtocol,
  sources: sources(),
  models,
  detectors: metadata,
  schedule,
  kind: smoke ? "development" : "comparison",
  ollamaRuntime: await json("http://127.0.0.1:11435/api/version"),
};
const fingerprint = sha(JSON.stringify(config));
mkdirSync(out, { recursive: true });
const manifestPath = resolve(out, "manifest.json");
const episodesPath = resolve(out, "episodes.jsonl");
if (existsSync(manifestPath)) {
  if (
    readFileSync(manifestPath, "utf8") &&
    JSON.parse(readFileSync(manifestPath, "utf8")).fingerprint !== fingerprint
  )
    throw Error("Frozen configuration changed; use a new output directory");
} else {
  if (existsSync(episodesPath)) throw Error("Evidence exists without manifest");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        ...config,
        fingerprint,
        frozenAt: new Date().toISOString(),
        node: process.version,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
}
const prior: (RecoveryEpisode & { fingerprint: string })[] = existsSync(
  episodesPath,
)
  ? readFileSync(episodesPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => JSON.parse(s))
  : [];
if (
  prior.some((e) => e.fingerprint !== fingerprint) ||
  new Set(prior.map((e) => e.id)).size !== prior.length
)
  throw Error("Invalid prior evidence");
let warmedModel = "";
for (const cell of schedule) {
  if (warmedModel !== cell.model) {
    await json("http://127.0.0.1:11435/api/chat", {
      model: cell.model,
      messages: [{ role: "user", content: "Reply OK." }],
      stream: false,
      think: false,
      options: { num_predict: 4, temperature: 0 },
    });
    warmedModel = cell.model;
  }
  if (
    prior.some(
      (e) =>
        e.model === cell.model &&
        e.family === cell.family &&
        e.condition === cell.condition &&
        e.recoveryArm === cell.recoveryArm,
    )
  )
    continue;
  if (JSON.stringify(sources()) !== JSON.stringify(config.sources))
    throw Error("Source changed after freeze");
  if (
    JSON.stringify(await json(endpoint + "/metadata")) !==
    JSON.stringify(metadata)
  )
    throw Error("Detector changed");
  const current = await json<{ models: { name: string; digest: string }[] }>(
    "http://127.0.0.1:11435/api/tags",
  );
  if (
    models.some(
      (m) =>
        !current.models.some(
          (n: { name: string; digest: string }) =>
            n.name === m.name && n.digest === m.digest,
        ),
    )
  )
    throw Error("Ollama model changed");
  const scorer = async (text: string) => {
    const arm = "finetuned";
    const result = await detectThreat(
      endpoint,
      text,
      "tool",
      async (_input, init) => fetch(endpoint + "/" + arm, init),
    );
    const expected = metadata.models[arm];
    if (
      result.status !== "scored" ||
      result.result?.revision !== expected.revision ||
      result.result?.model !== arm ||
      result.threshold !== expected.threshold
    )
      throw Error("Detector failed identity check");
    return result;
  };
  const scenario = (smoke ? [developmentScenario] : scenarios).find(
    (s) => s.id === cell.family,
  )!;
  const episode = await runRecoveryEpisode(
    scenario,
    cell.condition,
    "gateway",
    cell.model,
    "http://127.0.0.1:11435",
    "http://127.0.0.1:8766",
    models.find((m) => m.name === protocol.embeddingModel)!.digest,
    cell.recoveryArm,
    scorer,
  );
  appendFileSync(
    episodesPath,
    JSON.stringify({ fingerprint, ...episode }) + "\n",
  );
  prior.push({ ...episode, fingerprint });
  console.log(
    JSON.stringify({
      completed: prior.length,
      total: schedule.length,
      id: episode.id,
      termination: episode.termination,
      task: episode.outcome.taskSuccess,
      attack: episode.outcome.attackerSuccess,
      blocked: episode.guardRecords.filter((r) => r.blocked).length,
      seconds: Math.round(episode.elapsedMs / 1000),
    }),
  );
}
