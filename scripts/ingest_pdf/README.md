# PDF Ingestion (MVP)

This folder contains a modular PDF ingestion pipeline using PyMuPDF.

## Install

```bash
pip install pymupdf openai pinecone langchain-text-splitters
```

## Smoke Test (No Upsert)

```bash
python scripts/ingest_pdf/ingest_pdf.py \
  --directory scripts/pdfs \
  --namespace ircc-pdf-v1-20260212 \
  --max-files 1 \
  --dry-run \
  --write-chunk-artifacts \
  --artifact-dir tmp/pdf_chunk_preview
```

## One-file Upsert

```bash
python scripts/ingest_pdf/ingest_pdf.py \
  --directory scripts/pdfs \
  --namespace ircc-pdf-v1-20260212 \
  --max-files 1
```

## Resumable Full Run

```bash
python scripts/ingest_pdf/ingest_pdf.py \
  --directory scripts/pdfs \
  --namespace ircc-pdf-v1-20260212 \
  --no-delete-existing-source \
  --skip-existing-ids \
  --state-file tmp/pdf_ingest_state.json
```

## Notes

- Handles inconsistent PDF layouts with fallback heuristics.
- Captures simple figure/chart placeholders by page block type.
- OCR flag is wired but full OCR integration is deferred in MVP.
- Removes repeated header/footer patterns based on top/bottom line frequency.
- Cleans TOC dot-leader noise and trailing page-number leaders.
- Adds conservative legal enrichment for embeddings (e.g., `A34` -> `A34 (Act Section 34)`) while preserving original text.
