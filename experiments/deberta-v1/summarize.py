"""Summarize completed, frozen runs without selecting a winning seed or retuning."""
import argparse
import csv
import hashlib
import html
import json
from collections import defaultdict
from pathlib import Path


def percent(x):
    return "n/a" if x is None else f"{100*x:.2f}%"


def main():
    import numpy as np
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    root = args.run
    comparison = json.loads((root / "comparison.json").read_text())
    manifest = json.loads((root / "manifest.json").read_text())
    seeds = manifest["protocol"]["training_seeds"]
    fields = ["model", "dataset", "threshold_policy", "total", "tp", "fp", "tn", "fn", "errors", "coverage", "precision", "recall", "f1", "falsePositiveRate", "p50LatencyMs", "p95LatencyMs", "threshold"]
    with (root / "comparison.csv").open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(comparison)

    grouped = defaultdict(list)
    for row in comparison:
        if row["model"].startswith("finetuned"):
            grouped[(row["dataset"], row["threshold_policy"])].append(row)
    aggregates = []
    for (dataset, policy), rows in grouped.items():
        record = {"dataset": dataset, "threshold_policy": policy, "seeds": seeds}
        for metric in ("precision", "recall", "f1", "falsePositiveRate", "p95LatencyMs"):
            values = [r[metric] for r in rows if r[metric] is not None]
            record[metric] = None if not values else {"mean": float(np.mean(values)), "min": min(values), "max": max(values),
                "sample_sd": float(np.std(values, ddof=1)) if len(values) > 1 else None}
        aggregates.append(record)

    # Paired cluster bootstrap: resample the 12 families, preserving their variants
    # and paired baseline/adaptation predictions. Seed variability is separate.
    intervals = []
    for policy, suffix in (("validation-selected", ""), ("fixed-0.5", "-fixed")):
        baseline = json.loads((root / "pretrained" / f"domain-test{suffix}.json").read_text())
        for seed in seeds:
            adapted = json.loads((root / f"finetuned-seed{seed}" / f"domain-test{suffix}.json").read_text())
            base_by_id = {r["id"]: r for r in baseline["examples"]}
            groups = defaultdict(lambda: np.zeros(6, dtype=float))
            for row in adapted["examples"]:
                prior = base_by_id[row["id"]]
                if row.get("error") or prior.get("error"):
                    continue
                counts = groups[row["group"]]
                if row["label"]:
                    counts[0] += prior["prediction"]
                    counts[1] += row["prediction"]
                    counts[2] += 1
                else:
                    counts[3] += prior["prediction"]
                    counts[4] += row["prediction"]
                    counts[5] += 1
            matrix = np.stack(list(groups.values()))
            rng = np.random.default_rng(20261021)
            totals = matrix[rng.integers(0, len(matrix), size=(5000, len(matrix)))].sum(axis=1)
            recall_delta = (totals[:, 1] - totals[:, 0]) / totals[:, 2]
            fpr_delta = (totals[:, 4] - totals[:, 3]) / totals[:, 5]
            intervals.append({"seed": seed, "threshold_policy": policy, "clusters": len(matrix), "resamples": 5000,
                "recall_delta_95_percentile_ci": np.quantile(recall_delta, [.025, .975]).tolist(),
                "fpr_delta_95_percentile_ci": np.quantile(fpr_delta, [.025, .975]).tolist(),
                "definition": "adapted minus original, paired family-cluster bootstrap; empirical intervals can degenerate at boundary"})
    (root / "aggregate.json").write_text(json.dumps({"seed_aggregates": aggregates, "domain_paired_intervals": intervals}, indent=2), encoding="utf-8")

    def comparison_row(model, dataset, policy):
        return next(r for r in comparison if r["model"] == model and r["dataset"] == dataset and r["threshold_policy"] == policy)

    def aggregate_row(dataset, policy):
        return next(r for r in aggregates if r["dataset"] == dataset and r["threshold_policy"] == policy)

    domain_base = comparison_row("pretrained", "domain-test", "validation-selected")
    domain_new = aggregate_row("domain-test", "validation-selected")
    domain_simple = comparison_row("tfidf", "domain-test", "validation-selected")
    fixed_base = comparison_row("pretrained", "domain-test", "fixed-0.5")
    fixed_new = aggregate_row("domain-test", "fixed-0.5")
    external_base = comparison_row("pretrained", "deepset", "fixed-0.5")
    external_new = aggregate_row("deepset", "fixed-0.5")
    benign_base = comparison_row("pretrained", "notinject", "fixed-0.5")
    benign_new = aggregate_row("notinject", "fixed-0.5")
    lines = ["# AgentGate DeBERTa domain-adaptation experiment", "",
        "Completed real training and inference on a small AI-authored synthetic domain dataset, with separate public diagnostics. This is not a production security validation.", "",
        "## What the experiment found", "",
        f"- At the predeclared validation-selected operating points, domain recall changed from {percent(domain_base['recall'])} to {percent(domain_new['recall']['mean'])} (three-seed mean); FPR changed from {percent(domain_base['falsePositiveRate'])} to {percent(domain_new['falsePositiveRate']['mean'])}. Two seeds still exceed the 5% validation FPR target on test.",
        f"- TF-IDF remains a strong domain baseline: F1 {percent(domain_simple['f1'])}, versus fine-tuned mean {percent(domain_new['f1']['mean'])}. The neural model does not establish an F1 advantage over this simpler baseline on the small domain test.",
        f"- At the common fixed 0.5 threshold, domain recall changed from {percent(fixed_base['recall'])} to {percent(fixed_new['recall']['mean'])}, while FPR fell from {percent(fixed_base['falsePositiveRate'])} to {percent(fixed_new['falsePositiveRate']['mean'])}. NotInject FPR fell from {percent(benign_base['falsePositiveRate'])} to {percent(benign_new['falsePositiveRate']['mean'])}.",
        f"- The same fixed-threshold comparison exposes a regression on deepset: F1 fell from {percent(external_base['f1'])} to {percent(external_new['f1']['mean'])}, and recall fell from {percent(external_base['recall'])} to {percent(external_new['recall']['mean'])}. Do not present the calibrated-threshold gains as universal model improvement.",
        "- Conclusion: the experiment demonstrates domain adaptation and reduced over-defense, with a measurable external-detection tradeoff. Keep the detector advisory and experimental; no deployment promotion is justified by these results alone.", "",
        "## Protocol and provenance", "",
        f"- Hardware: {manifest['environment']['gpu']}; PyTorch {manifest['environment']['torch']}; Transformers {manifest['environment']['transformers']}.",
        "- Initialization: Protect AI DeBERTa-v3-base prompt-injection-v2, revision `90c9989b1a342275dd0d1a95aad283c04e075671`.",
        "- Full-parameter fine-tuning: 3 epochs; learning rate 2e-5; AdamW, weight decay 0.01; linear schedule, 10% warmup; microbatch 1, accumulation 8; BF16 and gradient checkpointing; dynamic padding, 512-token maximum, 64-token overlap.",
        "- Seeds: 42, 43, 44. Final epoch fixed in advance; every seed reported. No best-seed selection.",
        "- Domain data: 480 AI-authored synthetic examples / 60 contrast families; 288 train, 96 validation, 96 test; 36/12/12 families. Context variants are correlated, not independent samples.",
        "- Each model's operating threshold is selected on the same domain validation set for maximum recall at empirical FPR <= 5%. This is not a test-set guarantee or probability calibration.",
        "- All seeds and thresholds completed before held-out scoring. See `training-complete-before-test.json` and `events.log`.",
        "- No external examples were used for optimization or threshold selection. Overlap with upstream checkpoint training cannot be ruled out.", "",
        "## Measured results at validation-selected thresholds", "",
        "| Dataset | Model | N | TP / FN | FP / TN | Recall | FPR | F1 | p95 ms | Errors |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for row in comparison:
        if row["threshold_policy"] != "validation-selected":
            continue
        f1 = "n/a (benign only)" if row["dataset"] == "notinject" else percent(row["f1"])
        lines.append(f"| {row['dataset']} | {row['model']} | {row['total']} | {row['tp']} / {row['fn']} | {row['fp']} / {row['tn']} | {percent(row['recall'])} | {percent(row['falsePositiveRate'])} | {f1} | {row['p95LatencyMs']:.2f} | {row['errors']} |")
    lines += ["", "## Fixed 0.5 threshold comparison", "",
        "This distinguishes weight adaptation from changes in the selected operating threshold.", "",
        "| Dataset | Model | Recall | FPR | F1 |", "|---|---|---:|---:|---:|"]
    for row in comparison:
        if row["threshold_policy"] == "fixed-0.5":
            f1 = "n/a" if row["dataset"] == "notinject" else percent(row["f1"])
            lines.append(f"| {row['dataset']} | {row['model']} | {percent(row['recall'])} | {percent(row['falsePositiveRate'])} | {f1} |")
    lines += ["", "## Training evidence", "", "| Seed | Parameters trained | Seconds | Peak allocated GPU GiB | Final training loss |", "|---|---:|---:|---:|---:|"]
    for seed in seeds:
        r = json.loads((root / f"finetuned-seed{seed}/training.json").read_text())
        lines.append(f"| {seed} | {r['trainable_parameters']:,} | {r['seconds']:.1f} | {r['peak_cuda_allocated_bytes']/1024**3:.2f} | {r['metrics']['train_loss']:.6f} |")
    lines += ["", "## Interpretation boundaries", "",
        "- Report domain gains together with any public-dataset regressions. Do not select whichever threshold or seed looks best after seeing test results.",
        "- The domain test contains only 12 independent contrast families. `aggregate.json` reports paired family-cluster bootstrap intervals and seed spread separately. A zero-width empirical interval at perfect accuracy is not proof of certainty.",
        "- NotInject is entirely benign: only false-positive performance is assessed there. Its F1/recall are not meaningful attack-detection measures.",
        "- deepset's original train and test partitions are both external diagnostics here; neither was used to train this adaptation. Original source labels are retained. Read `DATA_CARD.md` for license-field ambiguity and provenance.",
        "- Latency is serial warmed FP32 GPU inference including tokenization and transfer, with CUDA synchronization. It excludes model loading, HTTP, orchestration, and concurrent load; TF-IDF runs on CPU. This is not deployed service latency.",
        "- Detection is advisory in AgentGate. These numbers are not agent attack-success rates, execution-blocking rates, or measured business impact.",
        "- No automatic checkpoint promotion has occurred. Review external regressions before deployment.", "",
        "## Evidence files", "",
        "`comparison.json` and `comparison.csv`: complete metrics for all five models at both thresholds. Each model directory contains per-example JSON and escaped offline HTML reports, validation selection, and (for fine-tuned runs) weights and training logs. Dataset/model/code hashes, environment lock, and chronology are retained.", ""]
    (root / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    # A readable offline table; no remote resources, no execution of source text.
    table = '<table><thead><tr>' + ''.join('<th>'+html.escape(k)+'</th>' for k in fields) + '</tr></thead><tbody>'
    for row in comparison:
        table += '<tr>' + ''.join('<td>'+html.escape(str(row.get(k, '')))+'</td>' for k in fields) + '</tr>'
    table += '</tbody></table>'
    (root / "comparison.html").write_text('<!doctype html><meta charset="utf-8"><title>AgentGate measured experiment</title><style>body{font:15px system-ui;margin:32px}table{border-collapse:collapse}th,td{padding:8px;border:1px solid #ccc}th{background:#e8eef5}pre{white-space:pre-wrap}</style><h1>AgentGate: measured experiment</h1><p>Every seed and both threshold policies are shown. Read REPORT.md for provenance and limitations.</p>'+table, encoding="utf-8")
    print(json.dumps({"aggregate": aggregates, "domain_intervals": intervals}, indent=2))


if __name__ == "__main__":
    main()
