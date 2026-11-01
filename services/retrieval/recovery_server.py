"""Recovery benchmark transport adapter; the frozen FAISS search stays unchanged."""
import json
import urllib.request
from http.server import HTTPServer
from server import Retriever, Handler


class RecoveryRetriever(Retriever):
    def request(self, path, data=None):
        request = urllib.request.Request(
            "http://127.0.0.1:11435/api/" + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json"},
        )

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_):
                raise ValueError("Redirect rejected")

        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
        with opener.open(request, timeout=45) as response:
            raw = response.read(8_000_001)
            if len(raw) > 8_000_000:
                raise ValueError("Oversized embedding response")
            return json.loads(raw)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", 8766), Handler)
    server.retriever = RecoveryRetriever()
    print("Recovery retrieval ready; dedicated Ollama port 11435", flush=True)
    server.serve_forever()
