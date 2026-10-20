import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { developmentScenario, scenarios } from "../lib/benchmark/scenarios.ts";
import { frozenFiles, protocol } from "../lib/benchmark/protocol.ts";
import { runEpisode, type Episode } from "../lib/benchmark/runner.ts";
import { validateConfig } from "../lib/platform/ollama.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name: string, fallback: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = resolve(option("--out", "artifacts/agent-pilot-v1"));
const smoke = args.includes("--smoke");
const url = option("--ollama", "http://127.0.0.1:11434");
const retrievalUrl = option("--retrieval", "http://127.0.0.1:8766");
validateConfig({ url, model: "preflight" });
validateConfig({ url: retrievalUrl, model: "preflight" });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const sources = () =>
  Object.fromEntries(
    frozenFiles.map((name) => [
      name,
      sha(readFileSync(resolve(root, name), "utf8").replace(/\r\n/g, "\n")),
    ]),
  );
async function localJson(path: string, data?: unknown) {
  const response = await fetch(new URL(path, url), {
    method: data ? "POST" : "GET",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    ...(data
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {}),
  });
  if (!response.ok) throw Error(`Preflight HTTP ${response.status}`);
  return response.json();
}
const tags = (await localJson("api/tags")) as {
  models: { name: string; digest: string; details: unknown }[];
};
const models = [...protocol.models, protocol.embeddingModel].map((name) => {
  const found = tags.models.find((m) => m.name === name);
  if (!found) throw Error(`Download required model first: ${name}`);
  return { name, digest: found.digest, details: found.details };
});
for (const model of protocol.models) {
  const info = (await localJson("api/show", { model })) as {
    capabilities?: string[];
  };
  if (!info.capabilities?.includes("tools"))
    throw Error(`${model} does not advertise native tool support`);
}
const schedule = protocol.models.flatMap((model) =>
  (smoke ? [developmentScenario] : scenarios).flatMap((scenario, index) => {
    // Counterbalance condition and mode order by family, with each model kept together for bounded VRAM.
    const conditions =
      index % 2 ? [...protocol.conditions].reverse() : [...protocol.conditions];
    const modes =
      index % 2 ? [...protocol.modes].reverse() : [...protocol.modes];
    return conditions.flatMap((condition) =>
      modes.map((mode) => ({ model, family: scenario.id, condition, mode })),
    );
  }),
);
const manifestPath = resolve(output, "manifest.json");
const episodesPath = resolve(output, "episodes.jsonl");
const config = {
  protocol,
  sourceSha256NormalizedLF: sources(),
  models,
  schedule,
  kind: smoke ? "development-smoke" : "pilot",
};
const fingerprint = sha(JSON.stringify(config));
mkdirSync(output, { recursive: true });
if (existsSync(manifestPath)) {
  const previous = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (previous.fingerprint !== fingerprint)
    throw Error(
      "Frozen configuration, source, or model changed; use a new output directory. Do not overwrite prior evidence.",
    );
} else {
  if (existsSync(episodesPath))
    throw Error("Episode file exists without its manifest");
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const runtime = (await localJson("api/version")) as { version: string };
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        ...config,
        fingerprint,
        frozenAt: new Date().toISOString(),
        baseCommit: commit,
        runtime: {
          node: process.version,
          ollama: runtime.version,
          platform: process.platform,
          architecture: process.arch,
          retrievalDependencies: "services/retrieval/requirements.txt",
        },
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
}
const prior = existsSync(episodesPath)
  ? readFileSync(episodesPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Episode & { fingerprint: string })
  : [];
if (
  prior.some((e) => e.fingerprint !== fingerprint) ||
  new Set(prior.map((e) => e.id)).size !== prior.length
)
  throw Error("Invalid or duplicate prior episode evidence");
let completed = prior.length;
for (const cell of schedule) {
  if (
    prior.some(
      (e) =>
        e.model === cell.model &&
        e.family === cell.family &&
        e.condition === cell.condition &&
        e.mode === cell.mode,
    )
  )
    continue;
  if (
    JSON.stringify(sources()) !==
    JSON.stringify(config.sourceSha256NormalizedLF)
  )
    throw Error("Source changed after freeze");
  const currentTags = (await localJson("api/tags")) as typeof tags;
  if (
    models.some(
      (expected) =>
        !currentTags.models.some(
          (actual) =>
            actual.name === expected.name && actual.digest === expected.digest,
        ),
    )
  )
    throw Error("Model changed after freeze");
  const scenario = (smoke ? [developmentScenario] : scenarios).find(
    (s) => s.id === cell.family,
  )!;
  const episode = await runEpisode(
    scenario,
    cell.condition,
    cell.mode,
    cell.model,
    url,
    retrievalUrl,
    models.find((m) => m.name === protocol.embeddingModel)!.digest,
  );
  appendFileSync(
    episodesPath,
    JSON.stringify({ fingerprint, ...episode }) + "\n",
  );
  completed++;
  console.log(
    JSON.stringify({
      completed,
      total: schedule.length,
      id: episode.id,
      termination: episode.termination,
      taskSuccess: episode.outcome.taskSuccess,
      attackerSuccess: episode.outcome.attackerSuccess,
      exposed: episode.outcome.attackExposed,
      seconds: Math.round(episode.elapsedMs / 1000),
    }),
  );
}
console.log(
  `Recorded ${completed}/${schedule.length} real episodes. Failures remain in the denominator. Generate and verify the report with npm run benchmark:report.`,
);
