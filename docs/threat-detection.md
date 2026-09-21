# BERT-family threat detection

AgentGate now has an observation-only Threat Detection Lab under /platform.
Operators can analyze text without Ollama. Assessments persist in the organization's
existing D1 record, extend its audit chain, and are included in organization exports.
Viewers can inspect results; only owners, admins and operators can request inference.
There is a limit of 50 manual assessments per organization.

When configured, live Ollama steps also scan incoming user and tool messages.
The classifier does not grant approvals, change policy decisions, or block actions.
Failures produce an unavailable result, never a benign score.

## Local setup (PowerShell)

Requires Python 3.11 or 3.12. From the project root:

    py -3.12 -m venv .venv-threat
    .\.venv-threat\Scripts\python.exe -m pip install -r services/threat/requirements.txt
    .\.venv-threat\Scripts\python.exe services/threat/server.py

The initial startup downloads the model weights from Hugging Face. Wait for
"Threat detector ready". CPU inference is supported; no GPU or paid API is required.
Add this setting to your existing .dev.vars file without replacing other settings:

    AGENTGATE_THREAT_URL=http://127.0.0.1:8765

Restart the local app, open /platform, select an organization, and select
Threat detection. Try the attack, benign, and known false-positive sample inputs. The hosted app cannot reach your laptop;
this first version deliberately accepts only a server-configured loopback service.

## Model and interpretation

The default is Protect AI's Apache-2.0
[DeBERTa-v3 prompt-injection classifier](https://huggingface.co/protectai/deberta-v3-base-prompt-injection-v2).
DeBERTa is a BERT-family encoder, not the original bert-base model.
This is an existing fine-tuned checkpoint, not a model trained by this project.
Its upstream project is archived. It targets English prompt injection, not
general harmful content, all jailbreaks, or multilingual protection.

The service verifies SAFE / INJECTION labels, uses safetensors, disables remote
model code, and records the resolved checkpoint commit. Set
AGENTGATE_THREAT_REVISION to a Hugging Face commit hash before starting the Python
service to pin a reproducible version. The default is pinned to commit 90c9989b1a342275dd0d1a95aad283c04e075671.

Inputs are limited to 6,000 characters. Overlapping 512-token windows with a
64-token overlap cover the input; the largest injection softmax score is returned.
The 0.5 threshold is an experimental default; an optional validation artifact can
select a different operating threshold (see [ML workflow](ml-workflow.md)). Neither
is a security guarantee. Maximum-window aggregation can increase false positives on long inputs.
Do not infer production accuracy from the two UI examples or reference fixtures.

The service binds to 127.0.0.1 only, rejects browser-origin requests, does not log
prompt text, and uses a bounded JSON protocol. It is a local development service.
App assessment records do retain submitted text, just as agent runs retain prompts.

## Evaluation

    npm test
    npm run typecheck
    python -B -m unittest discover -s services/threat -p 'test_*.py'
    python services/threat/evaluate.py path/to/heldout.jsonl

Each JSONL row must contain text and label (0 benign, 1 injection).
The evaluator calls the running service and reports precision, recall, F1, false
positives, false negatives, latency, errors, coverage and model revisions. Malformed or oversized service responses count as errors before any prediction is recorded. Errors are counted
separately, not treated as correct predictions. Keep evaluation data separate from
training data, including paraphrases and attack families. Include quoted attack
discussions, indirect document attacks, long inputs and ordinary procurement tasks.

The [ML workflow](ml-workflow.md) provides grouped dataset splitting, per-example
error review, validation threshold selection, and a training pipeline comparing
TF-IDF, the pretrained checkpoint, and a fine-tuned encoder. A meaningful experiment
requires a licensed, independently split dataset; no production accuracy is claimed.

## Verified local smoke results

On the pinned checkpoint, a catalog request scored below 0.001%, a direct
credential-exfiltration instruction scored above 99.99%, and an attack after a
long benign prefix was covered by two windows and scored above 99.99%.
A benign request to explain the phrase "ignore previous instructions" also scored
above 99.99%: this is a confirmed false positive. These four synthetic examples
are smoke checks, not an accuracy benchmark. This limitation is why the first
version is advisory.

If Windows blocks Python from creating a virtual environment in a OneDrive
folder, use a temporary environment instead:

    py -3.12 -m venv "$env:TEMP\agentgate-bert-venv"
    & "$env:TEMP\agentgate-bert-venv\Scripts\python.exe" -m pip install -r services/threat/requirements.txt
    $env:HF_HOME = "$env:TEMP\agentgate-bert-cache"
    & "$env:TEMP\agentgate-bert-venv\Scripts\python.exe" -B services/threat/server.py
