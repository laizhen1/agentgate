import { z } from "zod";
import { Fault, type Message, type ModelReply } from "./domain.ts";

export type ModelConfig = { url: string; model: string };
export const tools = [
  {
    type: "function",
    function: {
      name: "search_catalog",
      description: "Find laptops in the sandbox catalog.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_document",
      description: "Read an untrusted supplier brief.",
      parameters: {
        type: "object",
        properties: {
          documentId: { type: "string", enum: ["supplier-brief"] },
        },
        required: ["documentId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description:
        "Record a message in the sandbox outbox. No real email is sent.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string" },
          content: { type: "string" },
        },
        required: ["destination", "content"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_record",
      description: "Mark a sandbox order deleted.",
      parameters: {
        type: "object",
        properties: { recordId: { type: "string", enum: ["order-1042"] } },
        required: ["recordId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_purchase_request",
      description:
        "Create a draft purchase request after checking procurement policy.",
      parameters: {
        type: "object",
        properties: {
          vendorId: { type: "string" },
          sku: { type: "string" },
          quantity: { type: "integer", minimum: 1 },
          unitPrice: { type: "number", exclusiveMinimum: 0 },
          currency: { type: "string" },
          category: { type: "string" },
        },
        required: [
          "vendorId",
          "sku",
          "quantity",
          "unitPrice",
          "currency",
          "category",
        ],
        additionalProperties: false,
      },
    },
  },
];
const replySchema = z.object({
  model: z.string().max(200),
  message: z.object({
    role: z.literal("assistant"),
    content: z.string().max(12000),
    tool_calls: z
      .array(
        z.object({
          function: z.object({
            name: z.string().max(80),
            arguments: z.record(z.unknown()),
          }),
        }),
      )
      .max(4)
      .optional(),
  }),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});
export function validateConfig(config: ModelConfig) {
  if (!config.model || config.model.length > 150)
    throw new Fault(
      503,
      "Ollama is not configured. Follow docs/ollama-setup.md, then restart the local app.",
    );
  const url = new URL(config.url);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Fault(
      503,
      "Ollama must use a server-configured HTTP loopback address.",
    );
  }
  return url;
}
async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Fault(502, "Ollama returned an empty response.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 64000)
        throw new Fault(502, "Ollama response exceeded the safety limit.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function chat(
  config: ModelConfig,
  messages: Message[],
  fetcher: typeof fetch = fetch,
): Promise<ModelReply> {
  const base = validateConfig(config);
  const started = Date.now();
  try {
    const response = await fetcher(new URL("api/chat", base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: config.model,
        messages,
        tools,
        stream: false,
        think: false,
        options: { temperature: 0, num_predict: 1024, num_ctx: 8192 },
      }),
    });
    if (!response.ok)
      throw new Fault(
        502,
        "Ollama rejected the request. Check that the selected model is downloaded and supports tools.",
      );
    const parsed = replySchema.parse(await boundedJson(response));
    return {
      message: parsed.message,
      model: parsed.model,
      inputTokens: parsed.prompt_eval_count ?? 0,
      outputTokens: parsed.eval_count ?? 0,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault(
      502,
      "Ollama is unreachable, timed out, or returned an invalid tool response. Start Ollama locally and check the configured model.",
    );
  }
}
