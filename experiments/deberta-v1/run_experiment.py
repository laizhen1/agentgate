"""Frozen, offline experiment. Fit all seeds before opening held-out predictions."""
import argparse
import gc
import hashlib
import json
import os
import platform
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
ROOT = Path(__file__).resolve().parent

from analysis import calibrate, dataset_hash, fingerprints, read_dataset, report, validate_splits, write_report


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False), encoding="utf-8")


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true", help="Resume completed stages only if hashes match.")
    args = parser.parse_args()
    import numpy as np
    import sklearn
    import torch
    import transformers
    from sklearn.pipeline import make_pipeline
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from transformers import AutoTokenizer, AutoModelForSequenceClassification, DataCollatorWithPadding, Trainer, TrainingArguments, set_seed

    protocol = json.loads((ROOT / "protocol.json").read_text())
    data_manifest = json.loads((ROOT / "data/manifest.json").read_text())
    assert data_manifest["protocol_sha256"] == dataset_hash(ROOT / "protocol.json")
    assert data_manifest["families_sha256"] == dataset_hash(ROOT / "families.json")
    for name, record in data_manifest["datasets"].items():
        assert dataset_hash(ROOT / "data" / f"{name}.jsonl") == record["sha256"]
    # Labels may be read for integrity checks, but never influence training or selection.
    splits = {k: read_dataset(ROOT / "data" / f"{k}.jsonl", strict=True) for k in ("train", "validation", "test")}
    validate_splits(splits)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device != "cuda":
        raise RuntimeError("This protocol requires CUDA; change and document a new protocol for CPU training.")
    if protocol["bf16"] and not torch.cuda.is_bf16_supported():
        raise RuntimeError("BF16 is required by the frozen protocol.")
    torch.set_num_threads(4)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=args.resume)
    code_hashes = {name: dataset_hash(ROOT / name) for name in ("run_experiment.py", "prepare_data.py", "analysis.py")}
    manifest = {"started_utc": timestamp(), "protocol": protocol, "data": data_manifest,
        "code_sha256": code_hashes,
        "environment": {"python": platform.python_version(), "platform": platform.platform(), "torch": torch.__version__,
            "transformers": transformers.__version__, "sklearn": sklearn.__version__, "numpy": np.__version__,
            "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(0),
            "gpu_total_bytes": torch.cuda.get_device_properties(0).total_memory, "cpu_threads": 4},
        "latency_method": "Warmed serial FP32 inference; tokenizer + transfer + synchronized model + score aggregation; excludes load time and HTTP; single sample, one window at a time.",
        "reproducibility": "Fixed artifacts and RNG seeds. CUDA kernels may still vary; bit-identical GPU weights are not guaranteed."}
    if args.resume:
        previous = json.loads((output / "manifest.json").read_text())
        for key in ("protocol", "data", "code_sha256"):
            if previous[key] != manifest[key]:
                raise ValueError(f"Resume refused: {key} changed")
        manifest = previous
    else:
        dump(output / "manifest.json", manifest)
        (output / "environment.lock.txt").write_text(subprocess.check_output([os.sys.executable, "-m", "pip", "freeze"], text=True), encoding="utf-8")

    def event(message):
        line = timestamp() + " " + message
        print(line, flush=True)
        with (output / "events.log").open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    def score(rows, predict, name, revision):
        results = []
        for i, row in enumerate(rows):
            torch.cuda.synchronize()
            start = time.perf_counter()
            try:
                probability = float(predict(row["text"]))
                torch.cuda.synchronize()
                if not np.isfinite(probability) or not 0 <= probability <= 1:
                    raise ValueError("Nonfinite or invalid score")
                results.append({**row, "score": probability, "durationMs": (time.perf_counter() - start) * 1000,
                                "model": name, "revision": revision})
            except Exception as error:
                results.append({**row, "error": type(error).__name__ + ": " + str(error), "score": 0,
                                "durationMs": (time.perf_counter() - start) * 1000, "model": name, "revision": revision})
            if (i + 1) % 100 == 0:
                event(f"{name} scored {i + 1}/{len(rows)}")
        return results

    def validate(name, predict, revision, directory):
        rows = score(splits["validation"], predict, name, revision)
        calibration_error = None
        try:
            threshold = calibrate(rows, protocol["max_validation_fpr"])
        except ValueError as error:
            threshold, calibration_error = .5, str(error)
        write_report(report(rows, threshold, split="validation", calibrationError=calibration_error), directory / "validation")
        metadata = {"threshold": threshold, "calibrationError": calibration_error, "revision": revision}
        dump(directory / "selection.json", metadata)
        if not calibration_error:
            dump(directory / "calibration.json", {"split": "validation", "threshold": threshold,
                "identities": [["finetuned" if name.startswith("finetuned") else name, revision]],
                "datasetHash": dataset_hash(ROOT / "data/validation.jsonl"),
                "fingerprints": fingerprints(splits["validation"]), "maxFalsePositiveRate": protocol["max_validation_fpr"]})
        event(f"{name}: validation selection saved (test unopened)")

    baseline = make_pipeline(TfidfVectorizer(ngram_range=(1, 2), max_features=30000, sublinear_tf=True),
                            LogisticRegression(max_iter=1000, random_state=42, class_weight="balanced"))
    baseline.fit([r["text"] for r in splits["train"]], [r["label"] for r in splits["train"]])
    tfidf_predict = lambda text: baseline.predict_proba([text])[0, 1]
    baseline_dir = output / "tfidf"
    baseline_dir.mkdir(exist_ok=True)
    vectorizer, classifier = baseline.steps[0][1], baseline.steps[1][1]
    np.savez(baseline_dir / "weights.npz", idf=vectorizer.idf_, coefficients=classifier.coef_, intercept=classifier.intercept_)
    dump(baseline_dir / "vocabulary.json", {k: int(v) for k, v in vectorizer.vocabulary_.items()})
    if not (baseline_dir / "selection.json").exists():
        validate("tfidf", tfidf_predict, dataset_hash(ROOT / "data/train.jsonl"), baseline_dir)

    tokenizer = AutoTokenizer.from_pretrained(ROOT / "base-model", local_files_only=True, trust_remote_code=False)

    def load(path):
        model = AutoModelForSequenceClassification.from_pretrained(path, local_files_only=True, trust_remote_code=False, use_safetensors=True)
        assert {int(k): v.upper() for k, v in model.config.id2label.items()} == {0: "SAFE", 1: "INJECTION"}
        return model.to(device)

    def predictor(model):
        model.eval()
        def predict(text):
            tokens = tokenizer(text, truncation=True, max_length=protocol["max_length"], stride=protocol["stride"],
                               return_overflowing_tokens=True, padding=True, return_tensors="pt")
            tokens.pop("overflow_to_sample_mapping", None)
            scores = []
            with torch.inference_mode():
                for offset in range(len(tokens["input_ids"])):
                    batch = {k: v[offset:offset + 1].to(device) for k, v in tokens.items()}
                    scores.append(model(**batch).logits.softmax(-1)[0, 1].item())
            return max(scores)
        for _ in range(3):
            predict(splits["train"][0]["text"])
        return predict

    original_dir = output / "pretrained"
    original_dir.mkdir(exist_ok=True)
    if not (original_dir / "selection.json").exists():
        model = load(ROOT / "base-model")
        predict = predictor(model)
        validate("pretrained", predict, protocol["revision"], original_dir)
        del predict, model
        gc.collect()
        torch.cuda.empty_cache()

    class TrainingData(torch.utils.data.Dataset):
        def __init__(self):
            self.items = []
            for row in splits["train"]:
                tokens = tokenizer(row["text"], truncation=True, max_length=protocol["max_length"],
                                   stride=protocol["stride"], return_overflowing_tokens=True)
                tokens.pop("overflow_to_sample_mapping", None)
                if row["label"] and len(tokens["input_ids"]) > 1:
                    raise ValueError("Localize positive training examples before creating windows")
                self.items.extend({**{k: v[i] for k, v in tokens.items()}, "labels": row["label"]}
                                  for i in range(len(tokens["input_ids"])))
        def __len__(self):
            return len(self.items)
        def __getitem__(self, i):
            return self.items[i]

    training_data = TrainingData()
    for seed in protocol["training_seeds"]:
        name = f"finetuned-seed{seed}"
        directory = output / name
        directory.mkdir(exist_ok=True)
        if (directory / "selection.json").exists():
            event(f"Resume: {name} completed")
            continue
        set_seed(seed)
        model = load(ROOT / "base-model")
        torch.cuda.reset_peak_memory_stats()
        event(f"Training {name}: {len(training_data)} windows, full-parameter BF16, final epoch fixed")
        started = time.perf_counter()
        trainer = Trainer(model=model, train_dataset=training_data,
            data_collator=DataCollatorWithPadding(tokenizer=tokenizer, pad_to_multiple_of=8),
            args=TrainingArguments(output_dir=str(directory / "trainer"), num_train_epochs=protocol["epochs"],
                learning_rate=protocol["learning_rate"], per_device_train_batch_size=protocol["batch_size"],
                gradient_accumulation_steps=protocol["gradient_accumulation_steps"],
                weight_decay=protocol["weight_decay"], warmup_ratio=protocol["warmup_ratio"],
                lr_scheduler_type="linear", optim="adamw_torch", bf16=protocol["bf16"],
                gradient_checkpointing=protocol["gradient_checkpointing"],
                gradient_checkpointing_kwargs={"use_reentrant": False},
                seed=seed, data_seed=seed, save_strategy="no", report_to="none", logging_steps=10,
                disable_tqdm=True, dataloader_num_workers=0, dataloader_pin_memory=True))
        result = trainer.train()
        elapsed = time.perf_counter() - started
        if not np.isfinite(result.training_loss):
            raise RuntimeError("Nonfinite training loss; do not produce benchmark claims")
        checkpoint = directory / "checkpoint"
        model.save_pretrained(checkpoint, safe_serialization=True)
        tokenizer.save_pretrained(checkpoint)
        revision = dataset_hash(checkpoint / "model.safetensors")
        dump(directory / "training.json", {"seed": seed, "seconds": elapsed,
            "trainable_parameters": sum(p.numel() for p in model.parameters() if p.requires_grad),
            "peak_cuda_allocated_bytes": torch.cuda.max_memory_allocated(), "peak_cuda_reserved_bytes": torch.cuda.max_memory_reserved(),
            "metrics": result.metrics, "log_history": trainer.state.log_history, "checkpoint_sha256": revision})
        del trainer
        model.gradient_checkpointing_disable()
        predict = predictor(model)
        validate(name, predict, revision, directory)
        del predict, model
        gc.collect()
        torch.cuda.empty_cache()
        event(f"Finished {name}; {elapsed:.1f} training seconds")

    # This marker proves all seeds and thresholds were committed before held-out scoring.
    complete = {name: json.loads((output / name / "selection.json").read_text()) for name in
                ["tfidf", "pretrained"] + [f"finetuned-seed{s}" for s in protocol["training_seeds"]]}
    dump(output / "training-complete-before-test.json", {"utc": timestamp(), "selection": complete})
    event("All training complete. Opening held-out evaluation; no subsequent tuning is permitted.")
    datasets = {"domain-test": splits["test"], **{k: read_dataset(ROOT / "data" / f"{k}.jsonl", strict=True) for k in ("notinject", "deepset")}}
    summary = []

    def evaluate(name, predict):
        directory = output / name
        selection = complete[name]
        for dataset_name, rows in datasets.items():
            path = directory / dataset_name
            if args.resume and path.with_suffix(".json").exists():
                predictions = json.loads(path.with_suffix(".json").read_text())["examples"]
            else:
                predictions = score(rows, predict, name, selection["revision"])
            result = report(predictions, selection["threshold"], split=dataset_name, calibrationError=selection["calibrationError"])
            write_report(result, path)
            fixed = report(predictions, .5, split=dataset_name, threshold_policy="fixed-0.5")
            write_report(fixed, directory / (dataset_name + "-fixed"))
            for policy, item in (("validation-selected", result), ("fixed-0.5", fixed)):
                summary.append({"model": name, "dataset": dataset_name, "threshold_policy": policy,
                                **{k: v for k, v in item.items() if k not in ("examples", "precisionRecall", "slices")}})
            event(f"{name}: saved {dataset_name}")

    evaluate("tfidf", tfidf_predict)
    for name in ["pretrained"] + [f"finetuned-seed{s}" for s in protocol["training_seeds"]]:
        model = load(ROOT / "base-model" if name == "pretrained" else output / name / "checkpoint")
        predict = predictor(model)
        evaluate(name, predict)
        del predict, model
        gc.collect()
        torch.cuda.empty_cache()
    dump(output / "comparison.json", summary)
    manifest["completed_utc"] = timestamp()
    dump(output / "manifest.json", manifest)
    event("Experiment complete")


if __name__ == "__main__":
    main()
