# Bounded recovery after filtering

When DeBERTa withholds a source, the agent may lose facts needed to complete the original task. The optional recovery path performs one automatic read-only document search and rescans every replacement passage before inference.

## Live configuration

Use the existing detector and retrieval setup, then enable:

```ini
AGENTGATE_THREAT_INTERVENTION=withhold
AGENTGATE_THREAT_RECOVERY=retrieve
```

Recovery requires filtering to be enabled. The query is the first user request, truncated to the existing 500-character retrieval limit. It never uses instructions copied from the blocked text. Search is restricted to enabled documents in the current organization and still checks membership and the allowed-tools policy. Blocked RAG document IDs and documents containing an exact blocked source are excluded.

The shared recovery module appends a screened search_documents result, with original citation metadata, to the model context. It records the query, exclusions, raw retrieval result, detector decisions, delivered evidence and wall time in the session audit trace. At most one automatic attempt is allowed per session. Normal model-directed tools retain their existing permissions, approvals and execution checks.

Empty or unavailable retrieval returns an explicit no-evidence result. A detector failure stops inference. Recovery does not reconstruct hidden facts or automatically execute purchases/messages. The model must decide whether the remaining evidence supports the original task.

## Fresh comparison

See the [comparison report](../experiments/agent-recovery-v1/REPORT.md) and [summary](../experiments/agent-recovery-v1/summary.json).

- 12 newly authored task families, each with a clean and attacked primary source.
- Two fixed Ollama models: Qwen3:1.7b and Llama3.2:3b.
- Two arms: filtering-only and filtering plus one automatic recovery attempt.
- 96 episodes, one trial per cell. No detector or threshold tuning on these scenarios.
- Identical corpus, gateway, scripted reviewer, generation parameters and six model-turn/300-second limits. Filtering-only may search the same fallback documents itself.
- Ten scenarios have useful alternate evidence. One lacks the required facts, and one has an attacked fallback in the attacked condition.
- Independent final-answer and sandbox-effect checks; all failures included. Primary-source access is required by the task and checked separately from correct output.

The comparison isolates cross-source recovery from catalog/brief responses into FAISS document retrieval. It does not claim to benchmark every possible RAG attack. The threat categories overlap earlier work; the prompts, procurement facts and fallback documents are fresh. Twelve authored families are not 96 independent scenarios.

## Reproduce

Install the existing Python detector/retrieval dependencies and npm dependencies. Keep checkpoint weights outside Git. Start a dedicated Ollama service on port 11435 with qwen3:1.7b, llama3.2:3b and embeddinggemma:latest available. For example, set OLLAMA_HOST=127.0.0.1:11435, OLLAMA_MAX_LOADED_MODELS=1 and OLLAMA_NUM_PARALLEL=1 before running ollama serve. Set OLLAMA_MODELS to your existing model directory when needed.

In separate terminals:

```sh
python services/threat/comparison_server.py \
  --upstream path/to/base-model \
  --finetuned path/to/deberta-lr5e-05-seed42/checkpoint \
  --results experiments/deberta-v3/results
python services/retrieval/recovery_server.py
```

The retrieval adapter uses the unchanged FAISS implementation with the dedicated Ollama port. It listens on loopback port 8766; the detector comparison service uses 8767.

```sh
npm run benchmark:recovery -- --smoke --out artifacts/recovery-development
npm run benchmark:recovery -- --out artifacts/recovery-comparison
npm run benchmark:recovery:report -- --input artifacts/recovery-comparison
npm run benchmark:recovery:report -- --input artifacts/recovery-comparison --verify
npm run benchmark:recovery:verify
```

The runner writes its manifest before inference, then checks source hashes, checkpoint identity, frozen validation threshold and Ollama digests. Resume skips recorded cells, including failures, and rejects changed configurations. Each model is warmed before its block; do not run builds or tests during timing. End-to-end latency includes recovery, embedding/model switches and cache effects.

The development smoke task is separate from the 12 comparison families. Its first version revealed that the models could bypass the requested primary source; before the comparison, prompts were made explicit about the required first tool. The second development run exercised actual filtering and recovery. Neither smoke run is included in the comparison results. Old detector and agent pilot artifacts remain unchanged.
