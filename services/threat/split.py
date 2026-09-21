"""Create reproducible train/validation/test JSONL without splitting attack groups."""
import argparse
import json
import random
from pathlib import Path
from analysis import dataset_hash, read_dataset, validate_splits


def split_rows(rows, seed=42):
    groups = sorted({r["group"] for r in rows})
    if len(groups) < 10:
        raise ValueError("Provide at least 10 independent groups; tiny corpora are smoke data only")
    random.Random(seed).shuffle(groups)
    n_validation = max(1, round(len(groups) * .2))
    n_test = max(1, round(len(groups) * .2))
    assignments = {g: "validation" if i < n_validation else "test" if i < n_validation + n_test else "train"
                   for i, g in enumerate(groups)}
    splits = {name: [r for r in rows if assignments[r["group"]] == name] for name in ("train", "validation", "test")}
    validate_splits(splits)
    return splits


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    splits = split_rows(read_dataset(args.input, strict=True), args.seed)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    for name, rows in splits.items():
        (output / (name + ".jsonl")).write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows), encoding="utf-8")
    (output / "split-manifest.json").write_text(json.dumps({"seed": args.seed, "sourceHash": dataset_hash(args.input),
        "counts": {k: len(v) for k, v in splits.items()}, "method": "Group shuffle, 60/20/20 by group count"}, indent=2), encoding="utf-8")
