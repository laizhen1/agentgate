# Detector-in-the-loop experiment

This directory contains a 120-episode primary comparison and a separately retained
120-episode supplementary run. Each run covers the same ten known task families,
two conditions, two agent models, and three detector arms. The runs do not add
independent task families and are not pooled into one accuracy estimate.

- [Primary report](REPORT.md): full repeat after build, reference and HTTP/API
  checks finished. This run was designated for latency reporting before it began.
- [Supplementary report](supplementary/REPORT.md): first complete run, partly
  concurrent with local build/check workloads.
- Both runs preserve all completed and incomplete episodes, model/source identities,
  original and filtered source records, trajectories, and outcome checks.
- Models, thresholds, source, prompts, task definitions, and schedule were unchanged
  between runs. No detector was retrained and no benchmark result was used to
  select a checkpoint or threshold.
- CPU detector models remained loaded and warmed between runs. The retrieval
  service's embedding cache was also retained. Model and embedding loads/cache
  effects therefore remain part of the latency interpretation.

The earlier two development attempts are separate: the first was stopped after
sandbox-related runtime failures; the second completed all 12 DEV combinations
without service errors. Neither contributes to either 120-episode report.

The no-detector arm still uses the gateway and scripted reviewer. A zero observed
attacker count in a detector arm is a result on these authored tasks, not a claim
of universal attack prevention.

See [protocol and reproduction instructions](../../docs/detector-comparison.md).
