# DeBERTa input filtering and controlled agent comparison

The live agent can now withhold untrusted source text before the next model call.
This is separate from the gateway: authorization, argument-bound approvals and
scripted benchmark review remain unchanged.

## Live opt-in

Keep the existing local detector configuration, then set:

```ini
AGENTGATE_THREAT_URL=http://127.0.0.1:8765
AGENTGATE_THREAT_INTERVENTION=withhold
```

Restart the application. Without the second setting, existing observation-only
behavior is preserved. The manual Threat Detection Lab remains observational.

The shared guard scans new catalog/brief tool responses and the text of each RAG
citation. It never scans trusted system instructions or treats classifier output
as approval. A flagged catalog/brief response is replaced by an evidence-unavailable
message. A flagged RAG passage and its citation are removed; remaining passages
retain their original source metadata. If all passages are removed, the model
receives an explicit no-evidence result. Original text, scores and model identities
remain in the audit assessment records; filtered context is persisted for later turns.

A detector outage or invalid response stops the step before generation. It is not
classified as a benign passage or a false alarm. No additional retries or invented
replacement evidence are introduced. To use a fine-tuned local checkpoint and its
validation threshold with the existing service, see [ML workflow](ml-workflow.md).

## Comparison design

[Full results](../experiments/agent-detector-v1/REPORT.md) and
[machine-readable summary](../experiments/agent-detector-v1/summary.json).

- 10 existing paired families × clean/attacked × Qwen3:1.7b/Llama3.2:3b ×
  no detector/upstream/fine-tuned = 120 episodes.
- Every arm uses the same gateway, defensive prompt, scripted reviewer, inference
  settings, retrieval, six-turn budget and independent outcome checks.
- Detector thresholds come from the frozen DeBERTa v3 validation artifacts:
  upstream 0.9999644756317139; adapted 0.7697732448577881.
- The adapted checkpoint is learning rate 5e-5, seed 42. It was chosen as the
  original screening seed before running the comparison, not as the best agent-test seed.
- Detector inference runs on CPU float32 with four threads, keeping GPU memory
  available for Ollama. Both detectors are preloaded and warmed. This serving
  environment differs from the earlier GPU training/evaluation environment.
- Arm order rotates across families and conditions. Models run sequentially.
  Every measured episode, including errors, remains in the report.
- The scenarios are reused from the original pilot, so this is a controlled
  integration ablation, not a new held-out benchmark or a three-training-seed study.

Task completion and attacker success are independently recomputed from actual
sandbox effects and final answers. Citation and exposure checks use the evidence
actually sent to the model after filtering.

False alarms are reported both as clean episodes with at least one withheld source
and blocked clean source presentations. The latter includes repeated presentations
and is not an independent-sample classifier FPR. No-detector zero false alarms is
a structural property, not evidence of detection accuracy. Latency includes
end-to-end mean/median/p95 and detector wall time per episode. Model loading,
retrieval caches and different trajectory lengths affect end-to-end timing.

## Reproduce

Use the existing Ollama and retrieval setup from [agent benchmark](agent-benchmark.md).
Start the separate two-checkpoint comparison service; all model files are local,
remain outside Git, and are identified by hashes:

```sh
python services/threat/comparison_server.py \
  --upstream path/to/base-model \
  --finetuned path/to/deberta-lr5e-05-seed42/checkpoint \
  --results experiments/deberta-v3/results
npm run benchmark:detector -- --smoke --out artifacts/detector-development
npm run benchmark:detector -- --out artifacts/agent-detector-v1
npm run benchmark:detector:report -- --input artifacts/agent-detector-v1
npm run benchmark:detector:report -- --input artifacts/agent-detector-v1 --verify
```

The comparison service binds only to loopback port 8767, rejects browser-origin
requests, loads safetensors offline, and checks label mappings. The runner checks
checkpoint/source hashes, frozen thresholds and Ollama model digests. A manifest
is written before inference; resume skips completed cells, never retries their
failures, and refuses changed configurations. Use a separate output directory
after any protocol or source change.

The first development attempt encountered sandbox-related model-loading and cold
retrieval timeouts. It was stopped and retained locally. Services were restarted
with normal local GPU/process access, and the second 12-episode development run
completed without service errors before the measured run. Development outputs
are excluded from the report.

## Offline verification

```sh
npm test
npm run benchmark:verify
npm run benchmark:detector:verify
npm run typecheck
npm run lint
npm run format:check
python scripts/check-public-repo.py
```

CI replays saved evidence without downloading weights or running inference.
The original 120-episode benchmark and its frozen source are preserved unchanged.
