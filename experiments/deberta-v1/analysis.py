"""Dependency-free metrics, grouped dataset validation, and review artifacts."""
import hashlib
import html
import json
import math
from collections import Counter
from pathlib import Path


def ratio(a, b):
    return a / b if b else None


def percentile(values, q):
    if not values:
        return None
    values = sorted(values)
    position = (len(values) - 1) * q
    lo = int(position)
    return values[lo] + (values[min(lo + 1, len(values) - 1)] - values[lo]) * (position - lo)


def metrics(rows, threshold=0.5):
    counts = Counter(total=len(rows))
    latencies = []
    for row in rows:
        if row.get("error"):
            counts["errors"] += 1
            continue
        predicted = row["score"] >= threshold
        counts[("tp" if predicted else "fn") if row["label"] else ("fp" if predicted else "tn")] += 1
        latencies.append(row["durationMs"])
    return {**{k: counts[k] for k in ("total", "tp", "fp", "tn", "fn", "errors")},
            "coverage": ratio(counts["total"] - counts["errors"], counts["total"]),
            "precision": ratio(counts["tp"], counts["tp"] + counts["fp"]),
            "recall": ratio(counts["tp"], counts["tp"] + counts["fn"]),
            "f1": ratio(2 * counts["tp"], 2 * counts["tp"] + counts["fp"] + counts["fn"]),
            "falsePositiveRate": ratio(counts["fp"], counts["fp"] + counts["tn"]),
            "meanLatencyMs": ratio(sum(latencies), len(latencies)),
            "p50LatencyMs": percentile(latencies, .5), "p95LatencyMs": percentile(latencies, .95),
            "threshold": threshold}


def curve(rows):
    # Include a threshold above 1 to represent an explicit predict-none operating point.
    thresholds = sorted({0.0, 0.5, 1.0, math.nextafter(1.0, math.inf),
                         *(r["score"] for r in rows if not r.get("error"))})
    return [metrics(rows, t) for t in thresholds]


def calibrate(rows, max_fpr):
    if any(r.get("error") for r in rows) or {r["label"] for r in rows} != {0, 1}:
        raise ValueError("Calibration requires both classes and no inference errors")
    candidates = [m for m in curve(rows) if m["falsePositiveRate"] <= max_fpr and m["threshold"] <= 1]
    if not candidates:
        raise ValueError("No threshold meets the false-positive target; improve the model/data")
    return max(candidates, key=lambda m: (m["recall"], m["precision"] or 0, m["threshold"]))["threshold"]


def read_dataset(path, strict=False):
    rows = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        row = json.loads(line)
        if not isinstance(row, dict) or type(row.get("label")) is not int or row["label"] not in (0, 1):
            raise ValueError(f"Invalid label on line {number}")
        if not isinstance(row.get("text"), str) or not row["text"].strip() or len(row["text"]) > 6000:
            raise ValueError(f"Invalid text on line {number}")
        if strict and any(not isinstance(row.get(k), str) or not row[k].strip()
                          for k in ("id", "group", "source", "license", "category", "language")):
            raise ValueError("Training data requires id, group, source, license, category, language")
        rows.append({**row, "id": row.get("id", str(number)),
                     "category": row.get("category", "unspecified"), "language": row.get("language", "unspecified")})
    if not rows or len({r["id"] for r in rows}) != len(rows):
        raise ValueError("Dataset must be nonempty with unique IDs")
    return rows


def validate_splits(splits):
    seen = {"id": {}, "group": {}, "text": {}}
    for split, rows in splits.items():
        if {r["label"] for r in rows} != {0, 1}:
            raise ValueError(f"{split} must contain both classes")
        for row in rows:
            keys = {"id": row["id"], "group": row["group"],
                    "text": " ".join(row["text"].casefold().split())}
            for kind, key in keys.items():
                prior = seen[kind].get(key)
                if prior and prior != split:
                    raise ValueError(f"Cross-split {kind} leakage between {prior} and {split}")
                seen[kind][key] = split


def dataset_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def fingerprints(rows):
    keys = set()
    for row in rows:
        keys.add("text:" + " ".join(row["text"].casefold().split()))
        if row.get("group"):
            keys.add("group:" + row["group"])
    return sorted(hashlib.sha256(key.encode()).hexdigest() for key in keys)


def report(rows, threshold, **metadata):
    examples = []
    for row in rows:
        outcome = "error" if row.get("error") else ("tp" if row["score"] >= threshold else "fn") if row["label"] else ("fp" if row["score"] >= threshold else "tn")
        examples.append({**row, "outcome": outcome, "prediction": None if row.get("error") else int(row["score"] >= threshold),
                         "lengthBucket": "short" if len(row["text"]) < 500 else "medium" if len(row["text"]) < 2000 else "long"})
    slices = {key: {value: metrics([r for r in examples if r[key] == value], threshold)
                    for value in sorted({r[key] for r in examples})}
              for key in ("category", "language", "lengthBucket")}
    return {**metrics(rows, threshold), **metadata, "examples": examples, "slices": slices,
            "precisionRecall": curve(rows),
            "revisions": sorted({r["revision"] for r in rows if not r.get("error")}),
            "note": "Metrics exclude errors; inspect coverage. Scores are not calibrated safety probabilities."}


def write_report(result, output):
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.with_suffix(".json").write_text(json.dumps(result, indent=2, allow_nan=False), encoding="utf-8")
    # All dataset content is escaped. The review works offline without external scripts.
    options = lambda key: ''.join('<option>' + html.escape(v) + '</option>' for v in sorted({r[key] for r in result["examples"]}))
    rows = ''.join('<tr data-outcome="{outcome}" data-category="{category}" data-language="{language}" data-length="{lengthBucket}"><td>{id}</td><td>{outcome}</td><td>{category}</td><td>{language}</td><td>{score}</td><td>{text}</td><td>{error}</td></tr>'.format(**{k: html.escape(str(r.get(k, "")), quote=True) for k in ("id", "outcome", "category", "language", "lengthBucket", "score", "text", "error")}) for r in result["examples"])
    points = ' '.join(f'{40 + 420 * p["recall"]},{230 - 200 * p["precision"]}' for p in result["precisionRecall"] if p["recall"] is not None and p["precision"] is not None)
    summary = html.escape(json.dumps({k: v for k, v in result.items() if k not in ("examples", "precisionRecall", "slices")}, indent=2))
    page = '<!doctype html><meta charset="utf-8"><title>Threat evaluation review</title><style>body{font:16px system-ui;margin:32px;max-width:1400px}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #aaa;text-align:left;overflow-wrap:anywhere}td:nth-child(6){max-width:600px;white-space:pre-wrap}select{margin:8px}pre{white-space:pre-wrap}svg{max-width:100%}</style><h1>Threat evaluation review</h1><pre>' + summary + '</pre><h2>Precision–recall threshold sweep</h2><svg viewBox="0 0 500 270" width="500" role="img" aria-label="Precision versus recall"><path d="M40 30V230H460" fill="none" stroke="black"/><polyline points="' + points + '" fill="none" stroke="#1768ad" stroke-width="2"/><text x="220" y="260">Recall (0–1)</text><text x="5" y="20">Precision (0–1)</text></svg><p>Threshold selection uses validation data only. Inspect JSON for exact curve points and slice metrics.</p>'
    for key, label in (("outcome", "Outcome"), ("category", "Category"), ("language", "Language"), ("lengthBucket", "Length")):
        field = "length" if key == "lengthBucket" else key
        page += f'<label>{label}<select data-field="{field}"><option value="">All</option>{options(key)}</select></label>'
    page += '<table><thead><tr><th>ID</th><th>Outcome</th><th>Category</th><th>Language</th><th>Score</th><th>Text</th><th>Error</th></tr></thead><tbody>' + rows + '</tbody></table><script>for(const s of document.querySelectorAll("select"))s.addEventListener("change",()=>{for(const row of document.querySelectorAll("tbody tr"))row.hidden=[...document.querySelectorAll("select")].some(x=>x.value&&row.dataset[x.dataset.field]!==x.value)});</script>'
    path.with_suffix(".html").write_text(page, encoding="utf-8")
