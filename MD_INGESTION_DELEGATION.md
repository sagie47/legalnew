# Delegation: Markdown -> Pinecone Ingestion (Phase 1)

## Goal
Build a production-safe Markdown ingestion worker that indexes cleaned legal content into Pinecone under a blue/green namespace (`immigration-v2`) while preserving citation metadata for the app UI.

This is a **bounded implementation**: one engineer can complete it independently without blocking chat runtime work.

---

## Why This Matters
- Improves retrieval quality by removing URL clutter from embedding text.
- Preserves citation links in metadata (`url` / `source_url`) for clickable sources.
- Supports safer rollout via namespace cutover (`v1` -> `v2`) with rollback.
- Prevents ghost vectors when files change.

---

## Scope (Bounded)

### In scope
1. Python ingestion worker for local `.md` corpus.
2. Frontmatter parse + text cleaning + legal term enrichment.
3. Chunking + embedding + Pinecone upsert into `immigration-v2`.
4. Stable IDs + per-document replace strategy to avoid duplicates/ghosts.
5. Validation script + runbook.

### Out of scope
- Changes to runtime retrieval logic in `server/clients/pinecone.js`.
- OCR/document upload pipeline.
- Multi-tenant indexing strategy.

---

## Contract With Existing App (Do Not Break)
The current app reads citation/source fields from Pinecone metadata and backend mappers.

Required metadata keys per chunk:
- `text` (clean chunk text used by LLM)
- `title`
- `url` and `source_url` (store both for compatibility)
- `source_type` (recommended: `guidance_pdi`)
- `last_updated`
- `manual` (fallback `General`)
- `source_file` (relative file path)
- `source_id` (stable per file)
- `chunk_index`
- `chunk_id`
- `content_hash` (hash of cleaned full document)

Optional but recommended:
- `heading_path` (if available)
- `chapter`

---

## Target Files To Add
- `scripts/ingest_md/ingest_md.py`
- `scripts/ingest_md/requirements.txt`
- `scripts/ingest_md/README.md`
- `scripts/ingest_md/validate_namespace.py`

Keep this worker isolated from server runtime code.

---

## Environment Variables
- `PINECONE_API_KEY` (required)
- `PINECONE_INDEX_HOST` (required if using raw HTTP; optional with SDK index lookup)
- `PINECONE_INDEX_NAME` (required)
- `PINECONE_NAMESPACE=immigration-v2` (default)
- `NVIDIA_API_KEY` or `OPENAI_API_KEY` (embedding provider)
- `EMBED_MODEL` (default set in script)
- `MD_DIRECTORY` (input root)

---

## Dependency Set (Use These)
Prefer modern packages:

```bash
pip install pinecone langchain-text-splitters python-frontmatter openai
```

Note: Use `pinecone` (not legacy `pinecone-client`) with `from pinecone import Pinecone`.

---

## Implementation Requirements

### 1) Parsing
- Read `.md` files recursively from input directory.
- Parse YAML frontmatter via `python-frontmatter`.
- If frontmatter missing/invalid, skip file and log error.

### 2) Cleaning & Enrichment
Apply in this order:
1. Remove images: `![alt](url)` -> ``
2. Convert links: `[label](url)` -> `label`
3. Legal enrichment:
   - `R205(d)` -> `R205(d) (Regulation 205)`
   - `A25(1)` -> `A25(1) (Act Section 25)`
4. Normalize whitespace (do not collapse everything into one line; preserve paragraph boundaries where possible).

Suggested regexes:
- Images: `r'!\[[^\]]*\]\([^\)]+\)'`
- Links: `r'(?<!!)\[([^\]]+)\]\([^\)]+\)'`

### 3) Chunking
- Use `RecursiveCharacterTextSplitter`.
- Defaults:
  - `chunk_size=1000`
  - `chunk_overlap=150`
  - `separators=["\n\n", "\n", " ", ""]`

### 4) Stable IDs + Ghost Prevention
Use file-stable IDs:
- `source_id = md5(relative_path_lowercase)[:12]`
- `chunk_id = f"md|{source_id}|{chunk_index}"`

Before upserting a file’s new chunks, delete existing vectors for that file in target namespace:
- delete by filter: `{"source_id": {"$eq": source_id}}`

This ensures no ghost vectors when chunk counts shift.

### 5) Metadata Mapping
Map frontmatter + derived fields:
- `title`: frontmatter `title` else filename
- `url`: frontmatter `url` else `""`
- `source_url`: same as `url`
- `last_updated`: frontmatter `last_updated` else `ingest_date` else today
- `manual`: frontmatter `manual` else `General`
- `source_type`: `guidance_pdi`
- `source_file`: relative path
- `source_id`: derived
- `chunk_index`: int
- `chunk_id`: vector id
- `content_hash`: hash(cleaned full doc)
- `text`: chunk text

### 6) Embedding
- Batch embed multiple chunks per request.
- Add retry/backoff for 429/5xx.
- Log and continue on batch failure; do not crash whole run.

### 7) Upsert
- Batch size target: 100 vectors.
- Also cap by request bytes (2MB hard limit; keep <= ~1.8MB).
- Log upsert counts and failures.

### 8) CLI Flags
Support at least:
- `--directory`
- `--namespace`
- `--dry-run`
- `--max-files`
- `--file-glob` (default `*.md`)

---

## Suggested Script Skeleton (Engineer can adapt)
- `clean_and_enrich_text(text) -> str`
- `derive_source_id(rel_path) -> str`
- `process_file(path) -> list[vector]`
- `delete_existing_source_vectors(index, namespace, source_id)`
- `embed_chunks(texts) -> list[embedding]`
- `upsert_batches(index, namespace, vectors)`
- `main()`

---

## Validation Checklist
After run:
1. Pinecone namespace `immigration-v2` exists and has vectors.
2. Spot-check at least 3 vectors include non-empty:
   - `metadata.url`
   - `metadata.source_url`
   - `metadata.title`
   - `metadata.text`
3. Verify legal enrichment present in chunk text (e.g., contains `Regulation 205`).
4. Re-run ingestion on same files:
   - no vector count blow-up from duplicates
   - updated file replaces old vectors cleanly

---

## Cutover Plan (Blue/Green)
1. Ingest and validate in `immigration-v2`.
2. Smoke-test app retrieval against v2 namespace in staging.
3. Flip env in app:
   - `PINECONE_NAMESPACE=immigration-v2`
4. Monitor quality/latency.
5. Rollback path: switch namespace back to previous value.

---

## Deliverables
Engineer should submit:
1. `scripts/ingest_md/ingest_md.py`
2. `scripts/ingest_md/requirements.txt`
3. `scripts/ingest_md/README.md` with run commands and env vars
4. Validation output summary:
   - files processed
   - chunks embedded
   - vectors upserted
   - failures/skips

---

## Risks & Mitigations
- **Regex misses edge-case markdown links** -> acceptable in Phase 1; document known limits.
- **Embedding rate limits** -> exponential backoff + reduced concurrency.
- **Large metadata payloads** -> size-aware batching.
- **Ghost vectors** -> required pre-delete per `source_id`.

---

## Acceptance Criteria (Phase 1 Complete)
- Worker runs end-to-end on existing markdown corpus.
- Namespace `immigration-v2` populated with clean, citation-ready metadata.
- Re-run is idempotent (no duplicate growth for unchanged files).
- App can switch namespace and still render clickable citations from metadata URLs.
