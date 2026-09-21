import tempfile
import unittest
from pathlib import Path
from analysis import calibrate, curve, fingerprints, metrics, report, validate_splits, write_report
from split import split_rows


def example(label, score, **extra):
    return dict(id=str(score), text="sample", label=label, score=score, durationMs=10,
                category="quoted attack", language="en", revision="test", **extra)


class AnalysisTests(unittest.TestCase):
    def test_reproducible_group_split_and_fingerprints(self):
        rows = [dict(id=f"{g}-{label}", group=str(g), text=f"example {g} {label}", label=label)
                for g in range(10) for label in (0, 1)]
        first = split_rows(rows, 42)
        self.assertEqual(first, split_rows(rows, 42))
        self.assertEqual({k: len(v) for k, v in first.items()}, {"train": 12, "validation": 4, "test": 4})
        self.assertTrue(set(fingerprints([dict(text=" One ", group="a")])) & set(fingerprints([dict(text="one", group="b")])) )
        self.assertFalse(set(fingerprints(first["train"])) & set(fingerprints(first["test"])))
    def test_threshold_and_error_accounting(self):
        rows = [example(0, .8), example(1, .9), example(0, .1), example(1, .2), example(1, 0, error="Timeout")]
        self.assertEqual(metrics(rows)["falsePositiveRate"], .5)
        self.assertEqual(metrics(rows)["coverage"], .8)
        self.assertEqual(metrics(rows)["p95LatencyMs"], 10)
        self.assertEqual(calibrate(rows[:-1], 0), .9)
        with self.assertRaises(ValueError):
            calibrate(rows, 0)
        self.assertEqual(curve(rows)[-1]["tp"], 0)

    def test_no_satisfying_threshold(self):
        with self.assertRaises(ValueError):
            calibrate([example(0, 1), example(1, .5)], 0)

    def test_group_and_text_leakage(self):
        splits = {"train": [dict(id="a", text="one", label=0, group="a"), dict(id="b", text="two", label=1, group="b")],
                  "test": [dict(id="c", text="three", label=0, group="c"), dict(id="d", text="four", label=1, group="d")]}
        validate_splits(splits)
        splits["test"][0]["group"] = "a"
        with self.assertRaises(ValueError):
            validate_splits(splits)
        splits["test"][0].update(group="c", text=" ONE ")
        with self.assertRaises(ValueError):
            validate_splits(splits)

    def test_review_escapes_untrusted_dataset_and_preserves_errors(self):
        rows = [example(0, .9), example(1, 0, error="Timeout")]
        rows[0]["text"] = '<script>alert("x")</script>'
        result = report(rows, .5)
        self.assertEqual([r["outcome"] for r in result["examples"]], ["fp", "error"])
        self.assertEqual(result["slices"]["language"]["en"]["errors"], 1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "review"
            write_report(result, path)
            page = path.with_suffix(".html").read_text(encoding="utf-8")
            self.assertNotIn('<script>alert', page)
            self.assertIn('&lt;script&gt;', page)


if __name__ == "__main__":
    unittest.main()
