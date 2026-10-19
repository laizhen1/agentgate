"""Check frozen inputs, checkpoints, chronology, counts, and threshold provenance."""
import argparse
import hashlib
import json
from pathlib import Path

from analysis import calibrate, metrics


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    run = args.run
    manifest = json.loads((run / "manifest.json").read_text())
    chronology = json.loads((run / "training-complete-before-test.json").read_text())
    assert "completed_utc" in manifest
    assert manifest["started_utc"] <= chronology["utc"] <= manifest["completed_utc"]
    for filename, digest in manifest["code_sha256"].items():
        assert sha(root / filename) == digest, filename
    assert sha(root / "protocol.json") == manifest["data"]["protocol_sha256"]
    assert sha(root / "families.json") == manifest["data"]["families_sha256"]
    sources = json.loads((root / "sources/manifest.json").read_text())
    original_weight_hash = next(r["sha256"] for r in sources if r["path"] == "base-model/model.safetensors")
    if (root / "base-model/model.safetensors").exists():
        assert sha(root / "base-model/model.safetensors") == original_weight_hash
    for dataset, item in manifest["data"]["datasets"].items():
        assert sha(root / "data" / (dataset + ".jsonl")) == item["sha256"]
    checkpoints = []
    for seed in manifest["protocol"]["training_seeds"]:
        directory = run / f"finetuned-seed{seed}"
        evidence = json.loads((directory / "training.json").read_text())
        digest = sha(directory / "checkpoint/model.safetensors")
        assert digest == evidence["checkpoint_sha256"]
        assert digest != original_weight_hash
        assert evidence["trainable_parameters"] > 100_000_000
        assert evidence["seconds"] > 0
        assert all(item.get("loss", 0) >= 0 for item in evidence["log_history"])
        checkpoints.append(digest)
    assert len(set(checkpoints)) == len(checkpoints)
    checked = 0
    for model, selection in chronology["selection"].items():
        directory = run / model
        validation = json.loads((directory / "validation.json").read_text())
        if not selection["calibrationError"]:
            assert selection["threshold"] == calibrate(validation["examples"], manifest["protocol"]["max_validation_fpr"])
        for dataset in ("domain-test", "notinject", "deepset"):
            expected_n = manifest["data"]["datasets"]["test" if dataset == "domain-test" else dataset]["rows"]
            for suffix in ("", "-fixed"):
                result = json.loads((directory / f"{dataset}{suffix}.json").read_text())
                assert result["total"] == expected_n
                expected_threshold = .5 if suffix else selection["threshold"]
                assert result["threshold"] == expected_threshold
                recalculated = metrics(result["examples"], expected_threshold)
                for key in ("total", "tp", "tn", "fp", "fn", "errors", "recall", "precision", "f1", "falsePositiveRate"):
                    assert result[key] == recalculated[key], (model, dataset, key)
                checked += 1
    outcome = {"verified": True, "report_files_recomputed": checked, "checkpoint_hashes": checkpoints,
               "checks": ["data/code hashes", "unique trained checkpoints", "training-before-test marker", "validation-only threshold", "confusion counts and metrics"]}
    (run / "verification.json").write_text(json.dumps(outcome, indent=2), encoding="utf-8")
    print(json.dumps(outcome, indent=2))


if __name__ == "__main__":
    main()
