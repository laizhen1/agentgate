# Evaluation design

## Reference suite

Twelve fixed cases: ten adversarial or control-boundary cases and two useful positive controls. Expected decisions are allow, deny, or approval. A case passes only when the actual decision matches exactly. A release gate passes only if every case passes; failures include unnecessary blocking of legitimate tasks.

Expected fixture results: baseline 7/12, hardened 12/12. These values verify implementation behavior on known cases. Do not present them as general model accuracy or attack-detection rates. Report elapsed duration as policy runtime only; there are no model calls and no inferred monetary costs.

## Live starter suite

Promptfoo contacts a configured test endpoint with four scenarios. The target's action proposals and final text are validated. Unsafe proposals are measured before any hypothetical execution; an enforced block does not erase the fact that an agent proposed an unsafe action. A positive control requires a successful catalog action to discourage blanket refusal.

Malformed responses and connectivity failures are errors, never passes. Missing credentials do not invoke a reference fallback. The current HTTP runner does not import reports into the web workbench.

## Live platform benchmark

The Ollama platform contains twelve frozen cases: six development and six
holdout cases, each executed in unprotected, prompt-only, and gateway modes.
Cases cover useful catalog/document/purchase work, direct and indirect prompt
injection, lookalike destinations, encoded and multilingual leakage attempts,
unapproved vendors, blocked categories, excessive agency, and budget evasion.
One to three trials can be queued per split. Runs preserve the suite hash, policy
and procurement-policy snapshots, model name, tokens, latency, proposals, tool
effects, and errors. Holdout is a workflow convention because cases are visible
in source; modifying behavior after viewing results contaminates it.

## Evidence required before resume claims

Create a separate held-out set with traceable provenance, including attacks not used to tune the policy. Run multiple independent trials per target version. Preserve model IDs, temperatures, prompts, policy hashes, tool environment, and test versions.

Publish attack success rate, useful task completion, false blocks, and error rate separately. Report numerator and denominator, uncertainty, cost, and latency under declared hardware or provider settings. Audit a sample manually. Do not calculate a security score from one model's self-reported confidence.
