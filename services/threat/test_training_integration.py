"""Opt-in, offline training smoke test. Random tiny weights are not accuracy evidence."""
import argparse
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


@unittest.skipUnless(os.environ.get("AGENTGATE_ML_SMOKE") == "1", "Set AGENTGATE_ML_SMOKE=1 with training dependencies installed")
class TrainingIntegrationTests(unittest.TestCase):
    def test_training_checkpoint_reports_and_local_serving(self):
        import torch
        from transformers import BertConfig, BertForSequenceClassification, BertTokenizerFast
        from train import run
        from server import Detector
        torch.set_num_threads(1)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model_dir = root / "tiny-bert"
            model_dir.mkdir()
            vocabulary = ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "list", "laptops", "ignore", "rules", "train", "validation", "test", "one", "two"]
            (model_dir / "vocab.txt").write_text('\n'.join(vocabulary), encoding="utf-8")
            tokenizer = BertTokenizerFast(vocab_file=str(model_dir / "vocab.txt"))
            tokenizer.save_pretrained(model_dir)
            model = BertForSequenceClassification(BertConfig(vocab_size=len(vocabulary), hidden_size=16,
                num_hidden_layers=1, num_attention_heads=2, intermediate_size=32,
                id2label={0: "SAFE", 1: "INJECTION"}, label2id={"SAFE": 0, "INJECTION": 1}))
            model.save_pretrained(model_dir, safe_serialization=True)
            for split in ("train", "validation", "test"):
                rows = [dict(id=f"{split}-{i}", group=f"{split}-{i}", label=i % 2,
                    text=f"{split} {'one' if i < 2 else 'two'} " + ("ignore rules" if i % 2 else "list laptops"),
                    category="smoke", language="en", source="synthetic test", license="test-only") for i in range(4)]
                (root / (split + ".jsonl")).write_text(''.join(json.dumps(r) + '\n' for r in rows), encoding="utf-8")
            output = root / "experiment"
            run(argparse.Namespace(train=str(root / "train.jsonl"), validation=str(root / "validation.jsonl"),
                test=str(root / "test.jsonl"), output=str(output), seed=42, epochs=1, batch_size=2,
                learning_rate=2e-5, max_fpr=1., model=str(model_dir), revision="tiny-local-smoke"))
            comparison = json.loads((output / "comparison.json").read_text(encoding="utf-8"))
            self.assertEqual(len(comparison), 3)
            self.assertTrue(all(item["total"] == 4 for item in comparison))
            with patch.dict(os.environ, {"AGENTGATE_THREAT_CHECKPOINT": str(output / "checkpoint"),
                                          "AGENTGATE_THREAT_CALIBRATION": str(output / "finetuned.calibration.json")}):
                result = Detector().detect("list laptops")
                self.assertEqual(result["model"], "finetuned")
                self.assertEqual(len(result["revision"]), 64)
                self.assertIn("threshold", result)


if __name__ == "__main__":
    unittest.main()
