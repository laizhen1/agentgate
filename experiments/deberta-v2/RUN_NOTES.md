# Local run notes

- Run date: 2026-10-24, Pacific/Auckland. Machine-readable timestamps use UTC.
- Used the existing isolated Python 3.12 environment and pinned local v1 model
  files. No cloud training, API keys, new packages, or external training data.
- The initial manifest hashes the protocol and training/metric code before
  fitting. Source commit `b3b47d35fa722657961a7fc354cb0745b37e5759` was made while
  training was underway and before v2 evaluation. It is not evidence that the
  v1 test was unseen; the protocol explicitly discloses prior knowledge of v1.
- Completed the three planned learning-rate candidates with seed 42. Validation
  selected LR=2e-5 and TF-IDF C=0.1. The LR choice was saved before seeds 43 and 44
  were trained. All five training runs completed without runtime failure.
- This selected neural configuration is the same as v1. A lower learning rate
  was a hypothesis that failed this validation search, not an established method
  improvement. Both the original C=1 and validation-selected TF-IDF are retained.
- After training, all three selected checkpoint weight hashes matched their v1
  counterparts exactly. These are real retraining runs that reproduce the old
  weights, not newly improved models. Evaluation still runs fresh inference;
  the pipeline does not substitute v1 predictions for new scoring.
- Hardware: NVIDIA RTX 3060 Laptop GPU, 6 GB. Shared GPU activity and thermal
  conditions varied during the run. Training durations are execution evidence,
  not controlled speed comparisons between learning rates or seeds.
- Scikit-learn/SciPy emitted an ignored `iprint` solver-option warning, as in v1.
  The runner explicitly checked the iteration limit; no convergence-limit
  failure was reported.
- The selection lock binds validation predictions, thresholds, hyperparameter
  ranking and training records before evaluation begins. Model files are checked
  against their selected hashes before inference. Large checkpoints stay local;
  public evidence contains no local account paths or trainer directory dumps.
- The v1 files and the separate agent benchmark are unchanged. No checkpoint was
  installed as the default detector, and no real user or procurement data was used.

See `results/REPORT.md` for all measured outcomes. The new test/public scores
cannot be used to justify another tuning pass under this same protocol.
