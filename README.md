# AgentGate

An agent security workbench for reproducible policy testing and evidence-backed release gates.

Built on **Promptfoo** for evaluation, React / Vinext for the application, and Cloudflare D1 for persistent assessments. AgentGate's original layer is the policy engine, reference threat cases, versioned registry, enforcement evidence, and release workflow.

## Current scope

- Register an immutable agent version with explicit tools, destinations, approval requirements, and sensitive-data controls.
- Compare permissive and hardened purchasing reference agents using the same 12-case suite.
- Save every report and policy snapshot, inspect individual findings, and export JSON evidence.
- Evaluate a real target with a separate Promptfoo provider that never silently substitutes fixtures.
- Isolate stored records by authenticated user. Hosted identity comes from Sites; local sign-in is simulated by the starter.
- Expose governed tools through an authenticated MCP JSON-RPC endpoint using the official TypeScript SDK schemas.
- Enforce procurement controls for approved vendors, currency, categories, automatic approval thresholds, and monthly budget.
- Export durable run traces in an OTLP-shaped JSON format and show business KPIs alongside security metrics.

The original page runs **reference policy assessments**; /platform adds real
local Ollama runs, server-side tool enforcement, exact-action approvals,
three-mode benchmarks, replay/rerun, organization roles and hash-chained audit.
See [Ollama setup](docs/ollama-setup.md) and
[platform architecture](docs/platform-architecture.md).

Reference pass rates are deterministic fixture results, not model robustness.
Live benchmark numbers appear only after actual model runs. All effects remain
inside isolated sandbox outboxes, orders, and draft purchase requests. MCP calls
use the same server-side gateway as Ollama runs. OpenTelemetry instrumentation
hooks and OTLP export are included; no external collector or Langfuse account is
required.

## Project tutorial: techniques and areas covered

Use the project from left to right as a compact industry tutorial:

1. **Agent and tool security** — strict Zod schemas, allowlists, exact URL
   validation, sensitive-data filtering, prompt-injection defenses, and a
   fail-closed server-side gateway.
2. **MCP integration** — official MCP request validation, Streamable HTTP-style
   JSON-RPC, hashed/revocable bearer tokens, tool discovery, governed tool calls,
   and asynchronous approval-status lookup.
3. **Policy-as-code** — versioned policy snapshots plus an OPA/Rego reference
   bundle for vendor, currency, category, approval-limit, and budget rules.
4. **Human-in-the-loop control** — exact-action SHA-256 fingerprints, expiring
   one-use approvals, optional two-person review, and policy-change invalidation.
5. **Reliable backend engineering** — organization RBAC, tenant isolation,
   prepared D1 queries, optimistic concurrency, durable model leases, atomic
   audit/effect commits, storage limits, and idempotency-oriented design.
6. **AI evaluation and red teaming** — deterministic Promptfoo regression tests
   plus live development/holdout cases across direct and indirect injection,
   domain confusion, data leakage, multilingual attacks, excessive agency, and
   procurement abuse. Security, usefulness, false blocks, errors, and pending
   runs are reported separately.
7. **Observability and evidence** — durable execution traces, OpenTelemetry API
   spans, OTLP JSON export, hash-chained audit checkpoints, replay versus rerun,
   model latency, and token accounting.
8. **Business value** — safe automation rate, prevented policy violations,
   governed spend, draft request volume, and approval turnaround metrics connect
   technical controls to procurement outcomes.
9. **Software quality** — unit, SQLite-backed concurrency, authenticated API,
   MCP integration, lint, formatting, type checking, Promptfoo, and production
   build gates in GitHub Actions.

## Run locally

Requires Node 24 and npm. Run commands from the project root.

    npm run install:ci
    npm run build
    node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_melted_red_ghost.sql
    node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_next_shape.sql
    npm run dev

Apply the migration once to a fresh local database. Open the development URL and sign in through the local sign-in link. Click **Load reference agents**, assess the baseline, then assess the hardened version. The baseline should pass 7/12; hardened should pass 12/12. These are deterministic fixture results.

## Verify

    npm test
    npm run typecheck
    npm run lint
    npm run format:check
    npm run eval:reference
    npm run build

CI performs the same checks without target credentials and exercises the
authenticated HTTP and MCP APIs against a local D1 database. Keep live model
evaluations outside untrusted pull-request jobs.

## Live target evaluation

Set AGENTGATE_TARGET_URL to your own test agent endpoint and optionally AGENTGATE_TARGET_TOKEN, then run:

    npm run eval:live

The runner sends JSON containing prompt, policy, and approval:false. The target must return:

    {"actions":[{"tool":"search_catalog","content":"A-100"}],"text":"Checking delivery availability."}

Actions are proposals, never executed by AgentGate. Target-provided approved fields are explicitly ignored. The provider reports unsafe proposals and final-response sensitive-data matches separately. Malformed responses, timeouts, redirects, and missing configuration become errors. HTTP is accepted only for loopback endpoints. Tests use synthetic secrets.

This generic Promptfoo target adapter remains separate from the bundled Ollama
platform. Build an adapter emitting this schema to test other agents. Its four
starter cases are a smoke suite, not a comprehensive benchmark. Final-text pattern
checks can miss paraphrased or encoded data. No real-model result is claimed until
Ollama has been installed and a live run completed.

## Architecture

Browser → authenticated workspace API → D1 agents and reports

Reference suite → deterministic action policy → findings and all-cases-pass release gate

Promptfoo CLI → explicit HTTP target → schema validation → proposal checks and output checks

Reports are append-only through the application API. Database administrators can still modify them; exports are not cryptographically signed.

## Live platform demonstration

1. Configure Ollama locally, create a lab, and run a useful catalog task.
2. Run the development batch in all three modes and inspect unsafe proposals
   separately from unsafe executed actions.
3. Configure procurement controls, create an MCP token, and call the governed
   purchase tool from an MCP client.
4. Request a high-value purchase or supplier message, inspect its fingerprint,
   approve it, and resume.
5. Change policy, replay old proposals without side effects, then rerun the model.
6. Export an OTLP trace, inspect business KPIs, invite a reviewer, enable
   two-person approval, and save an audit checkpoint.

The SQLite-backed tests cover concurrent approvals, procurement controls,
tenant/role isolation,
invitation replay, model leases, audit tampering and honest error reporting.
Future production work includes larger independent attack sets, real connector
idempotency, distributed orchestration, rate limits, and external audit anchoring.

See [threat model](docs/threat-model.md) and [evaluation design](docs/evaluation.md).

## Attribution

- [Promptfoo](https://github.com/promptfoo/promptfoo) — MIT; evaluation runner and custom-provider interface.
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) — MCP schemas and protocol types.
- [OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js) — vendor-neutral instrumentation API.
- [Open Policy Agent](https://github.com/open-policy-agent/opa) — Rego policy format used by the portable reference bundle; hosted enforcement uses the tested native equivalent.
- [Vinext](https://github.com/cloudflare/vinext), React, Drizzle, and bundled shadcn components retain their respective upstream licenses.
- Application setup and private hosting use the Sites starter.

This repository is an original application using upstream components, not a fork of Browser Use or Promptfoo. Upstream stars are not AgentGate's adoption metrics.
