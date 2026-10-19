# AgentGate DeBERTa domain-adaptation experiment

Completed real training and inference on a small AI-authored synthetic domain dataset, with separate public diagnostics. This is not a production security validation.

## What the experiment found

- At the predeclared validation-selected operating points, domain recall changed from 50.00% to 95.83% (three-seed mean); FPR changed from 6.25% to 4.86%. Two seeds still exceed the 5% validation FPR target on test.
- TF-IDF remains a strong domain baseline: F1 95.65%, versus fine-tuned mean 95.51%. The neural model does not establish an F1 advantage over this simpler baseline on the small domain test.
- At the common fixed 0.5 threshold, domain recall changed from 79.17% to 95.83%, while FPR fell from 31.25% to 3.47%. NotInject FPR fell from 42.77% to 11.60%.
- The same fixed-threshold comparison exposes a regression on deepset: F1 fell from 57.98% to 50.75%, and recall fell from 41.44% to 34.09%. Do not present the calibrated-threshold gains as universal model improvement.
- Conclusion: the experiment demonstrates domain adaptation and reduced over-defense, with a measurable external-detection tradeoff. Keep the detector advisory and experimental; no deployment promotion is justified by these results alone.

## Protocol and provenance

- Hardware: NVIDIA GeForce RTX 3060 Laptop GPU; PyTorch 2.8.0+cu128; Transformers 4.57.6.
- Initialization: Protect AI DeBERTa-v3-base prompt-injection-v2, revision `90c9989b1a342275dd0d1a95aad283c04e075671`.
- Full-parameter fine-tuning: 3 epochs; learning rate 2e-5; AdamW, weight decay 0.01; linear schedule, 10% warmup; microbatch 1, accumulation 8; BF16 and gradient checkpointing; dynamic padding, 512-token maximum, 64-token overlap.
- Seeds: 42, 43, 44. Final epoch fixed in advance; every seed reported. No best-seed selection.
- Domain data: 480 AI-authored synthetic examples / 60 contrast families; 288 train, 96 validation, 96 test; 36/12/12 families. Context variants are correlated, not independent samples.
- Each model's operating threshold is selected on the same domain validation set for maximum recall at empirical FPR <= 5%. This is not a test-set guarantee or probability calibration.
- All seeds and thresholds completed before held-out scoring. See `training-complete-before-test.json` and `events.log`.
- No external examples were used for optimization or threshold selection. Overlap with upstream checkpoint training cannot be ruled out.

## Measured results at validation-selected thresholds

| Dataset | Model | N | TP / FN | FP / TN | Recall | FPR | F1 | p95 ms | Errors |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| domain-test | tfidf | 96 | 44 / 4 | 0 / 48 | 91.67% | 0.00% | 95.65% | 0.68 | 0 |
| notinject | tfidf | 339 | 0 / 0 | 65 / 274 | n/a | 19.17% | n/a (benign only) | 0.59 | 0 |
| deepset | tfidf | 662 | 89 / 174 | 39 / 360 | 33.84% | 9.77% | 45.52% | 0.90 | 0 |
| domain-test | pretrained | 96 | 24 / 24 | 3 / 45 | 50.00% | 6.25% | 64.00% | 35.47 | 0 |
| notinject | pretrained | 339 | 0 / 0 | 50 / 289 | n/a | 14.75% | n/a (benign only) | 30.88 | 0 |
| deepset | pretrained | 662 | 52 / 211 | 0 / 399 | 19.77% | 0.00% | 33.02% | 28.29 | 0 |
| domain-test | finetuned-seed42 | 96 | 46 / 2 | 3 / 45 | 95.83% | 6.25% | 94.85% | 31.16 | 0 |
| notinject | finetuned-seed42 | 339 | 0 / 0 | 41 / 298 | n/a | 12.09% | n/a (benign only) | 34.74 | 0 |
| deepset | finetuned-seed42 | 662 | 92 / 171 | 1 / 398 | 34.98% | 0.25% | 51.69% | 55.26 | 0 |
| domain-test | finetuned-seed43 | 96 | 46 / 2 | 3 / 45 | 95.83% | 6.25% | 94.85% | 34.77 | 0 |
| notinject | finetuned-seed43 | 339 | 0 / 0 | 43 / 296 | n/a | 12.68% | n/a (benign only) | 36.85 | 0 |
| deepset | finetuned-seed43 | 662 | 95 / 168 | 1 / 398 | 36.12% | 0.25% | 52.92% | 37.76 | 0 |
| domain-test | finetuned-seed44 | 96 | 46 / 2 | 1 / 47 | 95.83% | 2.08% | 96.84% | 49.19 | 0 |
| notinject | finetuned-seed44 | 339 | 0 / 0 | 41 / 298 | n/a | 12.09% | n/a (benign only) | 47.56 | 0 |
| deepset | finetuned-seed44 | 662 | 88 / 175 | 0 / 399 | 33.46% | 0.00% | 50.14% | 41.39 | 0 |

## Fixed 0.5 threshold comparison

This distinguishes weight adaptation from changes in the selected operating threshold.

| Dataset | Model | Recall | FPR | F1 |
|---|---|---:|---:|---:|
| domain-test | tfidf | 91.67% | 8.33% | 91.67% |
| notinject | tfidf | n/a | 35.40% | n/a |
| deepset | tfidf | 46.39% | 19.55% | 52.70% |
| domain-test | pretrained | 79.17% | 31.25% | 75.25% |
| notinject | pretrained | n/a | 42.77% | n/a |
| deepset | pretrained | 41.44% | 1.00% | 57.98% |
| domain-test | finetuned-seed42 | 95.83% | 6.25% | 94.85% |
| notinject | finetuned-seed42 | n/a | 11.50% | n/a |
| deepset | finetuned-seed42 | 34.22% | 0.25% | 50.85% |
| domain-test | finetuned-seed43 | 95.83% | 2.08% | 96.84% |
| notinject | finetuned-seed43 | n/a | 12.09% | n/a |
| deepset | finetuned-seed43 | 34.98% | 0.25% | 51.69% |
| domain-test | finetuned-seed44 | 95.83% | 2.08% | 96.84% |
| notinject | finetuned-seed44 | n/a | 11.21% | n/a |
| deepset | finetuned-seed44 | 33.08% | 0.00% | 49.71% |

## Training evidence

| Seed | Parameters trained | Seconds | Peak allocated GPU GiB | Final training loss |
|---|---:|---:|---:|---:|
| 42 | 184,423,682 | 197.3 | 3.50 | 0.221427 |
| 43 | 184,423,682 | 203.8 | 3.50 | 0.180495 |
| 44 | 184,423,682 | 174.6 | 3.50 | 0.231697 |

## Interpretation boundaries

- Report domain gains together with any public-dataset regressions. Do not select whichever threshold or seed looks best after seeing test results.
- The domain test contains only 12 independent contrast families. `aggregate.json` reports paired family-cluster bootstrap intervals and seed spread separately. A zero-width empirical interval at perfect accuracy is not proof of certainty.
- NotInject is entirely benign: only false-positive performance is assessed there. Its F1/recall are not meaningful attack-detection measures.
- deepset's original train and test partitions are both external diagnostics here; neither was used to train this adaptation. Original source labels are retained. Read `DATA_CARD.md` for license-field ambiguity and provenance.
- Latency is serial warmed FP32 GPU inference including tokenization and transfer, with CUDA synchronization. It excludes model loading, HTTP, orchestration, and concurrent load; TF-IDF runs on CPU. This is not deployed service latency.
- Detection is advisory in AgentGate. These numbers are not agent attack-success rates, execution-blocking rates, or measured business impact.
- No automatic checkpoint promotion has occurred. Review external regressions before deployment.

## Evidence files

`comparison.json` and `comparison.csv`: complete metrics for all five models at both thresholds. Each model directory contains per-example JSON and escaped offline HTML reports, validation selection, and (for fine-tuned runs) weights and training logs. Dataset/model/code hashes, environment lock, and chronology are retained.
