# DeBERTa in the agent pipeline: controlled comparison

All three arms use the same gateway, scripted reviewer, agent models, paired tasks and generation settings. Only detector-mediated input filtering changes.

## Results

| Model | Detector | Clean task success | Attacked task success | Attacker success | Clean episodes with false alarms | Mean / median / p95 seconds | Detector seconds/episode | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pooled | none | 10/20 (50.0%) | 5/20 (25.0%) | 2/20 (10.0%) | 0/20 (0.0%) | 1.76 / 1.06 / 5.23 | 0.00 | 0 |
| pooled | upstream | 10/20 (50.0%) | 2/20 (10.0%) | 2/20 (10.0%) | 3/20 (15.0%) | 2.17 / 1.24 / 7.72 | 0.34 | 0 |
| pooled | finetuned | 10/20 (50.0%) | 3/20 (15.0%) | 0/20 (0.0%) | 0/20 (0.0%) | 1.96 / 1.15 / 5.34 | 0.31 | 0 |
| qwen3:1.7b | none | 7/10 (70.0%) | 3/10 (30.0%) | 1/10 (10.0%) | 0/10 (0.0%) | 1.72 / 0.86 / 7.90 | 0.00 | 0 |
| qwen3:1.7b | upstream | 7/10 (70.0%) | 2/10 (20.0%) | 1/10 (10.0%) | 1/10 (10.0%) | 1.82 / 1.00 / 7.72 | 0.30 | 0 |
| qwen3:1.7b | finetuned | 7/10 (70.0%) | 2/10 (20.0%) | 0/10 (0.0%) | 0/10 (0.0%) | 1.46 / 0.78 / 1.94 | 0.31 | 0 |
| llama3.2:3b | none | 3/10 (30.0%) | 2/10 (20.0%) | 1/10 (10.0%) | 0/10 (0.0%) | 1.80 / 1.13 / 5.20 | 0.00 | 0 |
| llama3.2:3b | upstream | 3/10 (30.0%) | 0/10 (0.0%) | 1/10 (10.0%) | 2/10 (20.0%) | 2.51 / 1.39 / 5.35 | 0.38 | 0 |
| llama3.2:3b | finetuned | 3/10 (30.0%) | 1/10 (10.0%) | 0/10 (0.0%) | 0/10 (0.0%) | 2.47 / 1.24 / 5.34 | 0.31 | 0 |

## False-alarm and exposure detail

| Model | Detector | Blocked clean source presentations | Attacked episodes with model exposure | Detector errors |
| --- | --- | --- | --- | --- |
| pooled | none | 0/41 (0.0%) | 17/20 (85.0%) | 0 |
| pooled | upstream | 9/39 (23.1%) | 9/20 (45.0%) | 0 |
| pooled | finetuned | 0/35 (0.0%) | 4/20 (20.0%) | 0 |
| qwen3:1.7b | none | 0/24 (0.0%) | 10/10 (100.0%) | 0 |
| qwen3:1.7b | upstream | 1/18 (5.6%) | 6/10 (60.0%) | 0 |
| qwen3:1.7b | finetuned | 0/18 (0.0%) | 3/10 (30.0%) | 0 |
| llama3.2:3b | none | 0/17 (0.0%) | 7/10 (70.0%) | 0 |
| llama3.2:3b | upstream | 8/21 (38.1%) | 3/10 (30.0%) | 0 |
| llama3.2:3b | finetuned | 0/17 (0.0%) | 1/10 (10.0%) | 0 |

## Fixed design and interpretation

- 10 known pilot families × clean/attacked × two models × three detector arms = 120 episodes, one run per cell. These are reused authored scenarios, not a new independent test set.
- Upstream and fine-tuned thresholds are the previously selected validation operating points. Fine-tuned seed 42 was chosen before this comparison; this is not a three-seed agent result.
- A flagged catalog/brief response is withheld in full. RAG filters individual passages and their citations. No replacement facts are invented. The model may continue using the same remaining turn budget.
- False alarms are flagged normal-source presentations in clean runs; repeated presentations are not independent samples. The episode metric uses every clean run as its denominator, including runs that never accessed a source.
- Detector failures stop inference and remain in task/attack denominators. They are reported separately from positive classifications.
- Attack exposure and citations count only content in actual model requests after filtering. Independent task/attack checks use final sandbox effects and answers.
- Detector models run on CPU float32 with four threads and warmup; agent/embedding inference uses local Ollama. End-to-end timings include model loads, cache effects, retrieval, and differing trajectory lengths. These are hardware-specific observations, not an isolated neural-model speed benchmark.
- A lower attacker-success rate can coexist with lower task success if useful evidence is withheld. The gateway and scripted review remain enabled even in the no-detector arm.

## Paired task changes against no detector

- upstream: 0 task gains, 3 task losses; 0 prevented attacker outcomes, 0 newly successful attacker outcomes.
- finetuned: 0 task gains, 2 task losses; 2 prevented attacker outcomes, 0 newly successful attacker outcomes.

## Termination accounting

| Detector | Completed | Turn limit | Timeout | Inference/execution error | Detector error |
| --- | --- | --- | --- | --- | --- |
| none | 38 | 2 | 0 | 0 | 0 |
| upstream | 36 | 4 | 0 | 0 | 0 |
| finetuned | 36 | 4 | 0 | 0 | 0 |

Completed means the model produced a final turn, not that the task succeeded. Turn-limit failures remain in all task/attack denominators; the Errors column above counts service/execution failures and timeouts.
