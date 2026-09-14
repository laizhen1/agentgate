import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database } from "@/lib/storage";
import { OrgStore } from "@/lib/platform/store";
import { Platform } from "@/lib/platform/service";
import {
  businessMetrics,
  ensureOrgDefaults,
  Fault,
  metrics,
  verifyAudit,
} from "@/lib/platform/domain";
import { toOtlp } from "@/lib/platform/telemetry";
const headers = { "Cache-Control": "no-store" };
function configuration() {
  const vars = env as unknown as Record<string, string | undefined>;
  return {
    url: vars.AGENTGATE_OLLAMA_URL ?? "http://127.0.0.1:11434",
    model: vars.AGENTGATE_OLLAMA_MODEL ?? "",
  };
}
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Fault
          ? error.message
          : "Platform storage is unavailable. Check migrations and retry.",
    },
    { status: error instanceof Fault ? error.status : 503, headers },
  );
}
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: "Sign in to access AgentGate." },
      { status: 401, headers },
    );
  try {
    const store = new OrgStore(database());
    const orgId = new URL(request.url).searchParams.get("orgId");
    const organizations = await store.list(user.userId);
    const model = configuration();
    if (!orgId)
      return Response.json(
        {
          organizations,
          userId: user.userId,
          model: {
            configured: !!model.model,
            name: model.model,
            provider: "Local Ollama",
          },
        },
        { headers },
      );
    const { org, revision } = await store.read(orgId, user.userId);
    const integrity = await verifyAudit(org);
    const sessionId = new URL(request.url).searchParams.get("sessionId");
    if (new URL(request.url).searchParams.get("export") === "otlp") {
      const session = org.sessions.find((item) => item.id === sessionId);
      if (!session) throw new Fault(404, "Run not found.");
      return Response.json(toOtlp(session), { headers });
    }
    const presented = structuredClone(org);
    ensureOrgDefaults(presented);
    return Response.json(
      {
        organizations,
        userId: user.userId,
        org: presented,
        revision,
        integrity,
        metrics: metrics(org.sessions.filter((s) => !!s.batchId)),
        businessMetrics: businessMetrics(presented),
        model: {
          configured: !!model.model,
          name: model.model,
          provider: "Local Ollama",
        },
      },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: "Sign in to access AgentGate." },
      { status: 401, headers },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json(
      { error: "Same-origin request required." },
      { status: 403, headers },
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return Response.json({ error: "JSON required." }, { status: 415, headers });
  try {
    const raw = await request.text();
    if (raw.length > 12000) throw new Fault(413, "Request too large.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Fault(400, "Invalid JSON.");
    }
    const result = await new Platform(
      new OrgStore(database()),
      configuration(),
    ).command(body, user);
    return Response.json(result ?? {}, { headers });
  } catch (error) {
    return failure(error);
  }
}
