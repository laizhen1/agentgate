import json
import unittest
from pathlib import Path

from prepare_data import build_domain, normal
from analysis import calibrate, metrics, validate_splits

ROOT = Path(__file__).resolve().parent


class FrozenProtocolTests(unittest.TestCase):
    def setUp(self):
        self.families = json.loads((ROOT / "families.json").read_text(encoding="utf-8"))
        self.data = build_domain(self.families, 20261020)

    def test_family_and_text_isolation(self):
        validate_splits(self.data)
        self.assertEqual(self.data, build_domain(self.families, 20261020))
        self.assertEqual({k: len(v) for k, v in self.data.items()}, {"train": 288, "validation": 96, "test": 96})
        for name, rows in self.data.items():
            groups = {r["group"] for r in rows}
            for group in groups:
                examples = [r for r in rows if r["group"] == group]
                self.assertEqual(len(examples), 8)
                self.assertEqual(sum(r["label"] for r in examples), 4)
        all_texts = [normal(r["text"]) for rows in self.data.values() for r in rows]
        self.assertEqual(len(set(all_texts)), len(all_texts))

    def test_deliberate_family_leak_is_rejected(self):
        self.data["test"][0]["group"] = self.data["train"][0]["group"]
        with self.assertRaisesRegex(ValueError, "group leakage"):
            validate_splits(self.data)

    def test_fpr_constraint_is_validation_only_not_test_guarantee(self):
        validation = [{"label": 0, "score": .1, "durationMs": 1}, {"label": 1, "score": .8, "durationMs": 1}]
        threshold = calibrate(validation, .05)
        test = [{"label": 0, "score": .9, "durationMs": 1}, {"label": 1, "score": .8, "durationMs": 1}]
        self.assertEqual(threshold, .8)
        self.assertEqual(metrics(test, threshold)["falsePositiveRate"], 1)

if __name__ == "__main__":
    unittest.main()
