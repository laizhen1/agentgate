import type { Message, ModelReply } from "../platform/domain.ts";
import { tools, validateConfig } from "../platform/ollama.ts";
import { protocol } from "./protocol.ts";

// Identical neutral tool descriptions in every arm; the defense varies only in the system prompt/enforcement.
export const benchmarkTools = tools.map((tool) => ({
  ...tool,
  function: {
    ...tool.function,
    description:
      tool.function.name === "search_documents"
        ? "Search organization knowledge and return passages with citation IDs."
        : tool.function.name === "create_purchase_request"
          ? "Create a draft purchase request in the sandbox."
          : tool.function.name === "read_document"
            ? "Read the supplier brief document by ID."
            : tool.function.description,
  },
}));
export type InferenceTrace = {
  request: unknown;
  response: unknown;
  wallMs: number;
};
export async function infer(
  url: string,
  model: string,
  messages: Message[],
  remainingMs: number,
): Promise<{ reply: ModelReply; trace: InferenceTrace }> {
  const base = validateConfig({ url, model });
  const request = {
    model,
    messages: structuredClone(messages),
    tools: benchmarkTools,
    stream: false,
    ...(model.startsWith("qwen3:") ? { think: false } : {}),
    keep_alive: "10m",
    options: {
      temperature: protocol.temperature,
      seed: protocol.seed,
      num_ctx: protocol.contextTokens,
      num_predict: protocol.maxOutputTokens,
    },
  };
  const started = Date.now();
  const response = await fetch(new URL("api/chat", base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(
      Math.max(1, Math.min(remainingMs, protocol.requestTimeoutMs)),
    ),
    body: JSON.stringify(request),
  });
  if (!response.ok) throw Error(`Inference HTTP ${response.status}`);
  const raw = await response.text();
  if (raw.length > 128000)
    throw Error("Inference response exceeded 128000 characters");
  const data = JSON.parse(raw);
  if (
    data.done !== true ||
    data.message?.role !== "assistant" ||
    typeof data.message.content !== "string" ||
    (data.message.tool_calls !== undefined &&
      (!Array.isArray(data.message.tool_calls) ||
        data.message.tool_calls.length > 8 ||
        data.message.tool_calls.some(
          (call: { function?: { name?: unknown; arguments?: unknown } }) =>
            !call.function ||
            typeof call.function.name !== "string" ||
            !call.function.arguments ||
            typeof call.function.arguments !== "object" ||
            Array.isArray(call.function.arguments),
        )))
  )
    throw Error("Malformed native tool response");
  const wallMs = Date.now() - started;
  return {
    reply: {
      message: data.message,
      model: data.model,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      durationMs: wallMs,
    },
    trace: { request, response: data, wallMs },
  };
}
