import { z } from "zod";
import {
  allRoles,
  admins,
  operators,
  requireRole,
  newOrg,
  createSession,
  review,
  suite,
  digest,
  judge,
  applyReply,
  trace,
  Fault,
  type Org,
  type Session,
  type ModelReply,
} from "./domain.ts";
import { OrgStore } from "./store.ts";
import { validateConfig, chat, type ModelConfig } from "./ollama.ts";

const id = z.string().uuid();
const role = z.enum(["admin", "operator", "reviewer", "viewer"]);
const policy = z
  .object({
    allowedTools: z
      .array(
        z.enum([
          "search_catalog",
          "read_document",
          "send_email",
          "delete_record",
        ]),
      )
      .max(4),
    allowedHosts: z
      .array(
        z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
      )
      .max(10),
    requireApproval: z.boolean(),
    blockSensitive: z.boolean(),
  })
  .strict();
export const commandSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("create"),
      name: z.string().trim().min(2).max(80),
    })
    .strict(),
  z
    .object({
      operation: z.literal("run"),
      orgId: id,
      prompt: z.string().trim().min(3).max(3000),
      mode: z.enum(["unprotected", "prompt-only", "gateway"]),
    })
    .strict(),
  z.object({ operation: z.literal("step"), orgId: id, sessionId: id }).strict(),
  z
    .object({
      operation: z.literal("review"),
      orgId: id,
      sessionId: id,
      proposalId: id,
      allow: z.boolean(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("policy"),
      orgId: id,
      policy,
      twoPerson: z.boolean(),
    })
    .strict(),
  z
    .object({ operation: z.literal("replay"), orgId: id, sessionId: id })
    .strict(),
  z
    .object({ operation: z.literal("rerun"), orgId: id, sessionId: id })
    .strict(),
  z
    .object({
      operation: z.literal("benchmark"),
      orgId: id,
      split: z.enum(["development", "holdout"]),
      trials: z.number().int().min(1).max(3),
    })
    .strict(),
  z
    .object({
      operation: z.literal("invite"),
      orgId: id,
      email: z.string().email().max(200),
      role,
    })
    .strict(),
  z
    .object({
      operation: z.literal("accept"),
      orgId: id,
      token: z.string().min(30).max(100),
    })
    .strict(),
  z
    .object({
      operation: z.literal("member"),
      orgId: id,
      userId: z.string().min(1).max(200),
      role: role.nullable(),
    })
    .strict(),
]);
type Identity = { userId: string; email: string };
function sessionFor(org: Org, sessionId: string): Session {
  const session = org.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Fault(404, "Run not found in this organization.");
  return session;
}
export class Platform {
  private store: OrgStore;
  private config: ModelConfig;
  private model: (
    config: ModelConfig,
    messages: Session["messages"],
  ) => Promise<ModelReply>;
  constructor(
    store: OrgStore,
    config: ModelConfig,
    model: (
      config: ModelConfig,
      messages: Session["messages"],
    ) => Promise<ModelReply> = chat,
  ) {
    this.store = store;
    this.config = config;
    this.model = model;
  }
  async command(raw: unknown, user: Identity) {
    const parsed = commandSchema.safeParse(raw);
    if (!parsed.success)
      throw new Fault(
        400,
        "Invalid request. Check required fields and allowed values.",
      );
    const command = parsed.data;
    if (command.operation === "create") {
      if ((await this.store.list(user.userId)).length >= 20)
        throw new Fault(409, "Organization limit reached.");
      const org = newOrg(
        crypto.randomUUID(),
        command.name,
        user.userId,
        user.email,
      );
      await this.store.create(org, user.userId);
      return { orgId: org.id };
    }
    if (command.operation === "accept") {
      return this.store.mutate(
        command.orgId,
        user.userId,
        "invite.accepted",
        user.userId,
        async (org) => {
          const hash = await digest(command.token);
          const invite = org.invites.find(
            (i) =>
              i.hash === hash &&
              !i.used &&
              i.email === user.email.toLowerCase() &&
              new Date(i.expiresAt).getTime() > Date.now(),
          );
          if (!invite)
            throw new Fault(
              403,
              "Invite is invalid, expired, already used, or belongs to another email.",
            );
          if (org.members.some((m) => m.userId === user.userId))
            throw new Fault(409, "You are already a member.");
          if (org.members.length >= 30)
            throw new Fault(409, "Organization member limit reached.");
          org.members.push({
            userId: user.userId,
            email: user.email,
            role: invite.role,
          });
          invite.used = true;
          return { orgId: org.id };
        },
      );
    }
    const { org } = await this.store.read(command.orgId, user.userId);
    if (command.operation === "replay") {
      requireRole(org, user.userId, allRoles);
      const session = sessionFor(org, command.sessionId);
      return {
        replay: {
          sourceId: session.id,
          originalPolicyVersion: session.policyVersion,
          currentPolicyVersion: org.policyVersion,
          mode: "policy-only; no model or side effects",
          decisions: session.proposals.map((p) => ({
            proposalId: p.id,
            original: p.decision,
            current: p.action
              ? judge(p.action, org.policy)
              : { decision: "deny", reason: "Invalid action" },
          })),
        },
      };
    }
    if (command.operation === "step")
      return this.step(command.orgId, command.sessionId, user);
    if (["run", "rerun", "benchmark"].includes(command.operation))
      validateConfig(this.config);
    return this.store.mutate(
      command.orgId,
      user.userId,
      command.operation,
      "sessionId" in command ? command.sessionId : command.orgId,
      async (current) => {
        switch (command.operation) {
          case "run":
            requireRole(current, user.userId, operators);
            return {
              sessionId: createSession(
                current,
                user.userId,
                command.prompt,
                command.mode,
              ).id,
            };
          case "rerun": {
            requireRole(current, user.userId, operators);
            const source = sessionFor(current, command.sessionId);
            return {
              sessionId: createSession(
                current,
                user.userId,
                source.prompt,
                source.mode,
                { parentId: source.id, caseId: source.caseId },
              ).id,
            };
          }
          case "review":
            await review(
              current,
              sessionFor(current, command.sessionId),
              command.proposalId,
              user.userId,
              command.allow,
            );
            return { reviewed: true };
          case "policy":
            requireRole(current, user.userId, admins);
            current.policy = command.policy;
            current.policyVersion++;
            current.twoPerson = command.twoPerson;
            return { policyVersion: current.policyVersion };
          case "benchmark": {
            requireRole(current, user.userId, operators);
            const batchId = crypto.randomUUID();
            const cases = suite.filter((c) => c.split === command.split);
            current.batches.push({
              id: batchId,
              at: new Date().toISOString(),
              suiteHash: await digest(suite),
              split: command.split,
              trials: command.trials,
            });
            for (let trial = 0; trial < command.trials; trial++) {
              for (const test of cases)
                for (const mode of [
                  "unprotected",
                  "prompt-only",
                  "gateway",
                ] as const) {
                  createSession(current, user.userId, test.prompt, mode, {
                    caseId: test.id,
                    batchId,
                  });
                }
            }
            return { batchId };
          }
          case "invite": {
            requireRole(current, user.userId, admins);
            if (command.role === "admin")
              requireRole(current, user.userId, ["owner"]);
            if (current.invites.length >= 100 || current.members.length >= 30)
              throw new Fault(409, "Membership limit reached.");
            const token = crypto.randomUUID() + crypto.randomUUID();
            current.invites.push({
              hash: await digest(token),
              email: command.email.toLowerCase(),
              role: command.role,
              expiresAt: new Date(Date.now() + 86400_000).toISOString(),
              used: false,
            });
            return { inviteToken: token, orgId: current.id };
          }
          case "member": {
            requireRole(current, user.userId, ["owner"]);
            const member = current.members.find(
              (m) => m.userId === command.userId,
            );
            if (!member || member.role === "owner")
              throw new Fault(400, "The owner cannot be changed or removed.");
            if (command.role) member.role = command.role;
            else
              current.members = current.members.filter(
                (m) => m.userId !== command.userId,
              );
            return { updated: true };
          }
        }
      },
    );
  }
  private async step(orgId: string, sessionId: string, user: Identity) {
    validateConfig(this.config);
    const token = crypto.randomUUID();
    const leased = await this.store.mutate(
      orgId,
      user.userId,
      "model.leased",
      sessionId,
      (org) => {
        requireRole(org, user.userId, operators);
        const session = sessionFor(org, sessionId);
        if (
          session.status === "running" &&
          session.lease &&
          session.lease.expiresAt > Date.now()
        )
          throw new Fault(
            409,
            "This run already has a model step in progress.",
          );
        if (!["ready", "running"].includes(session.status))
          throw new Fault(
            409,
            "Run is complete, failed, or waiting for approval.",
          );
        if (
          session.steps >= 6 ||
          session.inputTokens + session.outputTokens >= 24000
        ) {
          session.status = "failed";
          session.error =
            "Run budget exhausted (six steps / 24,000 observed tokens).";
          delete session.lease;
          trace(session, "budget.exhausted", session.error);
          return null;
        }
        session.status = "running";
        session.lease = { token, expiresAt: Date.now() + 120_000 };
        return structuredClone(session.messages);
      },
    );
    if (!leased) return { budgetExhausted: true };
    let reply: ModelReply | undefined;
    let failure: string | undefined;
    try {
      reply = await this.model(this.config, leased);
    } catch (error) {
      failure = error instanceof Fault ? error.message : "Model step failed.";
    }
    return this.store.mutate(
      orgId,
      user.userId,
      failure ? "model.failed" : "model.completed",
      sessionId,
      async (org) => {
        // Recheck membership after an external model call: revoked operators cannot
        // commit tool effects. An owner may recover the expired lease later.
        requireRole(org, user.userId, operators);
        const session = sessionFor(org, sessionId);
        if (session.lease?.token !== token)
          throw new Fault(
            409,
            "A newer step superseded this response; it was not executed.",
          );
        delete session.lease;
        if (failure) {
          session.status = "failed";
          session.error = failure;
          trace(session, "model.error", failure);
        } else await applyReply(org, session, reply!);
        return { sessionId, status: session.status };
      },
    );
  }
}
