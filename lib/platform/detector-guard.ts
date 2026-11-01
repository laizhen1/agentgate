import type { Message } from "./domain.ts";
import { detectThreat, type ThreatAssessment } from "./threat.ts";

export const withheldText =
  "Source content withheld by the injection detector. Do not invent missing facts; use other available evidence or explain that evidence is unavailable.";
export type GuardRecord = {
  messageIndex: number;
  citationIndex: number | null;
  original: string;
  delivered: string;
  blocked: boolean;
  assessment: ThreatAssessment | null;
  wallMs: number;
};
export type ScoreText = (text: string) => Promise<ThreatAssessment>;

// Model-input boundary: never scan trusted instructions or action acknowledgments.
// Copy the context; preserve raw tool evidence for independent auditing.
export async function guardToolMessages(
  messages: Message[],
  startIndex: number,
  score: ScoreText | null,
) {
  const guarded = structuredClone(messages);
  const records: GuardRecord[] = [];
  for (let i = startIndex; i < guarded.length; i++) {
    const message = guarded[i];
    if (message.role !== "tool") continue;
    async function inspect(original: string, citationIndex: number | null) {
      const started = performance.now();
      const assessment = score ? await score(original) : null;
      if (
        score &&
        (!assessment || assessment.status !== "scored" || !assessment.result)
      )
        throw Error(
          "Detector unavailable; agent step stopped before inference.",
        );
      const blocked = assessment?.label === "injection";
      records.push({
        messageIndex: i,
        citationIndex,
        original,
        delivered: blocked ? withheldText : original,
        blocked,
        assessment,
        wallMs: score ? performance.now() - started : 0,
      });
      return !blocked;
    }
    if (["search_catalog", "read_document"].includes(message.tool_name ?? "")) {
      if (!(await inspect(message.content, null)))
        message.content = withheldText;
    } else if (message.tool_name === "search_documents") {
      let payload;
      try {
        payload = JSON.parse(message.content);
      } catch {
        continue;
      }
      if (!Array.isArray(payload.citations)) continue;
      const kept = [];
      for (let j = 0; j < payload.citations.length; j++) {
        const citation = payload.citations[j];
        if (typeof citation.text !== "string")
          throw Error("Invalid retrieval evidence");
        if (await inspect(citation.text, j)) kept.push(citation);
      }
      if (kept.length !== payload.citations.length)
        message.content = JSON.stringify({
          ...payload,
          citations: kept,
          ...(kept.length
            ? {}
            : { status: "no_evidence", message: withheldText }),
        });
    }
  }
  return { messages: guarded, records };
}
export function configuredScorer(
  url: string,
  detector = detectThreat,
): ScoreText {
  return (text) => detector(url, text, "tool");
}
