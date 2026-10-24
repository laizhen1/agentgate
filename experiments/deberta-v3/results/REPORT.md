# DeBERTa v3: expanded families and fresh held-out comparison

Actual local GPU training and inference. Dataset and fitting protocol committed before training in `fce251bfc5bc2b20d1f48a1aa4b618c775f69963`. Frozen v1/v2 evidence remains unchanged.

## Direct answer

DeBERTa beats validation-selected TF-IDF on this fresh synthetic test, with a paired family-bootstrap interval excluding zero. This does not establish real-world or cross-domain superiority.

- Primary, validation-selected thresholds: **96.54%** DeBERTa mean F1 (seeds 42/43/44) versus **82.35%** for `tfidf-union-C10`. Difference **+14.19 pp**, paired-family 95% interval **[+7.07, +22.76] pp**.
- Original-style word C=1 baseline refit on the same data: **83.72%** F1. Both baselines are disclosed; neither was selected by test score.
- DeBERTa mean recall **97.22%**, FPR **4.17%**. Seeds exceeding the 5% test-FPR target: **1/3**. Validation's empirical constraint is not a test guarantee.
- Fixed-0.5 deepset F1: upstream **57.98%**, adapted mean **60.43%**. Recall: upstream **41.44%**, adapted **44.23%**.
- That external mean conceals substantial seed variation: deepset F1 ranges **52.25%–73.93%**, and **2/3 seeds underperform upstream**. Do not present the best seed or the mean alone as consistent cross-domain improvement.
- No checkpoint is promoted to the default detector. Classifier results are not agent attack-success rates.

## Data and frozen design

- Added 240 original AI-authored contrast families across eight procurement categories, one benign and one attack text each. No new wrapper expansion.
- New families split 144/48/48. Training also retains 72 unwrapped texts from 36 old training families; old validation/test are excluded. Totals: **360/96/96 texts**, **180/48/48 families**.
- Training families increased fivefold (36 to 180) and test families fourfold (12 to 48). This is not a controlled data-size ablation: authoring, wrapper removal, learning-rate grid and baseline features also changed.
- The test is new to fitting/selection, but authors saw its texts during construction. AI labels, shared style and attack concepts, short fragments and limited multilingual examples restrict generalization. No independent human annotation or production evaluation.
- Domain splits are balanced at 50% attacks. Deployment precision depends on the actual attack prevalence; these F1 values are not estimates for natural procurement traffic.
- Cross-split normalized exact and character-5-gram overlap checks passed at the frozen 0.65 Jaccard threshold, including comparisons with old holdouts and public diagnostics. This is not proof of semantic novelty or absence from upstream pretraining.
- Full-parameter adaptation of the upstream ProtectAI DeBERTa-v3 detector: 184,423,682 trainable parameters, revision `90c9989b1a342275dd0d1a95aad283c04e075671`. Each run starts from upstream, not the old adapted checkpoint.
- Learning rates 1e-5, 2e-5, 5e-5 screened with seed 42; selected **5e-05**. Three epochs, AdamW, weight decay 0.01, linear schedule, 10% warmup, BF16, gradient checkpointing, microbatch 1 × accumulation 8, max length 512 and stride 64. All training texts fit one window.
- TF-IDF: word uni/bigrams, character-within-word 3–5-grams, or concatenation; C=0.1/1/10 for each. Balanced logistic regression, seed 42. Nine cheap classical candidates versus three neural learning rates, not equal compute.
- Same selection endpoint: maximum validation recall at FPR <=5%, ties use precision then higher threshold; hyperparameters maximize validation F1, then lower log loss, then grid order. Final epoch only, no best-epoch search.
- Freeze LR before training seeds 43/44. The mean includes screening seed 42; it is not three independent validation searches. Lock all models/thresholds before test/public predictions. No post-test tuning or best-test-seed selection.

## All screening validation results

| Candidate | F1 | Recall | FPR | Log loss | Threshold |
|---|---:|---:|---:|---:|---:|
| tfidf-word-C0.1 | 90.11% | 85.42% | 4.17% | 0.669225 | 0.50623423 |
| tfidf-word-C1 | 90.11% | 85.42% | 4.17% | 0.543314 | 0.55005716 |
| tfidf-word-C10 | 90.11% | 85.42% | 4.17% | 0.358594 | 0.64590279 |
| tfidf-char-C0.1 | 78.05% | 66.67% | 4.17% | 0.667445 | 0.51105834 |
| tfidf-char-C1 | 76.92% | 62.50% | 0.00% | 0.536262 | 0.59179445 |
| tfidf-char-C10 | 91.30% | 87.50% | 4.17% | 0.336939 | 0.60467790 |
| tfidf-union-C0.1 | 86.36% | 79.17% | 4.17% | 0.646500 | 0.51576866 |
| tfidf-union-C1 | 90.11% | 85.42% | 4.17% | 0.470887 | 0.57584169 |
| tfidf-union-C10 | 92.47% | 89.58% | 4.17% | 0.304232 | 0.63303586 |
| deberta-lr1e-05-seed42 | 83.72% | 75.00% | 4.17% | 0.307369 | 0.93674946 |
| deberta-lr2e-05-seed42 | 95.83% | 95.83% | 4.17% | 0.276212 | 0.38699511 |
| deberta-lr5e-05-seed42 | 97.96% | 100.00% | 4.17% | 0.112263 | 0.76977324 |

### Locked operating thresholds, including both additional seeds

| Selected model | Validation threshold | Validation F1 | Validation FPR |
|---|---:|---:|---:|
| tfidf-word-C1 | 0.55005716 | 90.11% | 4.17% |
| tfidf-union-C10 | 0.63303586 | 92.47% | 4.17% |
| pretrained | 0.99996448 | 41.27% | 4.17% |
| deberta-lr5e-05-seed42 | 0.76977324 | 97.96% | 4.17% |
| deberta-lr5e-05-seed43 | 0.05146277 | 98.97% | 2.08% |
| deberta-lr5e-05-seed44 | 0.99771273 | 97.96% | 4.17% |

## Every test and external result

deepset has 662 labelled examples. NotInject has 339 benign-only examples, so attack recall/F1 are undefined. Both diagnostics are unchanged and unused for fitting/selection. Their earlier results were known; upstream pretraining overlap is unknown. Do not pool them as a 1,001-example F1 test.

### validation-selected

| Dataset | Model | N | TP / FN | FP / TN | F1 | Recall | FPR |
|---|---|---:|---:|---:|---:|---:|---:|
| domain-test | tfidf-word-C1 | 96 | 36 / 12 | 2 / 46 | 83.72% | 75.00% | 4.17% |
| deepset | tfidf-word-C1 | 662 | 61 / 202 | 20 / 379 | 35.47% | 23.19% | 5.01% |
| notinject | tfidf-word-C1 | 339 | 0 / 0 | 81 / 258 | n/a | n/a | 23.89% |
| domain-test | tfidf-union-C10 | 96 | 35 / 13 | 2 / 46 | 82.35% | 72.92% | 4.17% |
| deepset | tfidf-union-C10 | 662 | 63 / 200 | 18 / 381 | 36.63% | 23.95% | 4.51% |
| notinject | tfidf-union-C10 | 339 | 0 / 0 | 74 / 265 | n/a | n/a | 21.83% |
| domain-test | pretrained | 96 | 11 / 37 | 1 / 47 | 36.67% | 22.92% | 2.08% |
| deepset | pretrained | 662 | 49 / 214 | 0 / 399 | 31.41% | 18.63% | 0.00% |
| notinject | pretrained | 339 | 0 / 0 | 44 / 295 | n/a | n/a | 12.98% |
| domain-test | deberta-lr5e-05-seed42 | 96 | 45 / 3 | 2 / 46 | 94.74% | 93.75% | 4.17% |
| deepset | deberta-lr5e-05-seed42 | 662 | 96 / 167 | 0 / 399 | 53.48% | 36.50% | 0.00% |
| notinject | deberta-lr5e-05-seed42 | 339 | 0 / 0 | 28 / 311 | n/a | n/a | 8.26% |
| domain-test | deberta-lr5e-05-seed43 | 96 | 47 / 1 | 3 / 45 | 95.92% | 97.92% | 6.25% |
| deepset | deberta-lr5e-05-seed43 | 662 | 107 / 156 | 0 / 399 | 57.84% | 40.68% | 0.00% |
| notinject | deberta-lr5e-05-seed43 | 339 | 0 / 0 | 37 / 302 | n/a | n/a | 10.91% |
| domain-test | deberta-lr5e-05-seed44 | 96 | 48 / 0 | 1 / 47 | 98.97% | 100.00% | 2.08% |
| deepset | deberta-lr5e-05-seed44 | 662 | 71 / 192 | 0 / 399 | 42.51% | 27.00% | 0.00% |
| notinject | deberta-lr5e-05-seed44 | 339 | 0 / 0 | 28 / 311 | n/a | n/a | 8.26% |

### fixed-0.5

| Dataset | Model | N | TP / FN | FP / TN | F1 | Recall | FPR |
|---|---|---:|---:|---:|---:|---:|---:|
| domain-test | tfidf-word-C1 | 96 | 43 / 5 | 10 / 38 | 85.15% | 89.58% | 20.83% |
| deepset | tfidf-word-C1 | 662 | 101 / 162 | 50 / 349 | 48.79% | 38.40% | 12.53% |
| notinject | tfidf-word-C1 | 339 | 0 / 0 | 134 / 205 | n/a | n/a | 39.53% |
| domain-test | tfidf-union-C10 | 96 | 42 / 6 | 5 / 43 | 88.42% | 87.50% | 10.42% |
| deepset | tfidf-union-C10 | 662 | 109 / 154 | 40 / 359 | 52.91% | 41.44% | 10.03% |
| notinject | tfidf-union-C10 | 339 | 0 / 0 | 120 / 219 | n/a | n/a | 35.40% |
| domain-test | pretrained | 96 | 23 / 25 | 9 / 39 | 57.50% | 47.92% | 18.75% |
| deepset | pretrained | 662 | 109 / 154 | 4 / 395 | 57.98% | 41.44% | 1.00% |
| notinject | pretrained | 339 | 0 / 0 | 145 / 194 | n/a | n/a | 42.77% |
| domain-test | deberta-lr5e-05-seed42 | 96 | 47 / 1 | 2 / 46 | 96.91% | 97.92% | 4.17% |
| deepset | deberta-lr5e-05-seed42 | 662 | 100 / 163 | 0 / 399 | 55.10% | 38.02% | 0.00% |
| notinject | deberta-lr5e-05-seed42 | 339 | 0 / 0 | 32 / 307 | n/a | n/a | 9.44% |
| domain-test | deberta-lr5e-05-seed43 | 96 | 44 / 4 | 2 / 46 | 93.62% | 91.67% | 4.17% |
| deepset | deberta-lr5e-05-seed43 | 662 | 93 / 170 | 0 / 399 | 52.25% | 35.36% | 0.00% |
| notinject | deberta-lr5e-05-seed43 | 339 | 0 / 0 | 29 / 310 | n/a | n/a | 8.55% |
| domain-test | deberta-lr5e-05-seed44 | 96 | 48 / 0 | 5 / 43 | 95.05% | 100.00% | 10.42% |
| deepset | deberta-lr5e-05-seed44 | 662 | 156 / 107 | 3 / 396 | 73.93% | 59.32% | 0.75% |
| notinject | deberta-lr5e-05-seed44 | 339 | 0 / 0 | 70 / 269 | n/a | n/a | 20.65% |

## Seed variability

| Dataset | Threshold | Mean F1 | F1 min / max | F1 SD (pp) | Mean recall | Mean FPR |
|---|---|---:|---:|---:|---:|---:|
| domain-test | validation-selected | 96.54% | 94.74% / 98.97% | 2.18 | 97.22% | 4.17% |
| domain-test | fixed-0.5 | 95.19% | 93.62% / 96.91% | 1.65 | 96.53% | 6.25% |
| deepset | validation-selected | 51.28% | 42.51% / 57.84% | 7.90 | 34.73% | 0.00% |
| deepset | fixed-0.5 | 60.43% | 52.25% / 73.93% | 11.78 | 44.23% | 0.25% |
| notinject | validation-selected | n/a | n/a | n/a | n/a | 9.14% |
| notinject | fixed-0.5 | n/a | n/a | n/a | n/a | 12.88% |

## Fresh-test error slices

Each category has only six held-out pairs (12 texts). These slices are descriptive, not grounds for another model-selection round.

| Category | TF-IDF F1 | DeBERTa mean F1 | TF-IDF FPR | DeBERTa mean FPR |
|---|---:|---:|---:|---:|
| audit_workflow | 90.91% | 90.30% | 0.00% | 0.00% |
| authority | 85.71% | 100.00% | 33.33% | 0.00% |
| exfiltration | 80.00% | 92.67% | 0.00% | 16.67% |
| memory_task | 90.91% | 100.00% | 0.00% | 0.00% |
| obfuscation_language | 66.67% | 89.32% | 0.00% | 16.67% |
| procurement | 80.00% | 100.00% | 0.00% | 0.00% |
| retrieval | 66.67% | 100.00% | 0.00% | 0.00% |
| tool_boundary | 90.91% | 100.00% | 0.00% | 0.00% |

All three DeBERTa seeds wrong at their selected thresholds: 1 texts. IDs: `v3-obfuscation_language-11-0`.
Of those, selected TF-IDF is correct on 1: `v3-obfuscation_language-11-0`.
Inspect the saved text/probability/outcome records for these cases. No labels, thresholds or models were changed in response to this error inspection.

## Paired family uncertainty

Paired bootstrap of 48 newly held-out synthetic families, not 96 independent scenarios. Intervals exclude author/style bias and validation-selection uncertainty. All labels are AI-authored, without independent human validation. Seeds do not add independent test cases.
 Five thousand paired bootstrap resamples preserve both texts in each family and use the same draws for every model. The calculation uses Python `random.Random(20261024)`.

| Threshold | Baseline | DeBERTa mean minus baseline (pp) | 95% interval (pp) |
|---|---|---:|---:|
| validation-selected | tfidf-word-C1 | +12.82 | [+6.13, +20.78] |
| validation-selected | tfidf-union-C10 | +14.19 | [+7.07, +22.76] |
| fixed-0.5 | tfidf-word-C1 | +10.04 | [+3.52, +16.48] |
| fixed-0.5 | tfidf-union-C10 | +6.77 | [+1.55, +12.45] |

## Training evidence

| Run | Parameters | Seconds | Peak allocated GiB | Mean training loss |
|---|---:|---:|---:|---:|---:|
| deberta-lr1e-05-seed42 | 184,423,682 | 436.3 | 3.50 | 0.541205 |
| deberta-lr2e-05-seed42 | 184,423,682 | 273.6 | 3.50 | 0.369615 |
| deberta-lr5e-05-seed42 | 184,423,682 | 244.7 | 3.50 | 0.262112 |
| deberta-lr5e-05-seed43 | 184,423,682 | 211.7 | 3.50 | 0.311368 |
| deberta-lr5e-05-seed44 | 184,423,682 | 200.7 | 3.50 | 0.278258 |

## Reproduction boundaries

- `comparison.csv` contains every confusion matrix; per-model JSON contains predictions and slices for error inspection. `aggregate.json` includes per-seed and mean bootstrap comparisons.
- `verify_results.py` replays code/data hashes, candidate rankings, thresholds, chronology, prediction identity, metric tables, seed statistics and bootstrap intervals. It does not rerun GPU training.
- Public evidence omits account paths, credentials and weights. Training uses local synthetic inputs and offline models; no real buyer or supplier records.
- Hardware: NVIDIA GeForce RTX 3060 Laptop GPU; PyTorch 2.8.0+cu128; Transformers 4.57.6. GPU sharing and temperature affect timings; no controlled speed claim. Fixed seeds do not guarantee cross-hardware bit identity.
