# DeBERTa v2: validation-selected learning-rate follow-up

Real local GPU training and inference. This is an exploratory follow-up on the already observed v1 datasets, not a fresh blind benchmark.

## Direct answer

- Selected learning rate: `2e-05`. Domain F1 at validation-selected thresholds: **95.51%** (mean of seeds 42/43/44), versus **95.65%** for the original TF-IDF C=1 baseline (0.14 percentage points lower).
- Validation-selected TF-IDF C=0.1: **94.51%** domain F1. Both classical baselines are reported; neither is chosen using test results.
- Selected checkpoints matching the corresponding v1 weight hash: **3/3**. Matching hashes mean exact weight replication, not a newly improved model; this run still performs fresh evaluation inference.
- Selected DeBERTa mean recall **95.83%**, FPR **4.86%**. Test seeds exceeding the 5% FPR target: 2/3.
- Fixed-0.5 deepset F1: upstream **57.98%**, v1 fine-tuned mean **50.75%**, v2 mean **50.75%**. External data was not used for new selection, but its v1 regression motivated this experiment.
- Small numerical differences do not establish general superiority. Inspect the family bootstrap intervals, both thresholds, all seeds and external results below. No checkpoint is automatically promoted.

## Frozen design

- Same 480 synthetic variants from 60 authored contrast families; 288/96/96 train/validation/test with 36/12/12 families. No new data or relabeling.
- Full-parameter upstream ProtectAI DeBERTa-v3 injection-detector adaptation, three epochs per run; learning rates 5e-6, 1e-5, 2e-5 screened using seed 42.
- AdamW, weight decay 0.01, linear schedule, 10% warmup, BF16, gradient checkpointing, microbatch 1 and accumulation 8. Max length 512 and stride 64. No epoch selection.
- Threshold policy is unchanged from v1: maximize validation recall subject to empirical FPR <=5%, then precision, then higher threshold. This does not guarantee test FPR <=5%.
- Hyperparameters maximize validation-selected F1; ties favor lower validation log loss, then earlier candidate order. TF-IDF word unigrams/bigrams uses C=0.1,1,10 with the same rule.
- Freeze the LR using screening seed 42, then train seeds 43 and 44. The three-seed mean includes the screening seed and is not an independent confirmation. All screening validation results retained; unselected neural candidates are not tested.
- Model and threshold selection is locked before test/public prediction generation. Existing v1 results were already known: the reused test is exploratory, not pristine. No tuning after this run's test results.

## Validation search

| Candidate | Validation F1 | Recall | FPR | Log loss | Threshold |
|---|---:|---:|---:|---:|---:|
| tfidf-C0.1 | 87.64% | 81.25% | 4.17% | 0.660397 | 0.50782531 |
| tfidf-C1 | 79.52% | 68.75% | 4.17% | 0.539087 | 0.55172460 |
| tfidf-C10 | 79.52% | 68.75% | 4.17% | 0.407964 | 0.63749518 |
| deberta-lr5e-06-seed42 | 86.36% | 79.17% | 4.17% | 0.563854 | 0.98527133 |
| deberta-lr1e-05-seed42 | 90.91% | 83.33% | 0.00% | 0.457884 | 0.98967183 |
| deberta-lr2e-05-seed42 | 94.62% | 91.67% | 2.08% | 0.390316 | 0.36026394 |

## Every test and external result

NotInject contains 339 benign-only examples; attack F1 and recall are undefined. deepset has 662 labeled examples and is reported separately. Neither is guaranteed unseen by the upstream model.

### validation-selected

| Dataset | Model | N | TP / FN | FP / TN | F1 | Recall | FPR |
|---|---|---:|---:|---:|---:|---:|---:|
| domain-test | tfidf-C1 | 96 | 44 / 4 | 0 / 48 | 95.65% | 91.67% | 0.00% |
| deepset | tfidf-C1 | 662 | 89 / 174 | 39 / 360 | 45.52% | 33.84% | 9.77% |
| notinject | tfidf-C1 | 339 | 0 / 0 | 65 / 274 | n/a | n/a | 19.17% |
| domain-test | tfidf-C0.1 | 96 | 43 / 5 | 0 / 48 | 94.51% | 89.58% | 0.00% |
| deepset | tfidf-C0.1 | 662 | 101 / 162 | 44 / 355 | 49.51% | 38.40% | 11.03% |
| notinject | tfidf-C0.1 | 339 | 0 / 0 | 76 / 263 | n/a | n/a | 22.42% |
| domain-test | pretrained | 96 | 24 / 24 | 3 / 45 | 64.00% | 50.00% | 6.25% |
| deepset | pretrained | 662 | 52 / 211 | 0 / 399 | 33.02% | 19.77% | 0.00% |
| notinject | pretrained | 339 | 0 / 0 | 50 / 289 | n/a | n/a | 14.75% |
| domain-test | deberta-lr2e-05-seed42 | 96 | 46 / 2 | 3 / 45 | 94.85% | 95.83% | 6.25% |
| deepset | deberta-lr2e-05-seed42 | 662 | 92 / 171 | 1 / 398 | 51.69% | 34.98% | 0.25% |
| notinject | deberta-lr2e-05-seed42 | 339 | 0 / 0 | 41 / 298 | n/a | n/a | 12.09% |
| domain-test | deberta-lr2e-05-seed43 | 96 | 46 / 2 | 3 / 45 | 94.85% | 95.83% | 6.25% |
| deepset | deberta-lr2e-05-seed43 | 662 | 95 / 168 | 1 / 398 | 52.92% | 36.12% | 0.25% |
| notinject | deberta-lr2e-05-seed43 | 339 | 0 / 0 | 43 / 296 | n/a | n/a | 12.68% |
| domain-test | deberta-lr2e-05-seed44 | 96 | 46 / 2 | 1 / 47 | 96.84% | 95.83% | 2.08% |
| deepset | deberta-lr2e-05-seed44 | 662 | 88 / 175 | 0 / 399 | 50.14% | 33.46% | 0.00% |
| notinject | deberta-lr2e-05-seed44 | 339 | 0 / 0 | 41 / 298 | n/a | n/a | 12.09% |

### fixed-0.5

| Dataset | Model | N | TP / FN | FP / TN | F1 | Recall | FPR |
|---|---|---:|---:|---:|---:|---:|---:|
| domain-test | tfidf-C1 | 96 | 44 / 4 | 4 / 44 | 91.67% | 91.67% | 8.33% |
| deepset | tfidf-C1 | 662 | 122 / 141 | 78 / 321 | 52.70% | 46.39% | 19.55% |
| notinject | tfidf-C1 | 339 | 0 / 0 | 120 / 219 | n/a | n/a | 35.40% |
| domain-test | tfidf-C0.1 | 96 | 45 / 3 | 6 / 42 | 90.91% | 93.75% | 12.50% |
| deepset | tfidf-C0.1 | 662 | 123 / 140 | 79 / 320 | 52.90% | 46.77% | 19.80% |
| notinject | tfidf-C0.1 | 339 | 0 / 0 | 126 / 213 | n/a | n/a | 37.17% |
| domain-test | pretrained | 96 | 38 / 10 | 15 / 33 | 75.25% | 79.17% | 31.25% |
| deepset | pretrained | 662 | 109 / 154 | 4 / 395 | 57.98% | 41.44% | 1.00% |
| notinject | pretrained | 339 | 0 / 0 | 145 / 194 | n/a | n/a | 42.77% |
| domain-test | deberta-lr2e-05-seed42 | 96 | 46 / 2 | 3 / 45 | 94.85% | 95.83% | 6.25% |
| deepset | deberta-lr2e-05-seed42 | 662 | 90 / 173 | 1 / 398 | 50.85% | 34.22% | 0.25% |
| notinject | deberta-lr2e-05-seed42 | 339 | 0 / 0 | 39 / 300 | n/a | n/a | 11.50% |
| domain-test | deberta-lr2e-05-seed43 | 96 | 46 / 2 | 1 / 47 | 96.84% | 95.83% | 2.08% |
| deepset | deberta-lr2e-05-seed43 | 662 | 92 / 171 | 1 / 398 | 51.69% | 34.98% | 0.25% |
| notinject | deberta-lr2e-05-seed43 | 339 | 0 / 0 | 41 / 298 | n/a | n/a | 12.09% |
| domain-test | deberta-lr2e-05-seed44 | 96 | 46 / 2 | 1 / 47 | 96.84% | 95.83% | 2.08% |
| deepset | deberta-lr2e-05-seed44 | 662 | 87 / 176 | 0 / 399 | 49.71% | 33.08% | 0.00% |
| notinject | deberta-lr2e-05-seed44 | 339 | 0 / 0 | 38 / 301 | n/a | n/a | 11.21% |

## Three-seed averages

| Dataset | Threshold | Mean F1 | F1 min / max | Mean recall | Mean FPR |
|---|---|---:|---:|---:|---:|
| domain-test | validation-selected | 95.51% | 94.85% / 96.84% | 95.83% | 4.86% |
| domain-test | fixed-0.5 | 96.18% | 94.85% / 96.84% | 95.83% | 3.47% |
| deepset | validation-selected | 51.58% | 50.14% / 52.92% | 34.85% | 0.17% |
| deepset | fixed-0.5 | 50.75% | 49.71% / 51.69% | 34.09% | 0.17% |
| notinject | validation-selected | n/a | n/a | n/a | 12.29% |
| notinject | fixed-0.5 | n/a | n/a | n/a | 11.60% |

## Paired family bootstrap

5,000 paired resamples of all 12 test families, preserving all within-family variants and the same sampled families for every model. Seed variation is reported separately. These exploratory 95% percentile intervals do not account for previous test reuse or validation selection.

| Threshold | Baseline | DeBERTa mean minus baseline (pp) | 95% interval (pp) |
|---|---|---:|---:|
| validation-selected | tfidf-C1 | -0.14 | [-5.67, +8.55] |
| validation-selected | tfidf-C0.1 | +1.01 | [-4.60, +9.83] |
| fixed-0.5 | tfidf-C1 | +4.51 | [-1.40, +12.63] |
| fixed-0.5 | tfidf-C0.1 | +5.27 | [+0.81, +10.54] |

## Training evidence

| Run | Trainable parameters | Seconds | Peak allocated GiB | Final loss |
|---|---:|---:|---:|---:|
| deberta-lr1e-05-seed42 | 184,423,682 | 222.5 | 3.50 | 0.320622 |
| deberta-lr2e-05-seed42 | 184,423,682 | 257.3 | 3.50 | 0.221427 |
| deberta-lr2e-05-seed43 | 184,423,682 | 402.8 | 3.50 | 0.180495 |
| deberta-lr2e-05-seed44 | 184,423,682 | 294.6 | 3.50 | 0.231697 |
| deberta-lr5e-06-seed42 | 184,423,682 | 220.8 | 3.50 | 0.442816 |

## Interpretation and reproduction boundaries

- Historical v1 mean domain F1 was 95.51%. This run is an additional, disclosed experiment, not a replacement of the frozen v1 evidence.
- Public diagnostic regressions and test FPR target violations must accompany favorable domain numbers. A lower false-positive rate can coincide with missed attacks.
- This is a classifier experiment; results are not AgentGate agent attack-success rates or evidence that a deployed agent is safe.
- Only 12 test families and 12 validation families exist. Shared synthetic authoring style, within-family correlation and single-seed hyperparameter screening limit conclusions.
- Training and scoring use the pinned local checkpoint; no API requests or production/user data. Published files omit local account paths; large checkpoints remain local.
- `verify_results.py` replays thresholds, selection, provenance, chronology and metric tables using stored predictions. It does not retrain the model. Checkpoints and frozen data are required for GPU reproduction.
- Hardware: NVIDIA GeForce RTX 3060 Laptop GPU; PyTorch 2.8.0+cu128; Transformers 4.57.6. Fixed seeds do not guarantee cross-hardware bit identity.
