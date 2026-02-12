# Markdown Ingestion Worker

Python worker that indexes cleaned legal content from markdown files into Pinecone under the `immigration-v2` namespace.

## Setup

```bash
cd scripts/ingest_md
pip install -r requirements.txt
```

## Environment Variables

Required:
- `PINECONE_API_KEY` - Pinecone API key
- `PINECONE_INDEX_NAME` - Pinecone index name (e.g., "ircc-policy")
- `OPENAI_API_KEY` or `NVIDIA_API_KEY` - Embedding provider API key

Optional:
- `PINECONE_INDEX_HOST` - Pinecone index host (if not using index lookup)
- `PINECONE_NAMESPACE` - Target namespace (default: `immigration-v2`)
- `EMBED_MODEL` - Embedding model name (default: `text-embedding-3-small`)
- `MD_DIRECTORY` - Input markdown directory (default: `./markdown`)

## Usage

Run from the project root directory (`/workspaces/legalnew`):

```bash
# Basic run on existing data
python scripts/ingest_md/ingest_md.py --directory scripts/scraper/ircc_data_clean

# With options
python scripts/ingest_md/ingest_md.py \
  --directory scripts/scraper/ircc_data_clean \
  --namespace immigration-v2 \
  --dry-run

# Full options
python scripts/ingest_md/ingest_md.py \
  --directory scripts/scraper/ircc_data_clean \
  --namespace immigration-v2 \
  --file-glob "*.md" \
  --max-files 1000 \
  --dry-run
```

## Features

- Parses YAML frontmatter from markdown files
- Cleans and enriches text (removes images, converts links, adds legal term context)
- Chunks documents with overlap
- Generates stable IDs to prevent ghost vectors
- Pre-deletes old vectors per document before upserting
- Batches embeddings and upserts for efficiency

## Cutover Plan

1. Run ingestion to populate `immigration-v2` namespace
2. Validate with `validate_namespace.py`
3. Test app retrieval against v2 in staging
4. Flip `PINECONE_NAMESPACE=immigration-v2` in production
5. Monitor quality/latency
6. Rollback: switch back to previous namespace
