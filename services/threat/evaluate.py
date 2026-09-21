"""Evaluate a running local classifier against user-supplied held-out JSONL."""
import json
import math
import argparse
import urllib.request
from analysis import calibrate, dataset_hash, fingerprints, report, write_report

def validate_result(result):
    if not isinstance(result, dict):
        raise ValueError("Expected an inference result object")
    if set(result) - {"score", "durationMs", "windows", "model", "revision", "threshold"}:
        raise ValueError("Unexpected inference fields")
    if "threshold" in result and (type(result["threshold"]) not in (int, float) or not 0 <= result["threshold"] <= 1):
        raise ValueError("Invalid inference threshold")
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


def main(path, output=None, split="test", calibration=None, max_fpr=0.05):
    rows = []
    with open(path, encoding="utf-8") as source:
        for line in source:
            row = json.loads(line)
            if type(row.get("label")) is not int or row["label"] not in (0, 1) or not isinstance(row.get("text"), str):
                raise ValueError("Expected text and integer label 0 or 1")
            row = {"text": row["text"], "label": row["label"], "id": row.get("id", str(len(rows) + 1)),
                   "category": row.get("category", "unspecified"),
                   "language": row.get("language", "unspecified"),
                   **({"group": row["group"]} if "group" in row else {})}
            request = urllib.request.Request("http://127.0.0.1:8765/detect",
                data=json.dumps({"text": row["text"]}).encode(),
                headers={"Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(request, timeout=25) as response:
                    raw = response.read(4097)
                    if len(raw) > 4096:
                        raise ValueError("Oversized inference response")
                    result = validate_result(json.loads(raw))
                row.update(result)
            except Exception as error:
                row["error"] = type(error).__name__
            rows.append(row)
    threshold = 0.5
    if calibration:
        with open(calibration, encoding="utf-8") as source:
            artifact = json.load(source)
        identities = sorted({(r["model"], r["revision"]) for r in rows if not r.get("error")})
        if artifact.get("split") != "validation" or artifact.get("identities") != [list(i) for i in identities]:
            raise ValueError("Calibration must match this model/revision and come from validation")
        threshold = artifact["threshold"]
        if type(threshold) not in (int, float) or not 0 <= threshold <= 1:
            raise ValueError("Invalid calibrated threshold")
        if artifact.get("datasetHash") == dataset_hash(path):
            raise ValueError("Validation and test datasets must differ")
        if set(artifact.get("fingerprints", [])) & set(fingerprints(rows)):
            raise ValueError("Validation/test text or group leakage detected")
    if split == "validation":
        if calibration:
            raise ValueError("Cannot recalibrate from an existing artifact")
        threshold = calibrate(rows, max_fpr)
    result = report(rows, threshold, split=split)
    if output:
        result["datasetHash"] = dataset_hash(path)
        write_report(result, output)
        if split == "validation":
            from pathlib import Path
            identities = sorted({(r["model"], r["revision"]) for r in rows if not r.get("error")})
            if len(identities) != 1:
                raise ValueError("Calibration requires a single model revision")
            Path(output).with_suffix(".calibration.json").write_text(json.dumps({
                "split": split, "threshold": threshold, "maxFalsePositiveRate": max_fpr,
                "identities": identities, "datasetHash": result["datasetHash"], "fingerprints": fingerprints(rows)}, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2, allow_nan=False))
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--output", help="Write JSON and an offline HTML error-review screen")
    parser.add_argument("--split", choices=["validation", "test"], default="test")
    parser.add_argument("--calibration", help="Validation calibration artifact to apply unchanged")
    parser.add_argument("--max-fpr", type=float, default=.05)
    args = parser.parse_args()
    if not 0 <= args.max_fpr <= 1:
        parser.error("--max-fpr must be between 0 and 1")
    main(args.path, args.output, args.split, args.calibration, args.max_fpr)
