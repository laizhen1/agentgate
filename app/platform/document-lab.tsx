"use client";
import { useState } from "react";
import type { Org } from "@/lib/platform/domain";
import type { searchDocuments } from "@/lib/platform/retrieval";

type Retrieval = Awaited<ReturnType<typeof searchDocuments>>;
export function DocumentLab({
  org,
  disabled,
  canAdmin,
  canRun,
  command,
}: {
  org: Org;
  disabled: boolean;
  canAdmin: boolean;
  canRun: boolean;
  command: (body: object) => Promise<unknown>;
}) {
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Retrieval | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function perform(body: object) {
    setPending(true);
    setError("");
    setResult(null);
    try {
      return await command({ ...body, orgId: org.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Document operation failed.");
    } finally {
      setPending(false);
    }
  }
  const busy = disabled || pending;
  return (
    <section className="panel">
      <p className="eyebrow">ORGANIZATION KNOWLEDGE / GOVERNED RETRIEVAL</p>
      <h2>Document search</h2>
      <p>
        Search supplier briefs and procurement documentation with source
        citations. All organization members can read documents and run evidence.
        Only enabled documents enter retrieval. Source text cannot change
        executable policy.
      </p>
      {canAdmin && (
        <details>
          <summary>Add a document</summary>
          <label className="field">
            Title
            <input
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            Source or reference
            <input
              value={source}
              maxLength={300}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Supplier brief, September 2026"
            />
          </label>
          <label className="field">
            Document text
            <textarea
              value={text}
              maxLength={6000}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !title.trim() || !source.trim() || !text.trim()}
            onClick={() =>
              void perform({
                operation: "addDocument",
                document: { title, source, text },
              }).then((value) => {
                if (value) {
                  setTitle("");
                  setSource("");
                  setText("");
                }
              })
            }
          >
            Add document
          </button>
          <p className="muted">
            Up to 12 documents / 36,000 characters. Documents are versioned by
            content hash; add a replacement and disable the old version.
          </p>
        </details>
      )}
      {(org.documents ?? []).map((d) => (
        <article className="evidence" key={d.id}>
          <strong>{d.title}</strong>
          <p>
            {d.source} ·{" "}
            {d.enabled ? "Enabled for retrieval" : "Excluded from retrieval"}
          </p>
          <p className="muted">Version {d.version.slice(0, 12)}</p>
          <details>
            <summary>Source text</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{d.text}</pre>
          </details>
          {canAdmin && (
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void perform({
                    operation: "documentAccess",
                    documentId: d.id,
                    enabled: !d.enabled,
                  })
                }
              >
                {d.enabled ? "Disable retrieval" : "Enable retrieval"}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void perform({
                    operation: "deleteDocument",
                    documentId: d.id,
                  })
                }
              >
                Remove document
              </button>
            </div>
          )}
        </article>
      ))}
      {!org.documents?.length && (
        <p className="empty">
          Add a document to search organization knowledge.
        </p>
      )}
      <label className="field">
        Search question
        <input
          value={query}
          maxLength={500}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={busy || !canRun || !query.trim()}
        onClick={() =>
          void perform({ operation: "searchDocuments", query }).then(
            (value) => {
              if (value)
                setResult((value as { retrieval: Retrieval }).retrieval);
            },
          )
        }
      >
        Find evidence
      </button>
      {!org.policy.allowedTools.includes("search_documents") && (
        <p>Enable search_documents in Policy &amp; team before searching.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div aria-live="polite">
          <h3>
            {result.status === "evidence"
              ? "Retrieved evidence"
              : "Insufficient evidence"}
          </h3>
          <p>{result.instruction}</p>
          {result.citations.map((c) => (
            <article className="evidence" key={c.id}>
              <strong>{c.title}</strong>
              <p>
                {c.source} · Similarity {c.score.toFixed(3)}
              </p>
              <pre style={{ whiteSpace: "pre-wrap" }}>{c.text}</pre>
              <small>Citation: [{c.id}]</small>
            </article>
          ))}
        </div>
      )}
      <p className="muted">
        For an answer with citations, start an agent run and ask it to use
        search_documents. Setup: docs/retrieval.md. Removing a document excludes
        it from future searches; earlier run evidence remains in the audit
        history.
      </p>
    </section>
  );
}
