import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { database, decodeAgent, getState } from "@/lib/storage";
import { runReference, defaultPolicy } from "@/lib/security";
const policy = z
  .object({
    allowedTools: z
      .array(
        z.enum(["search_catalog", "send_email", "delete_record", "run_shell"]),
      )
      .max(4),
    allowedHosts: z
      .array(
        z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
      )
      .max(20),
    requireApproval: z.boolean(),
    blockSensitive: z.boolean(),
  })
  .strict();
const input = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("register"),
    name: z.string().trim().min(2).max(80),
    version: z.string().trim().min(1).max(30),
    description: z.string().trim().max(500),
    policy,
  }),
  z.object({ operation: z.literal("run"), agentId: z.string().uuid() }),
  z.object({ operation: z.literal("seed") }),
]);
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: "Sign in to access your workbench." },
      { status: 401, headers },
    );
  try {
    return Response.json(await getState(user.userId), { headers });
  } catch (error) {
    console.error("Workspace read failed", error);
    return Response.json(
      { error: "Workspace storage is unavailable. Please retry." },
      { status: 503, headers },
    );
  }
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user)
    return Response.json(
      { error: "Sign in to access your workbench." },
      { status: 401, headers },
    );
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json(
      { error: "Same-origin request required." },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.includes("application/json"))
    return Response.json({ error: "JSON required." }, { status: 415 });
  const raw = await request.text();
  if (raw.length > 16000)
    return Response.json({ error: "Request too large." }, { status: 413 });
  let data;
  try {
    data = input.parse(JSON.parse(raw));
  } catch {
    return Response.json(
      { error: "Check the agent name, version, and policy fields." },
      { status: 400 },
    );
  }
  try {
    const db = database();
    if (data.operation === "register") {
      await db
        .prepare(
          "INSERT INTO agents (id,owner_id,name,version,description,policy,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          user.userId,
          data.name,
          data.version,
          data.description,
          JSON.stringify(data.policy),
          new Date().toISOString(),
        )
        .run();
    } else if (data.operation === "seed") {
      const now = new Date().toISOString();
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(user.userId),
      );
      const hex = Array.from(new Uint8Array(digest))
        .slice(0, 16)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const prefix = hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-4000-8000-";
      await db.batch([
        db
          .prepare(
            "INSERT OR IGNORE INTO agents (id,owner_id,name,version,description,policy,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            prefix + "000000000001",
            user.userId,
            "Purchasing assistant",
            "0.1-baseline",
            "Reference agent with permissive controls. Reproduce failures before hardening.",
            JSON.stringify({
              ...defaultPolicy,
              allowedTools: [...defaultPolicy.allowedTools, "run_shell"],
              requireApproval: false,
              blockSensitive: false,
            }),
            now,
          ),
        db
          .prepare(
            "INSERT OR IGNORE INTO agents (id,owner_id,name,version,description,policy,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(
            prefix + "000000000002",
            user.userId,
            "Purchasing assistant",
            "0.2-hardened",
            "Reference agent with tool restrictions, destination checks, sensitive-data checks, and approval gates.",
            JSON.stringify(defaultPolicy),
            now,
          ),
      ]);
    } else {
      const row = await db
        .prepare("SELECT * FROM agents WHERE id=? AND owner_id=?")
        .bind(data.agentId, user.userId)
        .first();
      if (!row)
        return Response.json({ error: "Agent not found." }, { status: 404 });
      const run = runReference(decodeAgent(row));
      await db
        .prepare(
          "INSERT INTO runs (id,owner_id,agent_id,created_at,report) VALUES (?,?,?,?,?)",
        )
        .bind(
          run.id,
          user.userId,
          run.agentId,
          run.createdAt,
          JSON.stringify(run),
        )
        .run();
      return Response.json(
        { run, ...(await getState(user.userId)) },
        { headers },
      );
    }
    return Response.json(await getState(user.userId), { headers });
  } catch (error) {
    console.error("Workspace operation failed", error);
    return Response.json(
      {
        error:
          "The operation could not be saved. Your input is preserved; please retry.",
      },
      { status: 503, headers },
    );
  }
}
