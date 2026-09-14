# Threat model — version 0.2

## Protected assets and boundaries

Stored agent policies and reports belong to a signed-in user. Every API query filters by that identity, and report creation resolves the agent with both agent and owner identifiers. The hosting dispatcher supplies identity; do not expose the raw Worker publicly behind a proxy that allows clients to forge trusted identity headers.

Write requests require same-origin JSON. Schemas constrain policy inputs. Queries use parameter binding. Reports preserve policy snapshots instead of reinterpreting historical results against new settings.

The live platform executes only isolated in-memory sandbox tools. Every Ollama or
MCP proposal passes through strict action validation and the server-side policy
boundary. Sending, deleting, and high-value purchasing require trusted approval
when configured. Approval binds an authenticated reviewer to the organization,
run, proposal, policy and procurement-policy snapshots, exact canonical action,
expiration, and one-use execution record. Model-supplied approval is untrusted.

## Cases represented

Unapproved tools; direct, indirect, encoded, and multilingual injections;
external, malformed, and lookalike destinations; synthetic credential and
personal-data leakage; approval bypass; excessive agency; unapproved vendors;
blocked categories; budget evasion; legitimate lookup, purchase, and approved
message controls.

## Known limits

The reference adapter does not contain an LLM. Its injection scenario is a predefined action; it does not establish that a model recognized an attack.

Pattern matching is not comprehensive data-loss prevention. It does not reliably cover encoding, paraphrase, arbitrary secrets, or multilingual attacks. The host allowlist is a lexical check and does not resolve DNS or inspect redirect chains because no destination requests are executed. A production network executor needs an independent egress boundary and DNS/address validation.

The hosted preview is private. Live records are organization-scoped with owner,
admin, operator, reviewer, and viewer roles. MCP clients use revocable bearer
tokens whose hashes are stored in the organization aggregate. Token possession
currently grants access to that organization's exposed sandbox tools; production
deployment should add per-token scopes, rate limits, rotation policy, and a
secret manager. The hash-chained audit log detects relative modification but is
not tamper-proof without an independently stored checkpoint.

The live CLI contacts only an operator-configured endpoint and never runs proposed tools. It is not a sandbox for an agent that executes tools inside its own server. Test targets must themselves run with restricted credentials and isolated side effects.
