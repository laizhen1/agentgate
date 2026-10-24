# Execution notes

- The fitting inputs and protocol were committed as `fce251bfc5bc2b20d1f48a1aa4b618c775f69963` before GPU training. That commit was pushed before candidate selection or fresh-test inference completed. Its GitHub quality run passed.
- The existing local CUDA environment and pinned upstream checkpoint were reused. Model weights stay outside the public repository. Training starts each candidate from upstream, not from a prior fine-tuned checkpoint.
- All seven generated data/audit/manifest files were rebuilt into a separate destination and matched the checked-in bytes exactly.
- The local machine was shared with another GPU workload. Timings and peak allocations describe these runs, not a controlled throughput or model-speed comparison. No unrelated process was stopped.
- The installed SciPy/scikit-learn combination printed an `Unknown solver options: iprint` optimization warning. The ignored output-control option did not stop fitting; the runner explicitly checks that every logistic-regression solver converges before proceeding.
- Training's console logger buffered step messages until a flush; structured training logs and elapsed times are retained in each candidate's `training.json`. Missing live console messages did not imply missing steps.
- Report/verification helpers were developed while fitting ran. They do not change the frozen training inputs, candidate grid, selection criterion or checkpoints. All public metrics are recalculated from saved predictions.
- New synthetic examples use invented records and reserved example domains. Privacy pattern checks supplement manual review; they cannot certify the absence of every possible identifying string or remove GitHub's previously cached unreachable historical commits.
