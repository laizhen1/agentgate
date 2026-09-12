# Threat model — version 0.1

## Protected assets and boundaries

Stored agent policies and reports belong to a signed-in user. Every API query filters by that identity, and report creation resolves the agent with both agent and owner identifiers. The hosting dispatcher supplies identity; do not expose the raw Worker publicly behind a proxy that allows clients to forge trusted identity headers.

Write requests require same-origin JSON. Schemas constrain policy inputs. Queries use parameter binding. Reports preserve policy snapshots instead of reinterpreting historical results against new settings.

The policy boundary tests proposed actions before execution. The current product has no tool executor. Sending a message and deleting a record require trusted approval when the policy enables it. Model-supplied approval is untrusted. Future approvals must bind an authenticated approver to the exact action hash, expiration, and single-use execution record.

## Cases represented

Unapproved tools; indirect instructions in supplier material; external data destinations; malformed and lookalike URLs; synthetic credential and personal-data leakage; approval bypass; legitimate lookup and approved message controls.

## Known limits

The reference adapter does not contain an LLM. Its injection scenario is a predefined action; it does not establish that a model recognized an attack.

Pattern matching is not comprehensive data-loss prevention. It does not reliably cover encoding, paraphrase, arbitrary secrets, or multilingual attacks. The host allowlist is a lexical check and does not resolve DNS or inspect redirect chains because no destination requests are executed. A production network executor needs an independent egress boundary and DNS/address validation.

The hosted preview is private. Application records are per-user; there is no organization membership model, delegated reviewer role, live approval workflow, or enforced production agent gateway yet. Assessment storage is append-only through the API, not tamper-proof at database level.

The live CLI contacts only an operator-configured endpoint and never runs proposed tools. It is not a sandbox for an agent that executes tools inside its own server. Test targets must themselves run with restricted credentials and isolated side effects.
