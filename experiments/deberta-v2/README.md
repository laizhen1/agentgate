# DeBERTa v2: learning-rate search against TF-IDF

An exploratory follow-up to [v1](../deberta-v1/README.md), asking whether
validation-selected learning rates improve the procurement injection classifier.
The existing v1 domain and public results were already known. Reusing those sets
does **not** produce a new blind benchmark, even though this run freezes every
selection before generating new test predictions.

Read [the complete results](results/REPORT.md), [protocol](protocol.json), and
[v1 data card](../deberta-v1/DATA_CARD.md) together. The original v1 experiment and
the separate 120-episode agent benchmark remain unchanged. Classifier F1 is not
agent attack success or tool-execution safety.

## Method

- Same 288/96/96 train/validation/test variants from 36/12/12 synthetic families.
  No new data, relabeling, or external training.
- Full-parameter ProtectAI DeBERTa-v3 adaptation: three epochs, learning rates
  5e-6 / 1e-5 / 2e-5 screened with seed 42, BF16, microbatch 1, accumulation 8,
  gradient checkpointing, AdamW and linear schedule with 10% warmup.
- Same word TF-IDF + logistic regression with C=0.1 / 1 / 10. Report the original
  C=1 baseline and the validation-selected baseline; do not choose using test.
- Use v1's threshold rule: maximum validation recall at empirical FPR <=5%,
  with precision then threshold as tie-breakers. Select hyperparameters by the
  resulting validation F1, breaking ties by lower validation log loss.
- Freeze the selected LR, then train seeds 43 and 44. Report all three seeds;
  seed 42 participates in screening, so the mean is not independent confirmation.
- Evaluate only the selected neural configuration, upstream detector and the
  specified classical baselines, at both validation-selected and fixed 0.5
  thresholds. No post-test retuning or automatic checkpoint promotion.

## Reproduce

Use Python 3.12 and an NVIDIA GPU with BF16 support. The original environment
uses PyTorch 2.8.0+cu128, Transformers 4.57.6 and an RTX 3060 Laptop GPU (6 GB).
Allow several GB for five neural checkpoints. Create an isolated environment;
install the pinned dependencies in `requirements.txt` and the CUDA wheel:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cu128
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

The frozen data is in `../deberta-v1/data/`. Obtain the exact upstream model
using v1's downloader if `../deberta-v1/base-model/` is absent:

```powershell
.\.venv\Scripts\python.exe ../deberta-v1/fetch_sources.py
.\.venv\Scripts\python.exe -B -m unittest test_protocol.py
.\.venv\Scripts\python.exe -u -B run_experiment.py --source ../deberta-v1 --output runs/replication-001 --stage select
.\.venv\Scripts\python.exe -u -B run_experiment.py --source ../deberta-v1 --output runs/replication-001 --stage evaluate
.\.venv\Scripts\python.exe -B summarize.py --source ../deberta-v1 --run runs/replication-001
```

Each experiment requires a new output directory. `--resume` reuses only completed
stages when code, protocol, data and selected model hashes match. Interrupted
training restarts that candidate from its fixed initialization; it does not
resume optimizer state. Scoring failures abort rather than silently excluding
examples. No model or data is downloaded by the experiment runner.

## Verify without a GPU

```powershell
python -B -m unittest discover -s experiments/deberta-v2 -p test_protocol.py
python -B experiments/deberta-v2/verify_results.py --source experiments/deberta-v1 --run experiments/deberta-v2/results
```

Run these commands from the repository root. The verifier uses only Python's
standard library. It checks data/code hashes, every validation selection,
hyperparameter ranking, selection-before-evaluation chronology, all per-example
predictions and all comparison metrics. It does not rerun training.

`results/` includes full prediction JSON, every screening run's validation and
training logs, selection locks, environment versions, comparison tables and
paired family bootstrap intervals. Weights remain in the local run directory
and are excluded from Git. Source attribution and licensing remain documented
in the v1 data card; no additional third-party dataset is introduced.

Only 12 test families and 12 validation families exist. Shared synthetic style,
correlated variants, prior knowledge of v1 results, validation reuse and
single-seed screening limit claims. Report external regressions and the stronger
of the relevant baseline results alongside favorable domain numbers.
