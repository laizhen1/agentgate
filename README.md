# AgentGate

An agent security workbench for reproducible policy testing and evidence-backed release gates.

Built on **Promptfoo** for evaluation, React / Vinext for the application, and Cloudflare D1 for persistent assessments. AgentGate's original layer is the policy engine, reference threat cases, versioned registry, enforcement evidence, and release workflow.

## Current scope

- Register an immutable agent version with explicit tools, destinations, approval requirements, and sensitive-data controls.
- Compare permissive and hardened purchasing reference agents using the same 12-case suite.
- Save every report and policy snapshot, inspect individual findings, and export JSON evidence.
- Evaluate a real target with a separate Promptfoo provider that never silently substitutes fixtures.
- Isolate stored records by authenticated user. Hosted identity comes from Sites; local sign-in is simulated by the starter.

The web interface runs **reference policy assessments only**. Fixture prompts are explanatory context; actions are predefined. Its pass rate is not model robustness, attack detection accuracy, or a production security certification. There are no live Browser Use, MCP enforcement, or Langfuse integrations yet.

## Run locally

Requires Node 24 and npm. Run commands from the project root.

    npm run install:ci
    npm run build
    node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_melted_red_ghost.sql
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

No live target is bundled or claimed to have been tested. Build a Browser Use or MCP adapter that emits this schema to connect your agent; the four starter live cases are an initial smoke suite, not a comprehensive benchmark. Final-text pattern checks detect only defined formats and can miss paraphrased or encoded data.

## Architecture

Browser → authenticated workspace API → D1 agents and reports

Reference suite → deterministic action policy → findings and all-cases-pass release gate

Promptfoo CLI → explicit HTTP target → schema validation → proposal checks and output checks

Reports are append-only through the application API. Database administrators can still modify them; exports are not cryptographically signed.

## Next milestones

1. Connect a Browser Use reference agent and an MCP tool adapter; capture real action traces.
2. Introduce held-out attacks and repeated runs, measuring attack success separately from task utility.
3. Integrate Langfuse traces with secrets redacted.
4. Add independently authorized approval records, policy promotion, and signed evidence.
5. Pilot with a developer team and publish observed reliability, cost, and usability results.

See [threat model](docs/threat-model.md) and [evaluation design](docs/evaluation.md).

## Attribution

- [Promptfoo](https://github.com/promptfoo/promptfoo) — MIT; evaluation runner and custom-provider interface.
- [Vinext](https://github.com/cloudflare/vinext), React, Drizzle, and bundled shadcn components retain their respective upstream licenses.
- Application setup and private hosting use the Sites starter.

This repository is an original application using upstream components, not a fork of Browser Use or Promptfoo. Upstream stars are not AgentGate's adoption metrics.
