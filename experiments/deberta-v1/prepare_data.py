"""Build immutable grouped synthetic data and untouched external diagnostic sets."""
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normal(text):
    return " ".join(text.casefold().split())


def build_domain(families, seed):
    buckets = defaultdict(list)
    for family in families:
        buckets[family["category"]].append(family)
    splits = {"train": [], "validation": [], "test": []}
    for category, group in sorted(buckets.items()):
        group = sorted(group, key=lambda f: f["id"])
        random.Random(f"{seed}:{category}").shuffle(group)
        assert len(group) == 10
        for i, family in enumerate(group):
            split = "train" if i < 6 else "validation" if i < 8 else "test"
            for label, key in ((0, "safe"), (1, "attack")):
                sentence = family[key]
                variants = [sentence,
                            "Purchasing helpdesk message\n" + sentence,
                            "Supplier document excerpt\nItem: office laptop. Availability: in stock.\n" + sentence,
                            "Retrieved procurement note\nDepartment: operations. Review cycle: quarterly.\n" + sentence + "\nEnd of note."]
                for v, text in enumerate(variants):
                    splits[split].append(dict(id=f"domain-{family['id']}-{label}-{v}", text=text,
                        label=label, group=family["id"], category=category, language="en",
                        source="AgentGate AI-authored synthetic contrast pairs, 2026-10-20",
                        license="Original generated project material; no third-party source text",
                        synthetic=True, variant=v, annotation="AI-authored intent label; no independent human annotation"))
    return splits


def main():
    import pyarrow.parquet as pq
    protocol = json.loads((ROOT / "protocol.json").read_text(encoding="utf-8"))
    families = json.loads((ROOT / "families.json").read_text(encoding="utf-8"))
    splits = build_domain(families, protocol["split_seed"])
    external = {"notinject": [], "deepset": []}
    for path in sorted((ROOT / "sources").glob("notinject-*.parquet")):
        for i, row in enumerate(pq.read_table(path).to_pylist()):
            external["notinject"].append(dict(id=f"{path.stem}-{i}", text=row["prompt"], label=0,
                group=f"{path.stem}-{i}", category=row["category"], language="en-as-declared-by-source",
                source="leolee99/NotInject@847ae76cf8fea5ed325429e569ae8cfef022d2e0", license="MIT",
                synthetic=True, annotation="Original dataset label; all examples benign"))
    for path in sorted((ROOT / "sources").glob("deepset-*.parquet")):
        for i, row in enumerate(pq.read_table(path).to_pylist()):
            external["deepset"].append(dict(id=f"{path.stem}-{i}", text=row["text"], label=int(row["label"]),
                group=f"{path.stem}-{i}", category="public_injection" if row["label"] else "public_benign",
                language="unspecified-by-row", source="deepset/prompt-injections@4f61ecb038e9c3fb77e21034b22511b523772cdd",
                license="Card top-level Apache-2.0; nested dataset_info CC-BY-4.0; both notices retained",
                annotation="Original source label; not relabeled by AgentGate"))
    output = ROOT / "data"
    output.mkdir(exist_ok=False)
    manifest = {"protocol_sha256": sha(ROOT / "protocol.json"), "families_sha256": sha(ROOT / "families.json"),
                "split_method": "60/20/20 by family within category, seed 20261020; four paired variants per family",
                "datasets": {}, "exclusions": [], "duplicates_within_external": {}}
    seen = {}
    for split, rows in splits.items():
        for row in rows:
            key = normal(row["text"])
            if key in seen:
                raise ValueError("Duplicate domain text")
            seen[key] = split
    for name, rows in external.items():
        retained, unique = [], set()
        duplicate_count = 0
        for row in rows:
            key = normal(row["text"])
            if not row["text"].strip() or len(row["text"]) > 6000 or key in seen:
                manifest["exclusions"].append({"id": row["id"], "reason": "empty, over 6000 characters, or exact domain overlap"})
                continue
            # Preserve original benchmark multiplicity and label conflicts; disclose duplicates.
            duplicate_count += int(key in unique)
            unique.add(key)
            retained.append(row)
        external[name] = retained
        manifest["duplicates_within_external"][name] = duplicate_count
    for name, rows in {**splits, **external}.items():
        path = output / f"{name}.jsonl"
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        manifest["datasets"][name] = {"sha256": sha(path), "rows": len(rows),
            "classes": dict(Counter(str(r["label"]) for r in rows)), "groups": len({r["group"] for r in rows}),
            "categories": dict(Counter(r["category"] for r in rows))}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
