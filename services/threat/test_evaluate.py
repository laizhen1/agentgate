import contextlib
import io
import json
import unittest
import tempfile
from pathlib import Path
from unittest.mock import mock_open, patch

from evaluate import main, validate_result


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.result = dict(model="test-bert", revision="pinned", score=0.9,
                           windows=1, durationMs=20)

    def test_valid_scores_include_threshold_boundaries(self):
        for score in (0, 0.5, 1):
            self.assertEqual(validate_result(dict(self.result, score=score))["score"], score)

    def test_service_cannot_override_ground_truth(self):
        with self.assertRaises(ValueError):
            validate_result(dict(self.result, label=0, text="replacement"))

    def test_validation_artifact_is_applied_without_retuning_and_rejects_leakage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            validation = root / "validation.jsonl"
            heldout = root / "test.jsonl"
            validation.write_text('\n'.join(json.dumps(dict(text=t, label=label, group=g)) for t, label, g in [("ordinary", 0, "v0"), ("attack", 1, "v1")]), encoding="utf-8")
            heldout.write_text('\n'.join(json.dumps(dict(text=t, label=label, group=g)) for t, label, g in [("different ordinary", 0, "t0"), ("different attack", 1, "t1")]), encoding="utf-8")
            def responses():
                return [io.BytesIO(json.dumps(dict(self.result, score=s)).encode()) for s in (.8, .9)]
            with patch("evaluate.urllib.request.urlopen", side_effect=responses()), contextlib.redirect_stdout(io.StringIO()):
                calibrated = main(validation, root / "validation-report", "validation", max_fpr=0)
            self.assertEqual(calibrated["threshold"], .9)
            artifact = root / "validation-report.calibration.json"
            with patch("evaluate.urllib.request.urlopen", side_effect=responses()), contextlib.redirect_stdout(io.StringIO()):
                tested = main(heldout, calibration=artifact)
            self.assertEqual(tested["threshold"], .9)
            heldout.write_text(heldout.read_text(encoding="utf-8").replace('"t0"', '"v0"'), encoding="utf-8")
            with patch("evaluate.urllib.request.urlopen", side_effect=responses()), self.assertRaisesRegex(ValueError, "leakage"):
                main(heldout, calibration=artifact)

    def test_invalid_results_are_rejected(self):
        cases = [None, [], {}, *[dict(self.result, score=value)
                 for value in (True, -1, 2, float("nan"), float("inf"), "0.9")],
                 dict(self.result, durationMs=-1), dict(self.result, revision=""),
                 dict(self.result, windows=True), dict(self.result, windows=65)]
        for result in cases:
            with self.subTest(result=result), self.assertRaises(ValueError):
                validate_result(result)

    def test_invalid_response_never_counts_as_prediction(self):
        source = '\n'.join(json.dumps(dict(text="example", label=1)) for _ in range(3))
        responses = [dict(self.result, revision=""), self.result,
                     dict(self.result, extra="x" * 5000)]
        with patch("builtins.open", mock_open(read_data=source)), patch("evaluate.urllib.request.urlopen") as request:
            request.side_effect = [io.BytesIO(json.dumps(item).encode()) for item in responses]
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                main("unused.jsonl")
        report = json.loads(output.getvalue())
        self.assertEqual(report["total"], 3)
        self.assertEqual(report["errors"], 2)
        self.assertEqual(report["tp"], 1)
        self.assertEqual(report["fp"] + report["tn"] + report["fn"], 0)
        self.assertAlmostEqual(report["coverage"], 1 / 3)


if __name__ == "__main__":
    unittest.main()
