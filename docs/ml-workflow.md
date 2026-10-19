# Threat evaluation, calibration, and fine-tuning

The detector remains advisory. Learned scores and calibrated thresholds never
grant approvals or replace the server-side policy gateway. These tools create
experiments; they do not imply that a new model has been trained or is better.

## Curate and split data

Use licensed, reviewed JSONL with one document per line:

```json
{
  "id": "example-001",
  "text": "List available laptops.",
  "label": 0,
  "group": "catalog-requests-family",
  "category": "ordinary procurement",
  "language": "en",
  "source": "internally authored",
  "license": "organization-owned"
}
```

Labels are 0 (benign) or 1 (injection). Inputs are limited to 6,000 characters.
Assign related paraphrases, common source documents, and attack variants to the
same `group`. Group assignment requires curator judgment: exact-text checks cannot
identify all paraphrases. Include benign security discussions, indirect attacks,
long inputs, ordinary purchasing tasks, and independently sourced attack families.

```powershell
py -3.12 services/threat/split.py data/labeled.jsonl artifacts/splits --seed 42
```

This creates a deterministic 60/20/20 split by group count and a provenance
manifest. It rejects fewer than ten groups, missing classes in a split, and
cross-split IDs, groups, or normalized duplicate texts. Review class/category
coverage before freezing the split. You may instead provide externally curated
train/validation/test files; the training runner performs the same checks.

## Evaluate and select an operating threshold

Start the threat service as described in [threat detection](threat-detection.md).
Then run:

```powershell
py -3.12 services/threat/evaluate.py artifacts/splits/validation.jsonl --split validation --max-fpr 0.05 --output artifacts/validation
py -3.12 services/threat/evaluate.py artifacts/splits/test.jsonl --calibration artifacts/validation.calibration.json --output artifacts/test
```

Each output includes `.json` and an offline `.html` review screen. Open the HTML
file to filter false positives, false negatives, errors, language, category, and
input length. The JSON retains every prediction, model/revision, confusion counts,
coverage, precision, recall, F1, false-positive rate, mean/p50/p95 inference latency,
slice metrics, and a precision–recall threshold sweep. Reports contain source text;
store them with the same access restrictions as the source dataset.

Calibration selects maximum validation recall subject to the false-positive target,
then precision and a conservative threshold break ties. It requires both classes,
complete inference coverage, and a single checkpoint identity. If no threshold
meets the target, the command fails instead of claiming calibration succeeded.
The empirical target is not a guarantee on future data. Scores are not calibrated
probabilities; this is operating-threshold selection, not probability calibration.

The test command applies the validation artifact unchanged and checks model identity
and dataset hash. Use the split validator to prevent related examples crossing
boundaries. Do not tune a model after inspecting its test errors and still call that
dataset untouched; create another held-out set for the next experiment.

To apply a successful threshold in the running lab, set before starting the service:

```powershell
$env:AGENTGATE_THREAT_CALIBRATION = "artifacts/validation.calibration.json"
```

The service rejects artifacts for a different checkpoint. The UI persists and shows
the threshold actually used for each observation. Without an artifact it uses 0.5.

## Compare a baseline, pretrained encoder, and fine-tuned encoder

Use Python 3.12 and a dedicated environment:

```powershell
py -3.12 -m venv .venv-training
.\.venv-training\Scripts\python.exe -m pip install -r services/threat/requirements-training.txt
.\.venv-training\Scripts\python.exe services/threat/train.py --train artifacts/splits/train.jsonl --validation artifacts/splits/validation.jsonl --test artifacts/splits/test.jsonl --output artifacts/experiment-001 --seed 42 --epochs 3 --batch-size 4
```

The output directory must be new. The runner:

1. Validates dataset provenance and split isolation.
2. Fits TF-IDF plus class-balanced logistic regression using only training data.
3. Scores the pinned upstream DeBERTa checkpoint.
4. Fine-tunes that checkpoint with PyTorch and Hugging Face Trainer for the declared
   fixed epoch budget, saving safetensors and tokenizer files.
5. Selects each model's threshold on validation and evaluates the test split with
   the selected threshold. If a model cannot meet the validation target, its report
   records `calibrationError`, uses the explicit 0.5 fallback for comparison, and
   does not produce a deployable calibration artifact.
6. Writes per-model JSON/HTML reports, `comparison.json`, calibration artifacts,
   and a manifest containing dataset hashes, seeds, hyperparameters, device, and
   library versions. Numeric baseline weights and vocabulary are saved without pickle.

Training uses overlapping 512-token windows. Positive training examples must fit
one window: annotate/localize the malicious span first rather than labeling benign
windows inside a long attack document as malicious. Validation and test retain full
documents and use the same maximum-window aggregation as the inference service.
No checkpoint selection or hyperparameter search uses test labels. GPU execution
is used when available; seed recording does not guarantee bit-identical GPU results.

To serve the resulting encoder locally:

```powershell
$env:AGENTGATE_THREAT_CHECKPOINT = "artifacts/experiment-001/checkpoint"
$env:AGENTGATE_THREAT_CALIBRATION = "artifacts/experiment-001/finetuned.calibration.json"
.\.venv-training\Scripts\python.exe services/threat/server.py
```

Only set the calibration path if that artifact was produced. The local service
loads safetensors without remote code, hashes the weight file, and verifies the
calibration identity. No checkpoint is automatically promoted into the app.

## Verify without downloading model weights

```powershell
py -3.12 -B -m unittest discover -s services/threat -p 'test_*.py'
```

These tests cover metrics, threshold selection, error accounting, leakage guards,
and HTML escaping. A meaningful accuracy comparison requires your licensed dataset
and a completed training run; the repository does not include fabricated results.

With training dependencies installed, an opt-in offline integration test creates a
tiny random BERT, trains it on synthetic smoke data, exports all three comparisons,
and reloads the resulting checkpoint and calibration artifact:

```powershell
$env:AGENTGATE_ML_SMOKE = "1"
$env:HF_HUB_OFFLINE = "1"
.\.venv-training\Scripts\python.exe -B -m unittest discover -s services/threat -p 'test_*.py'
```

This verifies the training/export/serving path without downloading weights. It is
not a benchmark or evidence that the production detector improved. Unset these
test environment variables before downloading a real checkpoint.

## Completed reproducible experiment — October 20, 2026

The [DeBERTa domain-adaptation experiment](../experiments/deberta-v1/README.md)
provides frozen data, a three-seed full-parameter run, TF-IDF and original-checkpoint
comparisons, validation-only threshold selection, and separate public diagnostics.
See the [complete results](../experiments/deberta-v1/results/REPORT.md) and
[STAR wording](../experiments/deberta-v1/results/STAR-resume-zh.md).

The domain corpus is AI-authored synthetic data: 480 examples from 60 contrast
families, split 288/96/96 with all variants of each family kept together. Public
diagnostics comprise 339 NotInject and 662 deepset examples. No public diagnostic
data is used for adaptation or threshold selection. Read the
[data card](../experiments/deberta-v1/DATA_CARD.md) for provenance, source-license
declarations, upstream-contamination uncertainty, and synthetic-data limitations.

Actual training used an RTX 3060 Laptop GPU. The included Colab notebook is a
syntax-checked reproduction entry point, not a claim of an executed Colab run.
All trained checkpoints remain experimental; the default detector is unchanged.
