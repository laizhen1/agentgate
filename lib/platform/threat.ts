import { z } from "zod";
const resultSchema = z
  .object({
    model: z.string().min(1).max(200),
    revision: z.string().min(1).max(200),
    score: z.number().finite().min(0).max(1),
    windows: z.number().int().min(1).max(64),
    durationMs: z.number().finite().nonnegative(),
  })
  .strict();
export type ThreatAssessment = {
  id: string;
  at: string;
  source: "lab" | "user" | "tool";
  text: string;
  status: "scored" | "unavailable";
  label?: "injection" | "benign";
  threshold: number;
  result?: z.infer<typeof resultSchema>;
  error?: string;
};
export async function detectThreat(
  url: string | undefined,
  text: string,
  source: ThreatAssessment["source"],
  fetcher: typeof fetch = fetch,
): Promise<ThreatAssessment> {
  const assessment: ThreatAssessment = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    source,
    text,
    threshold: 0.5,
    status: "unavailable",
  };
  if (!url)
    return {
      ...assessment,
      error: "Detector is not configured. Follow docs/threat-detection.md.",
    };
  try {
    const base = new URL(url);
    if (
      base.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname) ||
      base.username ||
      base.password ||
      base.pathname !== "/" ||
      base.search ||
      base.hash
    )
      throw Error("Invalid detector address");
    if (!text.trim() || text.length > 6000) throw Error("Invalid input size");
    const response = await fetcher(new URL("detect", base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw Error("Detector rejected request");
    const reader = response.body?.getReader();
    if (!reader) throw Error("Empty response");
    let raw = "",
      length = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 4096) throw Error("Oversized response");
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel();
    }
    const result = resultSchema.parse(JSON.parse(raw));
    return {
      ...assessment,
      status: "scored",
      label: result.score >= assessment.threshold ? "injection" : "benign",
      result,
    };
  } catch {
    return {
      ...assessment,
      error:
        "Detector unavailable, timed out, or returned invalid data. No threat score was produced.",
    };
  }
}
