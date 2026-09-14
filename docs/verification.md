# Verification record

## MCP and procurement expansion — September 14, 2026

- 28 unit and SQLite-backed tests passed, including procurement policy decisions,
  sandbox purchase execution, and governance-bound approval fingerprints.
- TypeScript and repository-wide ESLint passed after removing the previous lint
  debt. CI now gates lint and authenticated HTTP/MCP integration in addition to
  tests, formatting, Promptfoo, and production build.
- The official MCP TypeScript schemas validate initialize, tools/list and
  tools/call. Tokens are hashed and revocable; MCP actions enter the same policy,
  approval, audit, and sandbox pipeline.
- Twelve live development/holdout cases now cover multilingual and encoded
  injection attempts plus vendor, category, threshold, and budget controls.
- OpenTelemetry API spans and OTLP-shaped durable trace export are implemented.
  No external collector was configured or claimed.
- The included Rego bundle is an OPA-compatible reference with tests. The hosted
  Worker uses the tested native equivalent; an OPA runtime was not executed in
  this environment.

## Live platform expansion — September 12, 2026

- 25 unit and SQLite-backed service tests passed (including the original eight).
- Real local HTTP checks passed for both the platform and reference APIs:
  authentication, persistence, policy revision, audit integrity, CSRF, input
  validation, owner protection, and unavailable-model behavior.
- Concurrent approvals commit one sandbox effect. Concurrent model steps are
  rejected while leased. Expired/changed approvals cannot execute.
- Cross-organization access and viewer writes are rejected. Invitations are
  email-bound and cannot be reused. Audit corruption blocks subsequent writes.
- Promptfoo reference regression: 12/12 passed, no errors.
- TypeScript, source formatting and production compilation passed.
- Additive migration 0001 applied locally; migration 0000 was not modified.

Ollama was not installed on PATH and its loopback API was not responding.
Model-adapter and orchestration tests used explicitly controlled test responses.
**No real-model benchmark score is claimed.** Follow the Ollama setup guide to
download a model and run the live suite.

The user's existing IntelliJ server was left running. A separate temporary Vite
server on 127.0.0.1:5174 was used for API checks. No browser interaction or visual
QA was performed; optional browser WebMCP integration remains unverified.

Initial local validation:

- Eight security-engine and live-response regression tests passed.
- Promptfoo reference suite: twelve passed, zero failed, zero errors.
- TypeScript check and production compilation passed.
- API integration exercises local sign-in, idempotent reference registration, baseline/hardened assessments, persistent readback, rejected cross-origin writes, invalid input, and missing agents.

Reference results are synthetic. No external live AI target, Browser Use session, MCP server, or Langfuse deployment was evaluated.

The optional imperative WebMCP action uses the same assessment API. No supported WebMCP validation context was available during this build, so registration and execution in a supporting browser remain unverified. No interactive browser QA was performed.

Windows environment note: the Sites package-manager launcher failed to find npm; installation and build succeeded by invoking npm's installed JavaScript entrypoint directly. Normal npm commands remain in package scripts and CI.
