"""Compare TF-IDF, a pinned encoder, and domain fine-tuning on grouped splits."""
import argparse
import json
import platform
import time
from pathlib import Path

from analysis import calibrate, dataset_hash, fingerprints, read_dataset, report, validate_splits, write_report


def score(rows, predict, model, revision):
    results = []
    for row in rows:
        start = time.perf_counter()
        value = float(predict(row["text"]))
        if not 0 <= value <= 1:
            raise ValueError("Invalid prediction")
        results.append({**row, "score": value, "durationMs": (time.perf_counter() - start) * 1000,
                        "model": model, "revision": revision})
    return results


def run(args):
    import numpy as np
    import sklearn
    import torch
    import transformers
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, Trainer, TrainingArguments, set_seed

    splits = {name: read_dataset(getattr(args, name), strict=True) for name in ("train", "validation", "test")}
    validate_splits(splits)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    set_seed(args.seed)
    manifest = {"arguments": vars(args), "datasets": {k: dataset_hash(getattr(args, k)) for k in splits},
                "versions": {"python": platform.python_version(), "torch": torch.__version__,
                             "transformers": transformers.__version__, "sklearn": sklearn.__version__},
                "device": "cuda" if torch.cuda.is_available() else "cpu",
                "note": "Group provenance is supplied by the curator; paraphrase leakage requires manual review."}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    comparisons = []

    def evaluate(name, predict, revision):
        validation = score(splits["validation"], predict, name, revision)
        calibration_error = None
        try:
            threshold = calibrate(validation, args.max_fpr)
        except ValueError as error:
            # A weak baseline must not prevent evaluation of stronger models.
            threshold, calibration_error = .5, str(error)
        write_report(report(validation, threshold, split="validation"), output / (name + "-validation"))
        if not calibration_error:
            (output / (name + ".calibration.json")).write_text(json.dumps({"split": "validation", "threshold": threshold,
                "identities": [[name, revision]], "datasetHash": manifest["datasets"]["validation"],
                "maxFalsePositiveRate": args.max_fpr, "fingerprints": fingerprints(splits["validation"])}, indent=2), encoding="utf-8")
        # Test labels never select a threshold or checkpoint.
        heldout = report(score(splits["test"], predict, name, revision), threshold, split="test", calibrationError=calibration_error)
        write_report(heldout, output / (name + "-test"))
        comparisons.append({k: v for k, v in heldout.items() if k not in ("examples", "slices", "precisionRecall") } | {"model": name})

    baseline = make_pipeline(TfidfVectorizer(ngram_range=(1, 2), max_features=30000, sublinear_tf=True),
                             LogisticRegression(max_iter=1000, random_state=args.seed, class_weight="balanced"))
    baseline.fit([r["text"] for r in splits["train"]], [r["label"] for r in splits["train"]])
    # Portable numeric baseline artifact; no pickle deserialization is required.
    vectorizer, classifier = baseline.steps[0][1], baseline.steps[1][1]
    np.savez(output / "tfidf-weights.npz", idf=vectorizer.idf_, coefficients=classifier.coef_, intercept=classifier.intercept_)
    (output / "tfidf-vocabulary.json").write_text(json.dumps(vectorizer.vocabulary_, default=int), encoding="utf-8")
    evaluate("tfidf", lambda text: baseline.predict_proba([text])[0, 1], manifest["datasets"]["train"])
    tokenizer = AutoTokenizer.from_pretrained(args.model, revision=args.revision, trust_remote_code=False)
    model = AutoModelForSequenceClassification.from_pretrained(args.model, revision=args.revision,
                                                               trust_remote_code=False, use_safetensors=True)
    if {int(k): str(v).upper() for k, v in model.config.id2label.items()} != {0: "SAFE", 1: "INJECTION"}:
        raise ValueError("Expected SAFE=0 and INJECTION=1")
    model.to(manifest["device"])

    def predict(text):
        model.eval()
        tokens = tokenizer(text, truncation=True, max_length=512, stride=64,
                           return_overflowing_tokens=True, padding=True, return_tensors="pt")
        tokens.pop("overflow_to_sample_mapping", None)
        scores = []
        with torch.inference_mode():
            for offset in range(0, len(tokens["input_ids"]), 4):
                batch = {k: v[offset:offset + 4].to(model.device) for k, v in tokens.items()}
                scores.extend(model(**batch).logits.softmax(-1)[:, 1].tolist())
        return max(scores)

    evaluate("pretrained", predict, args.revision)

    class Windows(torch.utils.data.Dataset):
        def __init__(self, rows):
            self.items = []
            for row in rows:
                encoded = tokenizer(row["text"], truncation=True, max_length=512, stride=64,
                                    return_overflowing_tokens=True, padding="max_length")
                encoded.pop("overflow_to_sample_mapping", None)
                # Positive long documents can contain benign windows. Curators should use
                # localized training examples; evaluation still uses full documents.
                if row["label"] and len(encoded["input_ids"]) > 1:
                    raise ValueError("Positive training examples must fit one window; annotate attack spans first")
                for i in range(len(encoded["input_ids"])):
                    self.items.append({**{k: torch.tensor(v[i]) for k, v in encoded.items()}, "labels": torch.tensor(row["label"])})
        def __len__(self):
            return len(self.items)
        def __getitem__(self, index):
            return self.items[index]

    trainer = Trainer(model=model, train_dataset=Windows(splits["train"]), args=TrainingArguments(
        output_dir=str(output / "training"), num_train_epochs=args.epochs, learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size, seed=args.seed, data_seed=args.seed,
        save_strategy="no", report_to="none", use_cpu=manifest["device"] == "cpu"))
    trainer.train()
    checkpoint = output / "checkpoint"
    model.save_pretrained(checkpoint, safe_serialization=True)
    tokenizer.save_pretrained(checkpoint)
    revision = dataset_hash(checkpoint / "model.safetensors")
    evaluate("finetuned", predict, revision)
    (output / "comparison.json").write_text(json.dumps(comparisons, indent=2), encoding="utf-8")
    (checkpoint / "experiment.json").write_text(json.dumps({**manifest, "revision": revision}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("train", "validation", "test", "output"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--model", default="protectai/deberta-v3-base-prompt-injection-v2")
    parser.add_argument("--revision", default="90c9989b1a342275dd0d1a95aad283c04e075671")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--max-fpr", type=float, default=.05)
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 1 or not 0 < args.learning_rate < 1 or not 0 <= args.max_fpr <= 1:
        parser.error("Invalid training parameters")
    run(args)
