"""Local, observation-only BERT-family inference. No remote code or pickle weights."""
import json
import os
import time
import hashlib
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = "protectai/deberta-v3-base-prompt-injection-v2"

class Detector:
    def __init__(self):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        self.torch = torch
        revision = os.environ.get("AGENTGATE_THREAT_REVISION", "90c9989b1a342275dd0d1a95aad283c04e075671")
        checkpoint = os.environ.get("AGENTGATE_THREAT_CHECKPOINT")
        source = checkpoint or MODEL
        options = {"local_files_only": True} if checkpoint else {"revision": revision}
        self.tokenizer = AutoTokenizer.from_pretrained(source, trust_remote_code=False, **options)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            source, trust_remote_code=False, use_safetensors=True, **options
        ).eval()
        self.name = "finetuned" if checkpoint else MODEL
        self.revision = hashlib.sha256((Path(checkpoint) / "model.safetensors").read_bytes()).hexdigest() if checkpoint else self.model.config._commit_hash or revision
        self.threshold = None
        calibration = os.environ.get("AGENTGATE_THREAT_CALIBRATION")
        if calibration:
            artifact = json.loads(Path(calibration).read_text(encoding="utf-8"))
            if artifact.get("split") != "validation" or artifact.get("identities") != [[self.name, self.revision]]:
                raise ValueError("Calibration model/revision mismatch")
            threshold = artifact.get("threshold")
            if type(threshold) not in (int, float) or not 0 <= threshold <= 1:
                raise ValueError("Invalid calibration threshold")
            self.threshold = threshold
        labels = {int(k): str(v).upper() for k, v in self.model.config.id2label.items()}
        if labels != {0: "SAFE", 1: "INJECTION"}:
            raise RuntimeError("Unexpected model labels: " + str(labels))

    def detect(self, text):
        started = time.perf_counter()
        encoded = self.tokenizer(text, truncation=True, max_length=512, stride=64,
                                 return_overflowing_tokens=True, padding=True, return_tensors="pt")
        encoded.pop("overflow_to_sample_mapping", None)
        windows = encoded["input_ids"].shape[0]
        if windows > 64:
            raise ValueError("Too many windows")
        scores = []
        with self.torch.inference_mode():
            for offset in range(0, windows, 4):
                batch = {key: value[offset:offset + 4] for key, value in encoded.items()}
                scores.extend(self.model(**batch).logits.softmax(dim=-1)[:, 1].tolist())
        result = {"model": self.name, "revision": self.revision, "score": max(scores),
                  "windows": windows, "durationMs": (time.perf_counter() - started) * 1000}
        if self.threshold is not None:
            result["threshold"] = self.threshold
        return result

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Do not log prompt content.
    def reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        # JSON-only, no CORS: browsers cannot use this service cross-origin.
        if self.path != "/detect":
            return self.reply(404, {"error": "Not found"})
        if self.headers.get("Origin") or self.headers.get_content_type() != "application/json":
            return self.reply(403, {"error": "Server-to-server JSON required"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 40000:
                return self.reply(413, {"error": "Invalid body size"})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or set(payload) != {"text"}:
                raise ValueError("Invalid fields")
            text = payload["text"]
            if not isinstance(text, str) or not text.strip() or len(text) > 6000:
                raise ValueError("Invalid text")
            result = self.server.detector.detect(text)
        except (ValueError, UnicodeError):
            return self.reply(400, {"error": "Invalid input"})
        except Exception:
            return self.reply(503, {"error": "Inference failed"})
        self.reply(200, result)
    def setup(self):
        super().setup()
        self.connection.settimeout(25)

if __name__ == "__main__":
    detector = Detector()
    server = HTTPServer(("127.0.0.1", 8765), Handler)
    server.detector = detector
    print("Threat detector ready at http://127.0.0.1:8765", flush=True)
    server.serve_forever()
