"""Local FAISS retrieval over caller-authorized passages; no document persistence."""
import json
import math
import os
import urllib.request
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, HTTPServer


def validate(payload):
    if not isinstance(payload, dict) or set(payload) != {"query", "chunks"}:
        raise ValueError("Invalid fields")
    if not isinstance(payload["query"], str) or not payload["query"].strip() or len(payload["query"]) > 500:
        raise ValueError("Invalid query")
    chunks = payload["chunks"]
    if not isinstance(chunks, list) or not 1 <= len(chunks) <= 72:
        raise ValueError("Invalid chunk count")
    seen = set()
    for chunk in chunks:
        if not isinstance(chunk, dict) or set(chunk) != {"id", "text"}:
            raise ValueError("Invalid chunk")
        if not isinstance(chunk["id"], str) or not 1 <= len(chunk["id"]) <= 200 or chunk["id"] in seen:
            raise ValueError("Invalid chunk ID")
        if not isinstance(chunk["text"], str) or not 1 <= len(chunk["text"]) <= 800:
            raise ValueError("Invalid chunk text")
        seen.add(chunk["id"])
    return payload


class Retriever:
    def __init__(self):
        self.model = os.environ.get("AGENTGATE_EMBED_MODEL", "embeddinggemma")
        self.minimum = float(os.environ.get("AGENTGATE_RETRIEVAL_MIN_SCORE", "0.3"))
        if not math.isfinite(self.minimum) or not -1 <= self.minimum <= 1:
            raise ValueError("Invalid minimum score")
        self.cache = OrderedDict()

    def request(self, path, data=None):
        request = urllib.request.Request("http://127.0.0.1:11434/api/" + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json"})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_):
                raise ValueError("Redirect rejected")
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
        with opener.open(request, timeout=45) as response:
            raw = response.read(8_000_001)
            if len(raw) > 8_000_000:
                raise ValueError("Oversized embedding response")
            return json.loads(raw)

    def revision(self):
        name = self.model if ":" in self.model else self.model + ":latest"
        model = next((m for m in self.request("tags")["models"] if m["name"] == name), None)
        if not model or not isinstance(model.get("digest"), str):
            raise ValueError("Embedding model must be downloaded in Ollama")
        return model["digest"]

    def search(self, payload):
        import faiss
        import numpy as np
        validate(payload)
        revision = self.revision()
        texts = [payload["query"], *[c["text"] for c in payload["chunks"]]]
        missing = list(dict.fromkeys(t for t in texts if (revision, t) not in self.cache))
        if missing:
            vectors = self.request("embed", {"model": self.model, "input": missing, "truncate": False})["embeddings"]
            if len(vectors) != len(missing):
                raise ValueError("Wrong embedding count")
            for text, vector in zip(missing, vectors):
                arr = np.asarray(vector, dtype="float32")
                if arr.ndim != 1 or not 1 <= arr.size <= 4096 or not np.isfinite(arr).all() or np.linalg.norm(arr) == 0:
                    raise ValueError("Invalid embedding")
                self.cache[(revision, text)] = arr / np.linalg.norm(arr)
        matrix = np.stack([self.cache[(revision, t)] for t in texts]).astype("float32")
        if self.revision() != revision:
            raise ValueError("Embedding model changed during search")
        for text in texts:
            self.cache.move_to_end((revision, text))
        while len(self.cache) > 256:
            self.cache.popitem(last=False)
        # A fresh index contains only this request's authorized corpus. Cached vectors
        # never add passages from other organizations to the searchable index.
        index = faiss.IndexFlatIP(matrix.shape[1])
        index.add(matrix[1:])
        scores, indices = index.search(matrix[:1], min(4, len(payload["chunks"])))
        return {"model": self.model, "revision": revision, "hits": [
            {"id": payload["chunks"][int(i)]["id"], "score": float(s)}
            for s, i in zip(scores[0], indices[0]) if s >= self.minimum]}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def setup(self):
        super().setup()
        self.connection.settimeout(60)
    def reply(self, status, body):
        raw = json.dumps(body, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
    def do_POST(self):
        if self.path != "/search":
            return self.reply(404, {"error": "Not found"})
        if self.headers.get("Origin") or self.headers.get_content_type() != "application/json":
            return self.reply(403, {"error": "Server-to-server JSON required"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 400000:
                return self.reply(413, {"error": "Invalid body size"})
            payload = validate(json.loads(self.rfile.read(length)))
        except (ValueError, UnicodeError):
            return self.reply(400, {"error": "Invalid request"})
        try:
            result = self.server.retriever.search(payload)
        except Exception:
            return self.reply(503, {"error": "Retrieval unavailable"})
        self.reply(200, result)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 8766), Handler)
    server.retriever = Retriever()
    print("Retrieval ready at http://127.0.0.1:8766", flush=True)
    server.serve_forever()
