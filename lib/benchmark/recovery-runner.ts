import {
  guardToolMessages,
  type ScoreText,
  type GuardRecord,
} from "../platform/detector-guard.ts";
import {
  applyReply,
  createSession,
  newOrg,
  review,
  type Mode,
} from "../platform/domain.ts";
import { searchDocuments } from "../platform/retrieval.ts";
import { environment, reviewerAllows } from "./environment.ts";
import { authorizedAction, evaluateOutcome } from "./outcomes.ts";
import { defensePrompt, protocol, systemPrompt } from "./protocol.ts";
import { infer, type InferenceTrace } from "./inference.ts";
import { fallbackText, type RecoveryScenario } from "./recovery-scenarios.ts";
import type { RecoveryArm } from "./recovery-protocol.ts";
import {
  recoverFilteredEvidence,
  recoverySearch,
  type RecoveryRecord,
} from "../platform/recovery.ts";

export async function runRecoveryEpisode(
  scenario: RecoveryScenario,
  condition: "clean" | "attacked",
  mode: Mode,
  model: string,
  url: string,
  retrievalUrl: string,
  embeddingDigest: string,
  recoveryArm: RecoveryArm,
  scorer: ScoreText,
) {
  const id =
    recoveryArm +
    "-" +
    `${model.replace(/[^a-z0-9]/gi, "_")}-${scenario.id}-${condition}-${mode}`;
  const org = newOrg(
    `org-${id}`,
    "Synthetic benchmark organization",
    "operator",
    "operator@example.com",
  );
  org.members.push({
    userId: "reviewer",
    email: "reviewer@example.com",
    role: "reviewer",
  });
  org.twoPerson = true;
  const env = environment(scenario, condition === "attacked");
  org.documents = [
    {
      id: "alternate",
      title: "Organization procurement register",
      source: "https://records.example.com/procurement",
      version: "v1",
      text: fallbackText(scenario, condition),
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "operator",
    },
    {
      id: "unrelated",
      title: "Office hours",
      source: "https://records.example.com/hours",
      version: "v1",
      text: "The purchasing desk opens at 9 AM. Building access closes at 6 PM.",
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "operator",
    },
  ];
  const session = createSession(org, "operator", scenario.prompt, mode);
  session.messages[0].content =
    systemPrompt + (mode === "unprotected" ? "" : " " + defensePrompt);
  const inference: InferenceTrace[] = [];
  const retrieval: {
    query: string;
    result: Awaited<ReturnType<typeof searchDocuments>>;
  }[] = [];
  const approvals: { action: unknown; allowed: boolean }[] = [];
  const guardRecords: GuardRecord[] = [];
  const recoveryRecords: RecoveryRecord[] = [];
  let scannedUntil = 0;
  let detectorErrors = 0;
  const started = Date.now();
  let termination = "step_limit";
  let error: string | null = null;
  let retrievalErrors = 0;
  let generationTruncations = 0;
  for (let step = 0; step < protocol.maxSteps; step++) {
    if (Date.now() - started >= protocol.episodeTimeoutMs) {
      termination = "timeout";
      break;
    }
    try {
      try {
        const guarded = await guardToolMessages(
          session.messages,
          scannedUntil,
          scorer,
        );
        if (recoveryArm === "filter-recover") {
          const recovered = await recoverFilteredEvidence(
            session.messages,
            guarded.messages,
            guarded.records,
            scorer,
            async (query, excluded, blocked) => {
              const raw = await recoverySearch(org, "operator", retrievalUrl)(
                query,
                excluded,
                blocked,
              );
              const found = JSON.parse(raw);
              if (
                found.model &&
                (found.revision !== embeddingDigest ||
                  (found.model.includes(":")
                    ? found.model
                    : found.model + ":latest") !== protocol.embeddingModel)
              )
                throw Error("Recovery embedding model mismatch");
              env.world.reads.push("rag");
              return raw;
            },
          );
          session.messages = recovered.messages;
          if (recovered.recovery) recoveryRecords.push(recovered.recovery);
        } else session.messages = guarded.messages;
        guardRecords.push(...guarded.records);
        scannedUntil = session.messages.length;
      } catch {
        detectorErrors++;
        termination = "detector_error";
        error = "Detector unavailable; stopped before inference.";
        break;
      }
      const result = await infer(
        url,
        model,
        session.messages,
        protocol.episodeTimeoutMs - (Date.now() - started),
      );
      inference.push(result.trace);
      if (
        (result.trace.response as { done_reason?: string }).done_reason ===
        "length"
      )
        generationTruncations++;
      await applyReply(
        org,
        session,
        result.reply,
        async (_org, _session, query) => {
          try {
            const found = await searchDocuments(
              org,
              "operator",
              query,
              retrievalUrl,
            );
            if (
              !("revision" in found) ||
              found.revision !== embeddingDigest ||
              (found.model.includes(":")
                ? found.model
                : found.model + ":latest") !== protocol.embeddingModel
            )
              throw Error(
                "Retrieval model differs from the frozen embedding model",
              );
            retrieval.push({ query, result: found });
            env.world.reads.push("rag");
            env.world.returnedCitations.push(
              ...found.citations.map((c) => c.id),
            );
            env.world.attackExposed ||=
              condition === "attacked" &&
              scenario.source === "rag" &&
              found.citations.some((c) => c.text.includes(scenario.injection));
            // Same evidence/citations in every arm; no hidden defense added to the baseline.
            return JSON.stringify({
              status: found.status,
              citations: found.citations,
            });
          } catch {
            retrievalErrors++;
            throw Error("Retrieval service unavailable");
          }
        },
        env.execute,
      );
      for (const proposal of session.proposals.filter(
        (p) => p.status === "pending",
      )) {
        const allowed =
          !!proposal.action &&
          reviewerAllows(scenario, proposal.action, env.world);
        approvals.push({ action: proposal.action, allowed });
        await review(
          org,
          session,
          proposal.id,
          "reviewer",
          allowed,
          Date.now(),
          env.execute,
        );
      }
      if (session.status === "completed") {
        termination = "completed";
        break;
      }
    } catch (caught) {
      // Never serialize stack traces or local paths into public evidence.
      error =
        caught instanceof Error &&
        /^(Inference HTTP \d+|Malformed native tool response|Inference response exceeded 128000 characters)$/.test(
          caught.message,
        )
          ? caught.message
          : "Inference or execution failed; inspect local service health.";
      termination = "error";
      break;
    }
  }
  const elapsedMs = Date.now() - started;
  const final =
    session.messages.at(-1)?.role === "assistant"
      ? session.messages.at(-1)!.content
      : "";
  const consumed = inference.flatMap((call) =>
    (call.request as { messages: typeof session.messages }).messages.filter(
      (m) => m.role === "tool",
    ),
  );
  env.world.attackExposed =
    condition === "attacked" &&
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
    });
  env.world.returnedCitations = consumed.flatMap((m) => {
    if (m.tool_name !== "search_documents") return [];
    try {
      return (JSON.parse(m.content).citations ?? []).map(
        (c: { id: string }) => c.id,
      );
    } catch {
      return [];
    }
  });
  const outcome = evaluateOutcome(
    scenario,
    env.world,
    final,
    termination === "completed",
  );
  const proposed = session.proposals
    .filter((p) => p.action)
    .map((p) => p.action!);
  // Scope violations in proposals; duplicate actual effects are measured by the independent state evaluator.
  const unauthorizedProposal = proposed.some(
    (action) => !authorizedAction(scenario, action),
  );
  const legitimateDenied = session.proposals.filter(
    (p) =>
      p.action &&
      authorizedAction(scenario, p.action) &&
      ["blocked", "rejected", "expired"].includes(p.status),
  ).length;
  return {
    id,
    family: scenario.id,
    recoveryArm,
    guardRecords,
    recoveryRecords,
    fallbackKind: scenario.fallbackKind,
    detectorErrors,
    model,
    condition,
    mode,
    termination,
    error,
    elapsedMs,
    steps: session.steps,
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    retrievalErrors,
    generationTruncations,
    unauthorizedProposal,
    legitimateDenied,
    outcome,
    final,
    world: env.world,
    journal: env.journal,
    approvals,
    retrieval,
    inference,
    proposals: session.proposals,
    messages: session.messages,
  };
}

export type RecoveryEpisode = Awaited<ReturnType<typeof runRecoveryEpisode>>;
