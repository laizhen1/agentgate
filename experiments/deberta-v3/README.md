# DeBERTa v3: more training families and a fresh synthetic test

This experiment compares full-parameter adaptation of the pinned ProtectAI DeBERTa-v3 detector with a validation-tuned TF-IDF/logistic-regression baseline. It adds 240 original contrast families, removes old training wrappers, and reserves new test families before fitting. See [protocol.json](protocol.json) and [DATA_CARD.md](DATA_CARD.md) for the assumptions and limitations. Previous experiments remain unchanged.

Training uses 360 distinct texts from 180 families. Validation and fresh test each use 96 texts from 48 new families. Nine word/character/combined TF-IDF configurations receive the same validation endpoint as three neural learning-rate candidates. The selected neural learning rate is repeated with seeds 43/44 after screening seed 42. Every selected seed, both threshold policies, and both existing public diagnostics are reported; no default detector is automatically replaced.

## Reproduce

Use Python 3.12 and the pinned [requirements](requirements.txt), a CUDA GPU with BF16 support, and the v1 pinned local `base-model` and source manifest. Paths below are relative to the repository root. Large model weights are not committed.

```bash
# Optional: rebuild data into a NEW destination; training uses checked-in data.
python experiments/deberta-v3/prepare_data.py --source experiments/deberta-v1 --destination /tmp/agentgate-v3-data
python -m unittest discover -s experiments/deberta-v3 -p test_protocol.py
python experiments/deberta-v3/run_experiment.py --source experiments/deberta-v1 --output /tmp/agentgate-v3-run --stage select
python experiments/deberta-v3/run_experiment.py --source experiments/deberta-v1 --output /tmp/agentgate-v3-run --stage evaluate
```

The runner reads frozen data adjacent to its source, verifies hashes, and refuses changed provenance. Evaluation requires a completed selection lock. An explicit `--resume` can continue completed stages with identical inputs; interrupted training candidates restart from the pinned base model and seed. GPU execution need not be bit-identical across platforms.

Use the checked-in `families.json` and data bytes for training. The original builder uses platform newline conventions: a Windows rebuild matched all seven files byte-for-byte; another platform can produce different line endings and file hashes even with identical decoded examples. An optional rebuild does not replace the frozen inputs. Run the authoring script only in an isolated copy if inspecting how the pairs were assembled.

This is an AI classifier experiment, separate from the 120-episode agent benchmark. It is not evidence that a deployed agent is universally safe.

## Measured result and evidence

See [the full comparison](results/REPORT.md), [CSV metrics](results/comparison.csv),
[seed statistics and paired intervals](results/aggregate.json), and
[recorded selection decisions](results/hyperparameter-selection.json).
Primary mean F1: DeBERTa 96.54%, selected TF-IDF 82.35%.
Read both threshold policies, seed variability and external results before making
a performance claim. The dataset/protocol freeze is commit
`fce251bfc5bc2b20d1f48a1aa4b618c775f69963`.

```bash
python -B -m unittest discover -s experiments/deberta-v3 -p 'test_*.py'
python -B experiments/deberta-v3/verify_results.py --source experiments/deberta-v1 --run experiments/deberta-v3/results
python experiments/deberta-v3/summarize.py --source experiments/deberta-v1 --run /tmp/agentgate-v3-run
python experiments/deberta-v3/package_evidence.py --run /tmp/agentgate-v3-run --destination /tmp/agentgate-v3-evidence
```

Offline verification uses the Python standard library and replays saved evidence;
it does not load model weights or perform GPU training. To regenerate a report,
use an unpackaged run or remove neither frozen hashes nor records: create a new
copy and keep the public evidence intact.
