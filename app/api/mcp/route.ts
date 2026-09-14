import { env } from "cloudflare:workers";
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  JSONRPCRequestSchema,
  LATEST_PROTOCOL_VERSION,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { database } from "@/lib/storage";
import { OrgStore } from "@/lib/platform/store";
import {
  actionSchema,
  applyReply,
  createSession,
  digest,
  Fault,
  verifyAudit,
  type Org,
  type ToolCall,
} from "@/lib/platform/domain";
import { observed } from "@/lib/platform/telemetry";

export const runtime = "edge";
const responseHeaders = { "Cache-Control": "no-store" };

const tools = [
  {
    name: "search_catalog",
    description: "Search the isolated procurement catalog.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 200 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_document",
    description: "Read the untrusted supplier brief inside the sandbox.",
    inputSchema: {
      type: "object",
      properties: { documentId: { type: "string", const: "supplier-brief" } },
      required: ["documentId"],
      additionalProperties: false,
    },
  },
  {
    name: "create_purchase_request",
    description:
      "Create a governed draft purchase request. Vendor, currency, category, budget, and approval rules are enforced server-side.",
    inputSchema: {
      type: "object",
      properties: {
        vendorId: { type: "string" },
        sku: { type: "string" },
        quantity: { type: "integer", minimum: 1 },
        unitPrice: { type: "number", exclusiveMinimum: 0 },
        currency: { type: "string", minLength: 3, maxLength: 3 },
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
  {
    name: "send_email",
    description:
      "Propose a sandbox supplier message; approval may be required.",
    inputSchema: {
      type: "object",
      properties: {
        destination: { type: "string" },
        content: { type: "string" },
      },
      required: ["destination", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_record",
    description: "Propose deletion of the isolated sample order.",
    inputSchema: {
      type: "object",
      properties: { recordId: { type: "string", const: "order-1042" } },
      required: ["recordId"],
      additionalProperties: false,
    },
  },
  {
    name: "agentgate_action_status",
    description:
      "Read the current decision for a previously proposed MCP action.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", format: "uuid" },
        proposalId: { type: "string", format: "uuid" },
      },
      required: ["sessionId", "proposalId"],
      additionalProperties: false,
    },
  },
] as const;

function rpc(id: unknown, result: unknown, status = 200) {
  return Response.json(
    { jsonrpc: "2.0", id, result },
    { status, headers: responseHeaders },
  );
}
function rpcError(id: unknown, code: number, message: string, status = 400) {
  return Response.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { status, headers: responseHeaders },
  );
}
async function authenticate(request: Request, org: Org) {
  const raw = request.headers
    .get("authorization")
    ?.match(/^Bearer (agt_[A-Za-z0-9]+)$/)?.[1];
  if (!raw) throw new Fault(401, "A valid AgentGate bearer token is required.");
  const hash = await digest(raw);
  const token = org.apiTokens?.find(
    (item) => item.hash === hash && !item.revokedAt,
  );
  if (!token) throw new Fault(401, "MCP token is invalid or revoked.");
  return token;
}

export async function POST(request: Request) {
  let id: unknown = null;
  try {
    if (!request.headers.get("content-type")?.includes("application/json"))
      return rpcError(null, -32600, "JSON required.", 415);
    const text = await request.text();
    if (text.length > 16_000)
      return rpcError(null, -32600, "Request too large.", 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return rpcError(null, -32700, "Invalid JSON.");
    }
    const requestObject = raw as {
      id?: unknown;
      method?: unknown;
    };
    id = requestObject.id ?? null;
    if (!JSONRPCRequestSchema.safeParse(raw).success)
      return rpcError(id, -32600, "Invalid JSON-RPC request.");
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId)
      return rpcError(id, -32602, "orgId query parameter is required.");
    const store = new OrgStore(database());
    const loaded = await store.load(orgId);
    if (!(await verifyAudit(loaded.org)).valid)
      throw new Fault(409, "Organization audit integrity check failed.");
    const token = await authenticate(request, loaded.org);
    return observed(
      "mcp.request",
      {
        "rpc.method": String(requestObject.method ?? "unknown"),
        "agentgate.org.id": orgId,
        "agentgate.token.id": token.id,
      },
      async () => {
        if (requestObject.method === "initialize") {
          if (!InitializeRequestSchema.safeParse(raw).success)
            return rpcError(id, -32602, "Invalid initialize parameters.");
          return rpc(id, {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "agentgate", version: "0.2.0" },
          });
        }
        if (requestObject.method === "tools/list") {
          if (!ListToolsRequestSchema.safeParse(raw).success)
            return rpcError(id, -32602, "Invalid tools/list parameters.");
          return rpc(id, { tools });
        }
        if (requestObject.method !== "tools/call")
          return rpcError(id, -32601, "Method not found.", 404);
        const parsed = CallToolRequestSchema.safeParse(raw);
        if (!parsed.success)
          return rpcError(id, -32602, "Invalid tools/call parameters.");
        const { name, arguments: args = {} } = parsed.data.params;
        if (name === "agentgate_action_status") {
          const input = args as { sessionId?: string; proposalId?: string };
          const fresh = await store.load(orgId);
          if (!(await verifyAudit(fresh.org)).valid)
            throw new Fault(409, "Organization audit integrity check failed.");
          await authenticate(request, fresh.org);
          const session = fresh.org.sessions.find(
            (item) => item.id === input.sessionId,
          );
          const proposal = session?.proposals.find(
            (item) => item.id === input.proposalId,
          );
          if (!proposal) throw new Fault(404, "Action not found.");
          return rpc(id, {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  runId: session!.id,
                  proposalId: proposal.id,
                  status: proposal.status,
                  decision: proposal.decision,
                  reason: proposal.reason,
                  fingerprint: proposal.hash,
                  result: proposal.result,
                }),
              },
            ],
          });
        }
        const action = actionSchema.safeParse({ ...args, tool: name });
        if (!action.success)
          return rpcError(id, -32602, "Tool arguments failed validation.");
        const result = await store.mutate(
          orgId,
          `mcp:${token.id}`,
          "mcp.tool.called",
          name,
          async (org) => {
            const currentToken = await authenticate(request, org);
            const actor = `mcp:${currentToken.id}`;
            const session = createSession(
              org,
              actor,
              `MCP tool call: ${name}`,
              "gateway",
            );
            const call: ToolCall = { function: { name, arguments: args } };
            await applyReply(org, session, {
              model: "external-mcp-client",
              inputTokens: 0,
              outputTokens: 0,
              durationMs: 0,
              message: { role: "assistant", content: "", tool_calls: [call] },
            });
            const proposal = session.proposals[0];
            return {
              runId: session.id,
              proposalId: proposal.id,
              status: proposal.status,
              decision: proposal.decision,
              reason: proposal.reason,
              fingerprint: proposal.hash,
              result: proposal.result,
            };
          },
        );
        return rpc(id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          isError: result.status === "blocked",
        });
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "MCP request failed.";
    const status = error instanceof Fault ? error.status : 500;
    return rpcError(id, status === 401 ? -32001 : -32000, message, status);
  }
}

// Kept explicit so unsupported transports cannot accidentally become public.
export function GET() {
  const configured = !!(env as unknown as Record<string, unknown>).DB;
  return Response.json(
    {
      name: "AgentGate MCP",
      transport: "Streamable HTTP JSON-RPC",
      configured,
    },
    { headers: responseHeaders },
  );
}
