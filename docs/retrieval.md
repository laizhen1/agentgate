# Governed document retrieval

The Documents tab accepts plain-text supplier briefs and procurement references.
Owners/admins add immutable document versions, enable/disable retrieval, and remove
documents. Operators can search; all organization members can inspect source text
and saved run evidence. Documents and MCP tokens are organization-scoped. There
are no per-user private documents within an organization.

## Local setup

Install Ollama and download an embedding model, then start the local Python service:

```powershell
ollama pull embeddinggemma
py -3.12 -m venv .venv-retrieval
.\.venv-retrieval\Scripts\python.exe -m pip install -r services/retrieval/requirements.txt
.\.venv-retrieval\Scripts\python.exe services/retrieval/server.py
```

Add to `.dev.vars` and restart the app:

```text
AGENTGATE_RETRIEVAL_URL=http://127.0.0.1:8766
```

Optional service environment variables:

- `AGENTGATE_EMBED_MODEL`: default `embeddinggemma`; must already exist in local Ollama.
- `AGENTGATE_RETRIEVAL_MIN_SCORE`: default `0.3`, cosine-similarity cutoff in [-1, 1].
  This is an experimental retrieval cutoff, not a factual-confidence threshold.

The service calls Ollama only at `127.0.0.1:11434`. It rejects redirects, browser
origins, malformed inputs, and oversized payloads. The hosted app cannot reach your
laptop; this is a local development workflow, like the existing Ollama integration.

## Use

1. Create/select a lab organization. New organizations allow `search_documents`;
   existing organizations must explicitly enable it in Policy & team.
2. Add a document with title, source reference, and text. Source references are
   labels, not URLs that the server fetches. Limits: 12 documents, 6,000 characters
   each, 36,000 characters total, and the existing organization storage cap.
3. Use Find evidence to inspect retrieved passages and stable citation IDs.
4. Start an agent run: “Use search_documents to explain the supplier warranty.
   Cite the evidence and say when information is missing.”
5. An authenticated MCP client can also call `search_documents` with `{ "query":
"supplier warranty" }` through the same policy gateway.

## Data and trust boundaries

The application splits enabled documents into 800-character passages with a
120-character overlap and sends only that organization's authorized corpus to the
retriever. Each citation contains document ID, content version, character offset,
title, source, and the exact stored excerpt. The backend rejects returned IDs that
are absent from the authorized corpus; the service cannot invent source text.

The Python service creates Ollama embeddings and a FAISS exact inner-product index
over normalized vectors. Each request builds its index exclusively from its supplied
corpus. A bounded 256-entry memory cache reuses embeddings by model digest and text;
it never expands a searchable corpus. Digests are checked before and after embedding
to reject model changes mid-request. No vectors/documents are persisted by this
service; source documents persist in the application's audited organization state.
This lazy indexing design suits the bounded lab corpus; persistent indexes and
separate document tables are future scaling work.

Search enforces current organization policy even for experimental baseline runs.
Membership/token authorization and document enablement are checked against the
state being committed, with optimistic-concurrency retries if that state changes.
Disabled/deleted documents are excluded from new searches. Existing conversations,
exports, and audit evidence can retain earlier excerpts; removing a document does
not erase those records or retroactively revoke text already disclosed.

No hits returns `insufficient_evidence`. Service failures are explicit failures,
not empty successful searches. Retrieved passages are labeled untrusted and cannot
change the executable policy or authorize tools. The model is instructed to cite
passages and abstain when unsupported; citation text does not itself establish
semantic correctness. Grounded-answer evaluation remains future work in README.

## Checks

```powershell
npm test
.\.venv-retrieval\Scripts\python.exe -B -m unittest discover -s services/retrieval -p 'test_*.py'
```

Tests exercise authorization, current-policy revocation, disabled documents,
foreign/duplicate citations, chunk coverage, failure reporting, and request bounds.
The Python suite uses real FAISS with controlled embedding vectors to test corpus
isolation and model-revision cache invalidation; it does not call Ollama. Without
FAISS installed that integration test is explicitly skipped.
