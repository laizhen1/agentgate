# DeBERTa v3: more training families and a fresh synthetic test

This experiment compares full-parameter adaptation of the pinned ProtectAI DeBERTa-v3 detector with a validation-tuned TF-IDF/logistic-regression baseline. It adds 240 original contrast families, removes old training wrappers, and reserves new test families before fitting. See [protocol.json](protocol.json) and [DATA_CARD.md](DATA_CARD.md) for the assumptions and limitations. Previous experiments remain unchanged.

Training uses 360 distinct texts from 180 families. Validation and fresh test each use 96 texts from 48 new families. Nine word/character/combined TF-IDF configurations receive the same validation endpoint as three neural learning-rate candidates. The selected neural learning rate is repeated with seeds 43/44 after screening seed 42. Every selected seed, both threshold policies, and both existing public diagnostics are reported; no default detector is automatically replaced.

## Reproduce

Use Python 3.12 and the pinned [requirements](requirements.txt), a CUDA GPU with BF16 support, and the v1 pinned local `base-model` and source manifest. Paths below are relative to the repository root. Large model weights are not committed.

```bash
python experiments/deberta-v3/author_families.py
# Run the builder only into a NEW destination; checked-in data already exists.
python experiments/deberta-v3/prepare_data.py --source experiments/deberta-v1 --destination /tmp/agentgate-v3-data
python -m unittest discover -s experiments/deberta-v3 -p test_protocol.py
python experiments/deberta-v3/run_experiment.py --source experiments/deberta-v1 --output /tmp/agentgate-v3-run --stage select
python experiments/deberta-v3/run_experiment.py --source experiments/deberta-v1 --output /tmp/agentgate-v3-run --stage evaluate
```

The runner reads frozen data adjacent to its source, verifies hashes, and refuses changed provenance. Evaluation requires a completed selection lock. An explicit `--resume` can continue completed stages with identical inputs; interrupted training candidates restart from the pinned base model and seed. GPU execution need not be bit-identical across platforms.

This is an AI classifier experiment, separate from the 120-episode agent benchmark. It is not evidence that a deployed agent is universally safe.
