# AgentGate: reproducible DeBERTa domain adaptation

This experiment trains the actual Protect AI DeBERTa-v3-base injection classifier
on procurement contrast examples. It compares TF-IDF logistic regression, the
original checkpoint, and three full-parameter fine-tuning seeds. It is a small
synthetic domain-adaptation study with external diagnostics, not a production
security benchmark. Results come from executed training/inference, not fixtures.

Read `DATA_CARD.md` before using any metric in a resume. Read the completed
`results/REPORT.md`, `results/comparison.csv`, and `results/aggregate.json` for every
result, including regressions. The large checkpoints and per-example reports are
available locally in `runs/run-001/` after training; they are excluded from Git.
The [evidence bundle](bundles/agentgate-deberta-evidence.zip) contains the original
per-example reports without weights. The [source bundle](bundles/agentgate-deberta-source.zip)
provides the frozen inputs for the Colab upload workflow. Verify bundle downloads
against [SHA-256 checksums](bundles/SHA256SUMS.json). See `ERROR_ANALYSIS.md` for reviewed failure examples.

## What is frozen

- `protocol.json`: training settings, split/seed policy, endpoints, and limits.
- `families.json`: 60 AI-authored contrast pairs; four variants of each label.
- `data/*.jsonl` and `data/manifest.json`: exact 288/96/96 domain splits and the
  two public diagnostic sets, with hashes, label counts, and filtering records.
- `sources/manifest.json`: exact public source URLs, revisions, and file hashes.
- `analysis.py`: snapshot of the existing AgentGate metric/report implementation.
- `run_experiment.py`: fit baselines, train all seeds, select thresholds on
  validation, save the training-completion marker, then score held-out datasets.

The baseline is the original injection-fine-tuned Protect AI checkpoint, not a
random classifier or a generic unfine-tuned encoder. The learned model remains
advisory in AgentGate; it cannot approve tool calls or bypass the policy gateway.

## Reproduce locally

Use Python 3.12, an NVIDIA CUDA GPU with BF16 support, and a fresh environment.
The original run used an RTX 3060 Laptop GPU with 6 GB VRAM. Allow several GB for
the CUDA package, the base model (~738 MB), and three checkpoints (~738 MB each).
The model uses safetensors; remote model code is disabled. No API key is needed.

```powershell
python -m venv .venv
.\run-local.ps1 -Python .\.venv\Scripts\python.exe -Output runs\replication-001
```

If the system does not have a Python installation, pass an installed Python 3.12
interpreter when creating the environment. The actual desktop run used Codex's
bundled Python to create an isolated environment outside the OneDrive project.
No global Python packages were replaced.

For an already-installed environment, the stages are:

```powershell
python fetch_sources.py
# Only when data/manifest.json does not already exist:
python prepare_data.py
python -B -m unittest test_protocol.py
python -u run_experiment.py --output runs/replication-001
python summarize.py runs/replication-001
python verify_artifacts.py runs/replication-001
```

Each new experiment requires a new output directory. `--resume` can continue
completed stages of an interrupted run only when protocol/data/training-code
hashes match. It does not resume an incomplete optimizer state; an interrupted
seed is retrained from its fixed initialization and seed.

`requirements.txt` pins the direct training dependencies. The original run's
`environment.lock.txt` records every installed package. On Windows the CUDA
wheel is `torch==2.8.0+cu128`; install from the PyTorch CUDA 12.8 index. Cross-OS
replications use the matching platform wheel and record their own environment.
Fixed RNG seeds do not guarantee bit-identical weights across GPU/platforms.

## Colab

Open `AgentGate_DeBERTa.ipynb` in Colab and upload the provided source ZIP. Choose
a BF16-capable GPU (for example L4 or A100). A T4 cannot run this exact BF16
protocol; the notebook fails explicitly instead of silently changing training.
Notebook cells are syntax-checked but have not been executed in a Colab runtime.
The notebook downloads the same pinned model/data and exports reports; optional
cells export seed 42's checkpoint. Save any desired checkpoints before the
temporary Colab runtime expires. Nothing automatically mounts or modifies Drive.

## Read the evidence

Each model directory contains validation results, `selection.json`, and test
JSON/HTML files. Fine-tuned directories also contain `training.json`, tokenizer,
and `checkpoint/model.safetensors`. Every comparison uses identical held-out
examples. The fixed 0.5 reports separate weight changes from threshold changes.
`comparison.csv` includes numerators, denominators, errors, and latency.

The selected threshold maximizes validation recall subject to empirical FPR <=5%.
A failed threshold constraint is recorded; it does not become a successful
calibration artifact. Public-set thresholds are never reselected. NotInject
contains only benign examples: report FPR there, not attack recall/F1.

Domain uncertainty is estimated by resampling entire contrast families, preserving
paired model predictions. Only 12 test families exist; contextual variants are
correlated. Seed variation is reported separately, not treated as new test data.

## Runtime verification notes

The existing Python analysis/evaluation suites passed (10 tests; the separate
opt-in tiny-model integration test was skipped). Three new dataset/threshold
tests passed. Actual saved seed-42 weights and calibration were loaded by the
existing detector service; two integration probes succeeded. They are not an
accuracy benchmark.

Transformers 4.57.6 emits a Mistral-regex warning when reloading this locally saved
DeBERTa tokenizer. Inspection of its installed loader found a broad local-model
version check. Source and saved tokenizers produced identical token IDs on all
1,481 examples; no regex correction was applied. See `tokenizer-roundtrip.json`.
The TF-IDF optimizer also emitted an ignored `iprint` solver-option warning with
the recorded SciPy version; no convergence failure was reported.

## Optional application integration after reviewing results

All checkpoints stay experimental; none is promoted automatically. Seed 42 is
the predesignated integration example, not a test-selected winner. To try it in
the existing local detector, set paths in a shell before starting the service:

```powershell
$env:AGENTGATE_THREAT_CHECKPOINT = '<absolute path>/runs/run-001/finetuned-seed42/checkpoint'
$env:AGENTGATE_THREAT_CALIBRATION = '<absolute path>/runs/run-001/finetuned-seed42/calibration.json'
python services/threat/server.py
```

Run the final command from the AgentGate project root. Set the calibration path
only if that artifact exists. It binds the model weight hash and uses the
existing server's `finetuned` model identity. Serving defaults to CPU; experiment
GPU timings do not represent that service's latency.

## Attribution and boundaries

- Protect AI model: Apache-2.0; pinned upstream model card and LICENSE are retained
  with the downloaded base model.
- NotInject: MIT according to the dataset card; authors Hao Li and Xiaogeng Liu.
- deepset prompt-injections: retain author attribution and the source card's
  top-level Apache-2.0 / nested CC-BY-4.0 declarations; see `DATA_CARD.md`.
- Original synthetic examples were created for this project with AI assistance;
  they are not claimed to be collected customer traffic or human-labeled data.

This experiment does not establish general robustness, multilingual protection,
real-world prevented incidents, or improved end-to-end agent safety. Report any
external regression alongside gains on the synthetic domain set.
