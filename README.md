# AgentGate

An agent security workbench for reproducible policy testing and evidence-backed release gates.

Built on **Promptfoo** for evaluation, React / Vinext for the application, and Cloudflare D1 for persistent assessments. AgentGate's original layer is the policy engine, reference threat cases, versioned registry, enforcement evidence, and release workflow.

## Current scope

- Register an immutable agent version with explicit tools, destinations, approval requirements, and sensitive-data controls.
- Compare permissive and hardened purchasing reference agents using the same 12-case suite.
- Save every report and policy snapshot, inspect individual findings, and export JSON evidence.
- Evaluate a real target with a separate Promptfoo provider that never silently substitutes fixtures.
- Isolate stored records by authenticated user. Hosted identity comes from Sites; local sign-in is simulated by the starter.

The original page runs **reference policy assessments**; /platform adds real
local Ollama runs, server-side tool enforcement, exact-action approvals,
three-mode benchmarks, replay/rerun, organization roles and hash-chained audit.
See [Ollama setup](docs/ollama-setup.md) and
[platform architecture](docs/platform-architecture.md).

Reference pass rates are deterministic fixture results, not model robustness.
Live benchmark numbers appear only after actual model runs. All effects remain
inside isolated sandbox outboxes/orders. There are no Browser Use, MCP enforcement
or Langfuse integrations; tracing and the gateway are implemented in this project.

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
    npm run eval:reference
    npm run build

CI performs the same checks without target credentials. Keep live evaluations outside untrusted pull-request jobs.

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
3. Request a supplier message, inspect its fingerprint, approve it and resume.
4. Change policy, replay old proposals without side effects, then rerun the model.
5. Invite a reviewer, enable two-person approval, and export an audit checkpoint.

The SQLite-backed tests cover concurrent approvals, tenant/role isolation,
invitation replay, model leases, audit tampering and honest error reporting.
Future production work includes larger independent attack sets, real connector
idempotency, distributed orchestration, rate limits, and external audit anchoring.

See [threat model](docs/threat-model.md) and [evaluation design](docs/evaluation.md).

## Attribution

- [Promptfoo](https://github.com/promptfoo/promptfoo) — MIT; evaluation runner and custom-provider interface.
- [Vinext](https://github.com/cloudflare/vinext), React, Drizzle, and bundled shadcn components retain their respective upstream licenses.
- Application setup and private hosting use the Sites starter.

This repository is an original application using upstream components, not a fork of Browser Use or Promptfoo. Upstream stars are not AgentGate's adoption metrics.
