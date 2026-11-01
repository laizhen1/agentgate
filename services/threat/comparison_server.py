"""Offline CPU serving of pinned upstream/adapted models. Local paths never enter HTTP responses."""
import argparse
import hashlib
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

class ComparisonDetector:
    def __init__(self, source, selection, name):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer
        self.torch = torch
        artifact = json.loads(selection.read_text(encoding='utf-8'))
        weight_hash = digest(source / 'model.safetensors')
        if name == 'finetuned' and weight_hash != artifact['revision']:
            raise ValueError('Fine-tuned weight hash differs from selection evidence')
        self.tokenizer = AutoTokenizer.from_pretrained(source, local_files_only=True, trust_remote_code=False)
        self.model = AutoModelForSequenceClassification.from_pretrained(
            source, local_files_only=True, trust_remote_code=False, use_safetensors=True).float().eval()
        if {int(k): v.upper() for k, v in self.model.config.id2label.items()} != {0: 'SAFE', 1: 'INJECTION'}:
            raise ValueError('Unexpected labels')
        self.info = {'model': name, 'revision': weight_hash, 'threshold': artifact['threshold'],
                     'files': {p.name: digest(p) for p in sorted(source.iterdir()) if p.is_file()},
                     'selectionSha256': digest(selection), 'device': 'cpu', 'dtype': 'float32'}

    def detect(self, text):
        started = time.perf_counter()
        encoded = self.tokenizer(text, truncation=True, max_length=512, stride=64,
                                 return_overflowing_tokens=True, padding=True, return_tensors='pt')
        encoded.pop('overflow_to_sample_mapping', None)
        windows = encoded['input_ids'].shape[0]
        if windows > 64:
            raise ValueError('Too many windows')
        scores = []
        with self.torch.inference_mode():
            for offset in range(0, windows, 4):
                batch = {key: value[offset:offset + 4] for key, value in encoded.items()}
                scores.extend(self.model(**batch).logits.softmax(-1)[:, 1].tolist())
        return {key: self.info[key] for key in ('model', 'revision', 'threshold')} | {
            'score': max(scores), 'windows': windows, 'durationMs': (time.perf_counter() - started) * 1000}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, value):
        data = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != '/metadata' or self.headers.get('Origin'):
            return self.reply(404, {'error': 'Not found'})
        self.reply(200, self.server.metadata)

    def do_POST(self):
        if self.path not in ('/upstream', '/finetuned'):
            return self.reply(404, {'error': 'Not found'})
        if self.headers.get('Origin') or self.headers.get_content_type() != 'application/json':
            return self.reply(403, {'error': 'Server-to-server JSON required'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 40000:
                raise ValueError('Invalid size')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or set(payload) != {'text'}:
                raise ValueError('Invalid fields')
            text = payload['text']
            if not isinstance(text, str) or not text.strip() or len(text) > 6000:
                raise ValueError('Invalid text')
            result = self.server.detectors[self.path[1:]].detect(text)
        except (ValueError, UnicodeError):
            return self.reply(400, {'error': 'Invalid input'})
        except Exception:
            return self.reply(503, {'error': 'Detector inference failed'})
        self.reply(200, result)

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--finetuned', type=Path, required=True)
    parser.add_argument('--results', type=Path, required=True)
    parser.add_argument('--port', type=int, default=8767)
    args = parser.parse_args()
    import torch
    import transformers
    torch.set_num_threads(4)
    detectors = {
        'upstream': ComparisonDetector(args.upstream, args.results / 'pretrained/selection.json', 'upstream'),
        'finetuned': ComparisonDetector(args.finetuned, args.results / 'deberta-lr5e-05-seed42/selection.json', 'finetuned'),
    }
    for detector in detectors.values():
        detector.detect('Development supplier note: standard delivery is seven days.')
    server = HTTPServer(('127.0.0.1', args.port), Handler)
    server.detectors = detectors
    server.metadata = {'models': {key: value.info for key, value in detectors.items()},
                       'runtime': {'torch': torch.__version__, 'transformers': transformers.__version__,
                                   'threads': 4, 'device': 'cpu', 'warmup': True}}
    print('Comparison detectors ready', flush=True)
    server.serve_forever()
