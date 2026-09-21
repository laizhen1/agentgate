import unittest
import importlib.util
from unittest.mock import patch
from server import validate, Retriever


class RetrievalTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("faiss"), "Install retrieval requirements for FAISS integration")
    def test_real_faiss_index_is_request_scoped_and_cache_is_revision_scoped(self):
        retriever = Retriever()
        calls = []
        def request(path, data=None):
            calls.append((path, data))
            return {"embeddings": [[1., 0.] if "warranty" in text else [0., 1.] for text in data["input"]]}
        with patch.object(retriever, "revision", return_value="digest-one"), patch.object(retriever, "request", side_effect=request):
            first = retriever.search({"query": "warranty", "chunks": [{"id": "org-a", "text": "warranty two years"}]})
            self.assertEqual(first["hits"][0]["id"], "org-a")
            other = retriever.search({"query": "warranty", "chunks": [{"id": "org-b", "text": "delivery"}]})
            self.assertEqual(other["hits"], [])
            cached = len(calls)
            retriever.search({"query": "warranty", "chunks": [{"id": "org-a", "text": "warranty two years"}]})
            self.assertEqual(len(calls), cached)
        with patch.object(retriever, "revision", return_value="digest-two"), patch.object(retriever, "request", side_effect=request):
            retriever.search({"query": "warranty", "chunks": [{"id": "org-a", "text": "warranty two years"}]})
            self.assertEqual(len(calls), cached + 1)

    def test_rejects_unbounded_or_ambiguous_corpus(self):
        payload = {"query": "laptop warranty", "chunks": [{"id": "a", "text": "Two years"}]}
        self.assertEqual(validate(payload), payload)
        for bad in ({**payload, "orgId": "spoofed"}, {**payload, "query": ""},
                    {**payload, "chunks": payload["chunks"] * 2},
                    {**payload, "chunks": [{"id": "a", "text": "x" * 801}]}):
            with self.assertRaises(ValueError):
                validate(bad)


if __name__ == "__main__":
    unittest.main()
