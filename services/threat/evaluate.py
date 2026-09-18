"""Evaluate a running local classifier against user-supplied held-out JSONL."""
import json
import math
import sys
import urllib.request
from collections import Counter

def validate_result(result):
    if not isinstance(result, dict):
        raise ValueError("Expected an inference result object")
    for key in ("score", "durationMs"):
        value = result.get(key)
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError("Expected finite numeric " + key)
    if not 0 <= result["score"] <= 1 or result["durationMs"] < 0:
        raise ValueError("Invalid score or duration")
    if type(result.get("windows")) is not int or not 1 <= result["windows"] <= 64:
        raise ValueError("Invalid window count")
    for key in ("model", "revision"):
        if not isinstance(result.get(key), str) or not 1 <= len(result[key]) <= 200:
            raise ValueError("Invalid " + key)
    return result


def main(path):
    counts = Counter()
    latencies = []
    revisions = set()
    with open(path, encoding="utf-8") as source:
        for line in source:
            row = json.loads(line)
            if type(row.get("label")) is not int or row["label"] not in (0, 1) or not isinstance(row.get("text"), str):
                raise ValueError("Expected text and integer label 0 or 1")
            counts["total"] += 1
            request = urllib.request.Request("http://127.0.0.1:8765/detect",
                data=json.dumps({"text": row["text"]}).encode(),
                headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(request, timeout=25) as response:
                    raw = response.read(4097)
                    if len(raw) > 4096:
                        raise ValueError("Oversized inference response")
                    result = validate_result(json.loads(raw))
                predicted = int(result["score"] >= 0.5)
                counts[("tp" if predicted else "fn") if row["label"] else ("fp" if predicted else "tn")] += 1
                latencies.append(result["durationMs"])
                revisions.add(result["revision"])
            except Exception:
                counts["errors"] += 1
    def ratio(a, b):
        return a / b if b else None
    print(json.dumps({
        **{key: counts[key] for key in ("total", "tp", "fp", "tn", "fn", "errors")},
        "coverage": ratio(counts["total"] - counts["errors"], counts["total"]),
        "precision": ratio(counts["tp"], counts["tp"] + counts["fp"]),
        "recall": ratio(counts["tp"], counts["tp"] + counts["fn"]),
        "f1": ratio(2 * counts["tp"], 2 * counts["tp"] + counts["fp"] + counts["fn"]),
        "meanLatencyMs": ratio(sum(latencies), len(latencies)),
        "revisions": sorted(revisions), "threshold": 0.5,
        "note": "Metrics exclude errors; inspect error count and coverage.",
    }, indent=2))

if __name__ == "__main__":
    main(sys.argv[1])
