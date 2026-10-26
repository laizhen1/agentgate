"use client";
import { WorkspaceShell } from "@/components/workspace-shell";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ThreatLab } from "./threat-lab";
import { DocumentLab } from "./document-lab";
import {
  ShieldCheck,
  Play,
  Download,
  RefreshCw,
  Square,
  ArrowLeft,
  Activity,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  metrics,
  suite,
  type GovernancePolicy,
  type Mode,
  type Org,
} from "@/lib/platform/domain";
import type { Policy } from "@/lib/security";

type State = {
  organizations: { id: string; name: string }[];
  userId: string;
  org?: Org;
  revision?: number;
  integrity?: { valid: boolean; checked: number; head: string };
  businessMetrics?: {
    safeAutomationRate: number;
    preventedViolations: number;
    governedSpend: number;
    draftPurchaseRequests: number;
    averageApprovalMinutes: number | null;
  };
  model: { configured: boolean; name: string };
};
type Result = {
  orgId?: string;
  sessionId?: string;
  batchId?: string;
  inviteToken?: string;
  token?: string;
  tokenId?: string;
  prefix?: string;
  replay?: unknown;
};
async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: T & { error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw Error(
      "Server returned an unexpected response. Check that you are signed in and the database migrations are applied.",
    );
  }
  if (!response.ok) throw Error(data.error ?? "Request failed.");
  return data;
}
function Choice({
  value,
  onChange,
  values,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  values: { value: string; label: string }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {values.map((v) => (
          <SelectItem key={v.value} value={v.value}>
            {v.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="check-row">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <label htmlFor={id}>{children}</label>
    </div>
  );
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const roleValues = ["admin", "operator", "reviewer", "viewer"].map((value) => ({
  value,
  label: value,
}));
export default function PlatformPage() {
  const [data, setData] = useState<State | null>(null),
    [orgId, setOrgId] = useState(""),
    [selected, setSelected] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("runs");
  const [name, setName] = useState("Purchasing security lab"),
    [prompt, setPrompt] = useState(
      "Search the catalog for a laptop and report its price.",
    ),
    [mode, setMode] = useState<Mode>("gateway");
  const [policy, setPolicy] = useState<Policy | null>(null),
    [governance, setGovernance] = useState<GovernancePolicy | null>(null),
    [twoPerson, setTwoPerson] = useState(false),
    [mcpSecret, setMcpSecret] = useState("");
  const [split, setSplit] = useState("development"),
    [trials, setTrials] = useState("1"),
    [batch, setBatch] = useState("");
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("viewer"),
    [invite, setInvite] = useState("");
  const [joinOrg, setJoinOrg] = useState(""),
    [joinToken, setJoinToken] = useState(""),
    [replay, setReplay] = useState<unknown>(null);
  const paused = useRef(false);
  const refresh = useCallback(
    async (id = orgId) => {
      const value = await json<State>(
        await fetch(
          "/api/platform" + (id ? "?orgId=" + encodeURIComponent(id) : ""),
        ),
      );
      setData(value);
      if (id && id !== orgId) setMcpSecret("");
      if (value.org) {
        setPolicy(structuredClone(value.org.policy));
        setGovernance(structuredClone(value.org.governance ?? null));
        setTwoPerson(value.org.twoPerson);
      }
      if (!id && value.organizations.length)
        setOrgId(value.organizations[0].id);
      return value;
    },
    [orgId],
  );
  useEffect(() => {
    const timer = setTimeout(
      () => void refresh().catch((e) => setError(e.message)),
      0,
    );
    return () => clearTimeout(timer);
  }, [refresh]);
  const org = data?.org;
  const member = org?.members.find((m) => m.userId === data?.userId);
  const canRun = ["owner", "admin", "operator"].includes(member?.role ?? "");
  const canReview = ["owner", "admin", "reviewer"].includes(member?.role ?? "");
  const canAdmin = ["owner", "admin"].includes(member?.role ?? "");
  const session = org?.sessions.find((s) => s.id === selected);
  const pending =
    org?.sessions.flatMap((s) =>
      s.proposals
        .filter((p) => p.status === "pending")
        .map((p) => ({ session: s, proposal: p })),
    ) ?? [];
  const post = async (body: object) =>
    json<Result>(
      await fetch("/api/platform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    paused.current = false;
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }
  async function drive(id: string, target?: string, batchId?: string) {
    for (;;) {
      const state = await refresh(id);
      if (paused.current) return;
      const next = state.org?.sessions.find(
        (s) =>
          (target ? s.id === target : !batchId || s.batchId === batchId) &&
          (s.status === "ready" ||
            (s.status === "running" &&
              (s.lease?.expiresAt ?? 0) <= Date.now())),
      );
      if (!next) return;
      setSelected(next.id);
      await post({ operation: "step", orgId: id, sessionId: next.id });
    }
  }
  async function simple(body: object) {
    await post(body);
    await refresh();
  }
  const scores = metrics(
    org?.sessions.filter(
      (s) => !!s.batchId && (!batch || s.batchId === batch),
    ) ?? [],
  );
  return (
    <WorkspaceShell active="live">
      <header className="topbar">
        <div className="brand">
          <ShieldCheck />
          <strong>Workspace</strong>
          <span>Live evaluation</span>
        </div>
        <Link className="secondary" href="/">
          <ArrowLeft size={16} />
          Reference lab
        </Link>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">AGENT OPERATIONS</p>
          <h1>Live workspace</h1>
          <p>
            Run procurement tasks, review tool calls, and inspect execution
            evidence.
          </p>
        </div>
        <div className="actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void task(async () => {
                await refresh();
              })
            }
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          {busy && (
            <button
              className="secondary"
              onClick={() => {
                paused.current = true;
              }}
            >
              {" "}
              <Square size={16} />
              Pause after this step
            </button>
          )}
        </div>
      </section>
      <div className="notice">
        <Activity size={20} />
        <div>
          {data?.model.configured ? (
            <>
              Ollama configured: <strong>{data.model.name}</strong>.
              Availability is checked on each live step.
            </>
          ) : (
            <>
              Ollama is not configured here. Run this project locally and follow{" "}
              <code>docs/ollama-setup.md</code>. The hosted site cannot access
              your laptop.
            </>
          )}
          <br />
          All tools use isolated test data. “Send email” writes to a sandbox
          outbox; it never sends email. No live results are fabricated.
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error} <a href="/signin-with-chatgpt?return_to=/platform">Sign in</a>
        </div>
      )}
      {!data && !error && <p className="empty">Loading your workspaces…</p>}
      {data && (
        <div className="panel platform-toolbar">
          <label className="field">
            Organization
            <Choice
              label="Organization"
              disabled={busy}
              value={orgId}
              onChange={(v) => {
                setSelected("");
                setOrgId(v);
              }}
              values={data.organizations.map((o) => ({
                value: o.id,
                label: o.name,
              }))}
            />
          </label>
          <label className="field">
            New organization
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </label>
          <button
            className="secondary"
            disabled={busy || name.trim().length < 2}
            onClick={() =>
              void task(async () => {
                const r = await post({ operation: "create", name });
                setOrgId(r.orgId!);
                await refresh(r.orgId);
              })
            }
          >
            Create lab
          </button>
          {member && (
            <span className="badge">
              {member.role} · policy v{org?.policyVersion}
            </span>
          )}
        </div>
      )}
      {org && (
        <>
          <div className="stats">
            <div className="stat">
              <span>Live model runs</span>
              <strong>{org.sessions.length}</strong>
              <small>Includes queued and failed runs</small>
            </div>
            <div className="stat">
              <span>Awaiting human review</span>
              <strong>{pending.length}</strong>
              <small>Action-bound, 15-minute expiry</small>
            </div>
            <div className="stat">
              <span>Audit chain</span>
              <strong>{data?.integrity?.valid ? "Verified" : "Invalid"}</strong>
              <small>
                {data?.integrity?.checked} entries · revision {data?.revision}
              </small>
            </div>
            <div className="stat">
              <span>Safe automation rate</span>
              <strong>{data?.businessMetrics?.safeAutomationRate ?? 0}%</strong>
              <small>
                {data?.businessMetrics?.preventedViolations ?? 0} policy
                violations prevented
              </small>
            </div>
            <div className="stat">
              <span>Governed sandbox spend</span>
              <strong>
                ${(data?.businessMetrics?.governedSpend ?? 0).toLocaleString()}
              </strong>
              <small>
                {data?.businessMetrics?.draftPurchaseRequests ?? 0} draft
                purchase requests
              </small>
            </div>
          </div>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList variant="line" className="platform-tabs">
              <TabsTrigger value="runs">Agent runs</TabsTrigger>
              <TabsTrigger value="approvals">
                Approvals ({pending.length})
              </TabsTrigger>
              <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
              <TabsTrigger value="threats">Threat detection</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="policy">Policy & team</TabsTrigger>
              <TabsTrigger value="audit">Audit & export</TabsTrigger>
            </TabsList>
            <TabsContent value="documents">
              <DocumentLab
                key={org.id}
                org={org}
                disabled={busy}
                canAdmin={canAdmin}
                canRun={canRun}
                command={async (body) => {
                  const result = await post(body);
                  await refresh();
                  return result;
                }}
              />
            </TabsContent>
            <TabsContent value="threats">
              <ThreatLab
                key={org.id}
                org={org}
                disabled={busy || !canRun}
                scan={(text) =>
                  task(() =>
                    simple({ operation: "detectThreat", orgId: org.id, text }),
                  )
                }
              />
            </TabsContent>
            <TabsContent value="runs">
              <div className="grid">
                <aside className="panel">
                  <h2>Launch a live task</h2>
                  <label className="field">
                    Task
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      maxLength={3000}
                    />
                  </label>
                  <label className="field">
                    Protection mode
                    <Choice
                      label="Protection mode"
                      value={mode}
                      onChange={(v) => setMode(v as Mode)}
                      values={[
                        { value: "gateway", label: "Enforced gateway" },
                        { value: "prompt-only", label: "Prompt-only baseline" },
                        { value: "unprotected", label: "Unprotected baseline" },
                      ]}
                    />
                  </label>
                  <p className="muted">
                    Baseline modes deliberately disable policy enforcement, but
                    cannot escape the sandbox.
                  </p>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !canRun ||
                      !data?.model.configured ||
                      prompt.trim().length < 3
                    }
                    onClick={() =>
                      void task(async () => {
                        const r = await post({
                          operation: "run",
                          orgId,
                          prompt,
                          mode,
                        });
                        setSelected(r.sessionId!);
                        await drive(orgId, r.sessionId);
                      })
                    }
                  >
                    <Play size={16} />
                    Run with Ollama
                  </button>
                  <h3 className="platform-subhead">Saved runs</h3>
                  <div className="platform-run-list">
                    {[...org.sessions].reverse().map((s) => (
                      <button
                        key={s.id}
                        className={
                          "agent-button " +
                          (s.id === selected ? "selected" : "")
                        }
                        onClick={() => {
                          setSelected(s.id);
                          setReplay(null);
                        }}
                      >
                        <strong>
                          {s.caseId ? s.caseId + " · " : ""}
                          {s.prompt.slice(0, 65)}
                        </strong>
                        <small>
                          {s.mode} · {s.status} · {s.steps} steps
                        </small>
                      </button>
                    ))}
                    {!org.sessions.length && (
                      <p className="muted">
                        Your first live run will appear here.
                      </p>
                    )}
                  </div>
                </aside>
                <section className="panel">
                  {!session ? (
                    <div className="empty execution-empty">
                      <div className="empty-icon">
                        <Activity size={28} />
                      </div>
                      <p className="eyebrow">EXECUTION INSPECTOR</p>
                      <h2>Your next run starts here</h2>
                      <p>
                        Launch a task or select a saved run to inspect the model
                        conversation, tool decisions, and execution trace.
                      </p>
                      <div
                        className="execution-stages"
                        aria-label="Execution stages"
                      >
                        <span>01 · Model</span>
                        <span>02 · Tools</span>
                        <span>03 · Evidence</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="section-head">
                        <h2>Execution evidence</h2>
                        <span
                          className={
                            "badge " +
                            (session.status === "failed" ? "bad" : "")
                          }
                        >
                          {session.status}
                        </span>
                      </div>
                      <p>{session.prompt}</p>
                      <p className="muted">
                        {session.model ?? "Model not called yet"} ·{" "}
                        {session.mode} · policy v{session.policyVersion} ·{" "}
                        {session.inputTokens + session.outputTokens} observed
                        tokens
                        {session.parentId
                          ? " · rerun of " + session.parentId
                          : ""}
                      </p>
                      <div className="actions">
                        <button
                          className="primary"
                          disabled={
                            busy ||
                            !canRun ||
                            !data?.model.configured ||
                            !["ready", "running"].includes(session.status)
                          }
                          onClick={() =>
                            void task(() => drive(orgId, session.id))
                          }
                        >
                          Resume
                        </button>
                        <button
                          className="secondary"
                          disabled={busy || !canRun || !data?.model.configured}
                          onClick={() =>
                            void task(async () => {
                              const r = await post({
                                operation: "rerun",
                                orgId,
                                sessionId: session.id,
                              });
                              await drive(orgId, r.sessionId);
                            })
                          }
                        >
                          Rerun model
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void task(async () => {
                              const r = await post({
                                operation: "replay",
                                orgId,
                                sessionId: session.id,
                              });
                              setReplay(r.replay);
                            })
                          }
                        >
                          Replay current policy
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            download(
                              "agentgate-run-" + session.id + ".json",
                              session,
                            )
                          }
                        >
                          <Download size={16} />
                          Export
                        </button>
                      </div>
                      {session.error && (
                        <div className="error">{session.error}</div>
                      )}
                      {replay != null && (
                        <div className="evidence">
                          <h3>Counterfactual policy replay</h3>
                          <p>No model calls or tools were executed.</p>
                          <pre>{JSON.stringify(replay, null, 2)}</pre>
                        </div>
                      )}
                      <h3 className="platform-subhead">Tool gateway</h3>
                      {session.proposals.map((p) => (
                        <div className="evidence" key={p.id}>
                          <span
                            className={
                              "badge " +
                              (p.status === "blocked"
                                ? "bad"
                                : p.status === "pending"
                                  ? "warn"
                                  : "good")
                            }
                          >
                            {p.status}
                          </span>
                          <strong> {p.raw.function.name}</strong>
                          <p>{p.reason}</p>
                          <pre>
                            {JSON.stringify(p.action ?? p.raw, null, 2)}
                          </pre>
                          <small>Action fingerprint: {p.hash}</small>
                          {p.result && <p>{p.result}</p>}
                        </div>
                      ))}
                      <h3 className="platform-subhead">Conversation</h3>
                      {session.messages
                        .filter((m) => m.role !== "system")
                        .map((m, i) => (
                          <details
                            className="evidence"
                            key={i}
                            open={m.role === "assistant"}
                          >
                            <summary>
                              {m.role}
                              {m.tool_name ? " · " + m.tool_name : ""}
                            </summary>
                            <pre>{m.content || "[Tool call]"}</pre>
                          </details>
                        ))}
                      <details className="evidence">
                        <summary>Sandbox state</summary>
                        <pre>{JSON.stringify(session.sandbox, null, 2)}</pre>
                      </details>
                      <h3 className="platform-subhead">Execution trace</h3>
                      <button
                        className="secondary"
                        onClick={() =>
                          void task(async () => {
                            const exported = await json<unknown>(
                              await fetch(
                                `/api/platform?orgId=${encodeURIComponent(
                                  org.id,
                                )}&sessionId=${encodeURIComponent(
                                  session.id,
                                )}&export=otlp`,
                              ),
                            );
                            download(
                              `agentgate-trace-${session.id}.otlp.json`,
                              exported,
                            );
                          })
                        }
                      >
                        <Download size={16} />
                        Export OTLP trace
                      </button>
                      {session.traces.map((t) => (
                        <div className="platform-trace" key={t.id}>
                          <time>{new Date(t.at).toLocaleTimeString()}</time>
                          <div>
                            <strong>{t.kind}</strong>
                            <p>{t.detail}</p>
                            {t.durationMs !== undefined && (
                              <small>{t.durationMs} ms</small>
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </section>
              </div>
            </TabsContent>
            <TabsContent value="approvals">
              <section className="panel">
                <h2>Human approval inbox</h2>
                <p className="muted">
                  Review exact arguments before allowing an action. Approval is
                  consumed atomically with the sandbox effect.{" "}
                  {org.twoPerson
                    ? "Two-person separation is enforced."
                    : "Owner/operator self-review is permitted if they hold a reviewer role; enable two-person mode for separation of duties."}
                </p>
                {!pending.length && (
                  <div className="empty">No pending approvals.</div>
                )}
                {pending.map(({ session: s, proposal: p }) => (
                  <div className="evidence" key={p.id}>
                    <h3>{p.raw.function.name}</h3>
                    <p>
                      Requested by{" "}
                      {org.members.find((m) => m.userId === s.actor)?.email ??
                        s.actor}{" "}
                      · expires{" "}
                      {new Date(p.approval!.expiresAt).toLocaleString()}
                    </p>
                    <pre>{JSON.stringify(p.action, null, 2)}</pre>
                    <small>Bound fingerprint: {p.hash}</small>
                    <div className="actions">
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          !canReview ||
                          (org.twoPerson && s.actor === data?.userId)
                        }
                        onClick={() =>
                          void task(async () => {
                            await simple({
                              operation: "review",
                              orgId,
                              sessionId: s.id,
                              proposalId: p.id,
                              allow: true,
                            });
                          })
                        }
                      >
                        Approve exact action
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          !canReview ||
                          (org.twoPerson && s.actor === data?.userId)
                        }
                        onClick={() =>
                          void task(async () => {
                            await simple({
                              operation: "review",
                              orgId,
                              sessionId: s.id,
                              proposalId: p.id,
                              allow: false,
                            });
                          })
                        }
                      >
                        Reject / clear expired
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            </TabsContent>
            <TabsContent value="benchmarks">
              <section className="panel">
                <h2>Compare security and usefulness</h2>
                <p className="muted">
                  Each batch runs the same three cases in all three modes.
                  Development and holdout are separate, fixed sets—not a
                  statistically representative security certification. Pending
                  approvals are not counted as completed.
                </p>
                <div className="platform-toolbar">
                  <Choice
                    label="Dataset split"
                    value={split}
                    onChange={setSplit}
                    values={[
                      { value: "development", label: "Development set" },
                      { value: "holdout", label: "Holdout set" },
                    ]}
                  />
                  <Choice
                    label="Trials"
                    value={trials}
                    onChange={setTrials}
                    values={["1", "2", "3"].map((v) => ({
                      value: v,
                      label: v + " trial(s)",
                    }))}
                  />
                  <button
                    className="primary"
                    disabled={busy || !canRun || !data?.model.configured}
                    onClick={() =>
                      void task(async () => {
                        const r = await post({
                          operation: "benchmark",
                          orgId,
                          split,
                          trials: Number(trials),
                        });
                        setBatch(r.batchId!);
                        await drive(orgId, undefined, r.batchId);
                      })
                    }
                  >
                    Run{" "}
                    {Number(trials) *
                      suite.filter((item) => item.split === split).length *
                      3}{" "}
                    live trials
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !canRun || !data?.model.configured}
                    onClick={() =>
                      void task(() =>
                        drive(orgId, undefined, batch || undefined),
                      )
                    }
                  >
                    Resume queued runs
                  </button>
                </div>
                <label className="field">
                  Results batch
                  <Choice
                    label="Results batch"
                    value={batch || "all"}
                    onChange={(v) => setBatch(v === "all" ? "" : v)}
                    values={[
                      { value: "all", label: "All benchmark batches" },
                      ...org.batches.map((b) => ({
                        value: b.id,
                        label:
                          b.split + " · " + new Date(b.at).toLocaleString(),
                      })),
                    ]}
                  />
                </label>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        "Mode",
                        "Completed / total",
                        "Attack success ↓",
                        "Useful success ↑",
                        "Benign false blocks ↓",
                        "Errors / pending",
                        "Unsafe runs (all statuses)",
                        "p95 model time",
                      ].map((h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scores.map((s) => (
                      <TableRow key={s.mode}>
                        <TableCell>{s.mode}</TableCell>
                        <TableCell>
                          {s.completed} / {s.total}
                        </TableCell>
                        <TableCell>
                          {s.attackDenominator
                            ? s.attackSuccesses + " / " + s.attackDenominator
                            : "Not measured"}
                        </TableCell>
                        <TableCell>
                          {s.usefulDenominator
                            ? s.usefulSuccesses + " / " + s.usefulDenominator
                            : "Not measured"}
                        </TableCell>
                        <TableCell>
                          {s.benignDenominator
                            ? s.benignFalseBlocks + " / " + s.benignDenominator
                            : "Not measured"}
                        </TableCell>
                        <TableCell>
                          {s.failed} / {s.pending}
                        </TableCell>
                        <TableCell>{s.unsafeRunsIncludingIncomplete}</TableCell>
                        <TableCell>
                          {s.p95ModelLatencyMs === null
                            ? "—"
                            : s.p95ModelLatencyMs + " ms"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="muted">
                  Attack success means an unsafe sandbox action or
                  synthetic-secret output among completed attack runs. Unsafe
                  runs includes failed and unfinished runs so errors cannot hide
                  observed unsafe effects. Useful success checks
                  catalog/document access without unsafe effects, not answer
                  quality. Latency is summed model-call time per completed run.
                  Local inference has no API charge; hardware and electricity
                  are not free.
                </p>
                <button
                  className="secondary"
                  onClick={() =>
                    download("agentgate-benchmark.json", {
                      suite,
                      batches: org.batches.filter(
                        (b) => !batch || b.id === batch,
                      ),
                      metrics: scores,
                      runs: org.sessions.filter(
                        (s) => !!s.batchId && (!batch || s.batchId === batch),
                      ),
                    })
                  }
                >
                  <Download size={16} />
                  Export reproducible results
                </button>
                <details className="evidence">
                  <summary>Inspect frozen cases and assertions</summary>
                  <pre>{JSON.stringify(suite, null, 2)}</pre>
                </details>
              </section>
            </TabsContent>
            <TabsContent value="policy">
              <div className="grid">
                <section className="panel">
                  <h2>Versioned gateway policy</h2>
                  <p className="muted">
                    Changes apply to new runs. Pending approvals under an older
                    version cannot execute; reject and rerun them.
                  </p>
                  {policy && (
                    <>
                      <fieldset disabled={!canAdmin || busy}>
                        <legend>Allowed tools</legend>
                        {[
                          "search_catalog",
                          "read_document",
                          "search_documents",
                          "send_email",
                          "delete_record",
                          "create_purchase_request",
                        ].map((tool) => (
                          <Check
                            key={tool}
                            checked={policy.allowedTools.includes(tool)}
                            onChange={(v) =>
                              setPolicy({
                                ...policy,
                                allowedTools: v
                                  ? [...policy.allowedTools, tool]
                                  : policy.allowedTools.filter(
                                      (t) => t !== tool,
                                    ),
                              })
                            }
                          >
                            {tool}
                          </Check>
                        ))}
                        <label className="field">
                          Allowed hosts (comma-separated)
                          <input
                            value={policy.allowedHosts.join(",")}
                            onChange={(e) =>
                              setPolicy({
                                ...policy,
                                allowedHosts: e.target.value
                                  .split(",")
                                  .map((h) => h.trim().toLowerCase()),
                              })
                            }
                          />
                        </label>
                        <Check
                          checked={policy.requireApproval}
                          onChange={(v) =>
                            setPolicy({ ...policy, requireApproval: v })
                          }
                        >
                          Require approval for send / delete
                        </Check>
                        <Check
                          checked={policy.blockSensitive}
                          onChange={(v) =>
                            setPolicy({ ...policy, blockSensitive: v })
                          }
                        >
                          Block synthetic secrets and sensitive patterns
                        </Check>
                        <Check checked={twoPerson} onChange={setTwoPerson}>
                          Require a different human reviewer
                        </Check>
                      </fieldset>
                      <button
                        className="primary"
                        disabled={busy || !canAdmin}
                        onClick={() =>
                          void task(async () => {
                            await simple({
                              operation: "policy",
                              orgId,
                              policy,
                              twoPerson,
                            });
                          })
                        }
                      >
                        Save policy v{org.policyVersion + 1}
                      </button>
                    </>
                  )}
                </section>
                <section className="panel">
                  <h2>Procurement policy-as-code</h2>
                  <p className="muted">
                    These business controls are versioned and pinned to every
                    run. The repository includes an equivalent Rego policy for
                    OPA review and portability.
                  </p>
                  {governance && (
                    <>
                      <fieldset disabled={!canAdmin || busy}>
                        <label className="field">
                          Approved vendors (comma-separated)
                          <input
                            value={governance.approvedVendors.join(",")}
                            onChange={(event) =>
                              setGovernance({
                                ...governance,
                                approvedVendors: event.target.value
                                  .split(",")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          Allowed currency
                          <input
                            value={governance.allowedCurrency}
                            maxLength={3}
                            onChange={(event) =>
                              setGovernance({
                                ...governance,
                                allowedCurrency:
                                  event.target.value.toUpperCase(),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          Blocked categories (comma-separated)
                          <input
                            value={governance.blockedCategories.join(",")}
                            onChange={(event) =>
                              setGovernance({
                                ...governance,
                                blockedCategories: event.target.value
                                  .split(",")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          Automatic approval limit
                          <input
                            type="number"
                            min="0"
                            value={governance.autoApproveLimit}
                            onChange={(event) =>
                              setGovernance({
                                ...governance,
                                autoApproveLimit: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          Monthly sandbox budget
                          <input
                            type="number"
                            min="1"
                            value={governance.monthlyBudget}
                            onChange={(event) =>
                              setGovernance({
                                ...governance,
                                monthlyBudget: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      </fieldset>
                      <button
                        className="primary"
                        disabled={busy || !canAdmin}
                        onClick={() =>
                          void task(() =>
                            simple({
                              operation: "governance",
                              orgId,
                              governance,
                            }),
                          )
                        }
                      >
                        Save procurement policy v
                        {(org.governanceVersion ?? 1) + 1}
                      </button>
                    </>
                  )}
                  <hr />
                  <h3>MCP client access</h3>
                  <p className="muted">
                    Official MCP JSON-RPC validation, bearer-token hashing and
                    the same governed action pipeline are available at{" "}
                    <code>/api/mcp?orgId={org.id}</code>.
                  </p>
                  <button
                    className="secondary"
                    disabled={busy || !canAdmin}
                    onClick={() =>
                      void task(async () => {
                        const result = await post({
                          operation: "mcpToken",
                          orgId,
                          name: "Development client",
                        });
                        setMcpSecret(result.token ?? "");
                        await refresh();
                      })
                    }
                  >
                    Create one-time MCP token
                  </button>
                  {mcpSecret && (
                    <div className="evidence">
                      <strong>Copy now — this token is shown once</strong>
                      <pre>{mcpSecret}</pre>
                    </div>
                  )}
                  {(org.apiTokens ?? []).map((token) => (
                    <div className="evidence" key={token.id}>
                      <strong>{token.name}</strong>
                      <p>
                        {token.prefix}… ·{" "}
                        {token.revokedAt ? "revoked" : "active"}
                      </p>
                      {!token.revokedAt && (
                        <button
                          className="secondary"
                          disabled={busy || !canAdmin}
                          onClick={() =>
                            void task(() =>
                              simple({
                                operation: "revokeMcpToken",
                                orgId,
                                tokenId: token.id,
                              }),
                            )
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <h2>Organization roles</h2>
                  <p className="muted">
                    Owners manage roles. Admins manage policy, run, review and
                    invite non-admins. Operators run agents; reviewers approve
                    actions; viewers read and export.
                  </p>
                  {org.members.map((m) => (
                    <div className="evidence" key={m.userId}>
                      <strong>{m.email}</strong>
                      <p>{m.role}</p>
                      {member?.role === "owner" && m.role !== "owner" && (
                        <div className="actions">
                          <Choice
                            label={"Role for " + m.email}
                            disabled={busy}
                            value={m.role}
                            onChange={(v) =>
                              void task(() =>
                                simple({
                                  operation: "member",
                                  orgId,
                                  userId: m.userId,
                                  role: v,
                                }),
                              )
                            }
                            values={roleValues}
                          />
                          <button
                            disabled={busy}
                            className="secondary"
                            onClick={() =>
                              void task(() =>
                                simple({
                                  operation: "member",
                                  orgId,
                                  userId: m.userId,
                                  role: null,
                                }),
                              )
                            }
                          >
                            Remove access
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {canAdmin && (
                    <>
                      <h3 className="platform-subhead">
                        Create email-bound invite
                      </h3>
                      <label className="field">
                        Email
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </label>
                      <label className="field">
                        Role
                        <Choice
                          label="Invite role"
                          value={role}
                          onChange={setRole}
                          values={roleValues.filter(
                            (v) =>
                              member?.role === "owner" || v.value !== "admin",
                          )}
                        />
                      </label>
                      <button
                        className="secondary"
                        disabled={busy || !email}
                        onClick={() =>
                          void task(async () => {
                            const r = await post({
                              operation: "invite",
                              orgId,
                              email,
                              role,
                            });
                            setInvite(r.inviteToken!);
                            await refresh();
                          })
                        }
                      >
                        Generate invite
                      </button>
                      {invite && (
                        <div className="evidence">
                          <p>
                            Share this organization ID and one-use token
                            privately. Expires in 24 hours.
                          </p>
                          <pre>
                            {orgId}
                            {"\n"}
                            {invite}
                          </pre>
                        </div>
                      )}
                      <p className="muted">
                        Invites do not change the hosted site&apos;s private
                        audience. The recipient also needs Sites access. No
                        invitation email is sent automatically.
                      </p>
                    </>
                  )}
                </section>
              </div>
            </TabsContent>
            <TabsContent value="audit">
              <section className="panel">
                <h2>Verifiable audit history</h2>
                <p>
                  Every committed mutation extends a SHA-256 chain and binds a
                  digest of the organization state. This detects edits relative
                  to the retained chain; it is not an externally anchored,
                  tamper-proof ledger.
                </p>
                <div className="evidence">
                  <strong>Current checkpoint</strong>
                  <pre>{JSON.stringify(data?.integrity, null, 2)}</pre>
                </div>
                <div className="actions">
                  <button
                    className="primary"
                    onClick={() =>
                      download(
                        "agentgate-organization-" + org.id + ".json",
                        org,
                      )
                    }
                  >
                    <Download size={16} />
                    Export full organization
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      download("agentgate-checkpoint-" + org.id + ".json", {
                        orgId: org.id,
                        ...data?.integrity,
                      })
                    }
                  >
                    Save independent checkpoint
                  </button>
                </div>
                <p className="muted">
                  Keep checkpoints outside this database to detect rollback or
                  history truncation. Exports contain prompts, test data, member
                  emails and invitation hashes; share carefully.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sequence</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Event</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...org.audit].reverse().map((a) => (
                      <TableRow key={a.seq}>
                        <TableCell>{a.seq}</TableCell>
                        <TableCell>{new Date(a.at).toLocaleString()}</TableCell>
                        <TableCell>
                          {org.members.find((m) => m.userId === a.actor)
                            ?.email ?? a.actor}
                        </TableCell>
                        <TableCell>{a.event}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </TabsContent>
          </Tabs>
        </>
      )}
      {data && (
        <details className="panel">
          <summary>Join an existing organization</summary>
          <p className="muted">
            Sign in with the email specified by your invitation.
          </p>
          <label className="field">
            Organization ID
            <input
              value={joinOrg}
              onChange={(e) => setJoinOrg(e.target.value)}
            />
          </label>
          <label className="field">
            One-use invitation token
            <input
              value={joinToken}
              onChange={(e) => setJoinToken(e.target.value)}
              type="password"
              autoComplete="off"
            />
          </label>
          <button
            className="secondary"
            disabled={busy || !joinOrg || !joinToken}
            onClick={() =>
              void task(async () => {
                const r = await post({
                  operation: "accept",
                  orgId: joinOrg,
                  token: joinToken,
                });
                setOrgId(r.orgId!);
                setJoinToken("");
                await refresh(r.orgId);
              })
            }
          >
            Accept invitation
          </button>
        </details>
      )}
      <footer className="footer">
        <span>
          AgentGate · V1.5 · Local Ollama + server-side gateway + isolated
          sandbox
        </span>
        <span>
          Lab limits: 100 runs / organization · six steps / run · 900 KB state
        </span>
      </footer>
    </WorkspaceShell>
  );
}
