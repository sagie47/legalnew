# Canada.ca Clean Scraper

Python scripts for scraping Canada.ca immigration content using Jina AI Reader API with content selection.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. (Optional) Get a Jina AI API key for higher rate limits:
   - Visit https://jina.ai/reader/
   - Set it as an environment variable: `export JINA_API_KEY="jina_..."`

## Scripts

### 1. `scrape.py` - Recursive Crawler (Recommended)

Basic usage (starts from functional guidance TOC URL):
```bash
python scrape.py
```

Default behavior also reads seed URLs from `input_links.md` in this folder.
Disable with:
```bash
python scrape.py --no-input-links-md
```

Example with tighter bounds:
```bash
python scrape.py \
  --max-depth 2 \
  --max-pages 150 \
  --output-dir ircc_data_clean
```

Example with custom seed URL:
```bash
python scrape.py \
  --url "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/refugee-protection.html" \
  --max-depth 3
```

`scrape.py` now includes:
- recursive BFS crawl
- canonical URL dedupe (fragments + tracking params removed)
- strict host/path allowlisting
- custom ingestion target filter:
  - keep `.../operational-bulletins-manuals/...`
  - keep `visit/visas.asp`
  - drop generic `/services/` except `transit/without-visa`
- retry/backoff handling for transient failures
- state checkpointing for resume (`_crawl_state.json`)
- manifest and failure logs (`manifest.json`, `failed_urls.json`)
- markdown output with YAML frontmatter metadata

### 2. `hub_scraper.py` - Extract Links from Hub Page

Extract all links from a hub/index page:
```bash
python hub_scraper.py
```

This saves extracted links to `data/hub_links.json`.

### 3. `bulk_ingest.py` - Bulk Scraping

Three modes of operation:

**Mode A: Scrape from hub page (automatic link extraction)**
```bash
python bulk_ingest.py hub <hub_url> [pattern]

# Example:
python bulk_ingest.py hub "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/refugee-protection.html" "refugee-protection"
```

**Mode B: Scrape from JSON file**
```bash
python bulk_ingest.py file <path_to_json>

# Example:
python bulk_ingest.py file data/hub_links.json
```

**Mode C: Scrape specific URLs**
```bash
python bulk_ingest.py list <url1> <url2> ...

# Example:
python bulk_ingest.py list "https://.../page1.html" "https://.../page2.html"
```

## Key Jina Headers Used

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Target-Selector` | `main` | Extracts only the main content element (best for Canada.ca) |
| `X-Exclude-Selector` | `.gcweb-menu, #wb-info` | Removes navigation/footer elements |
| `X-Return-Format` | `markdown` | Returns clean markdown format |
| `Authorization` | `Bearer <API_KEY>` | (Optional) Higher rate limits with API key |

**Note:** For Canada.ca pages, use `main` selector instead of `#wb-cont`. The `#wb-cont` ID only captures headers on hub pages, while `main` gets the actual content (3,000+ chars vs 300 chars).

## Output

`scrape.py` writes into `ircc_data_clean/` (or `--output-dir`) and produces:
- markdown files (`*.md`)
- `manifest.json`
- `failed_urls.json`
- `_crawl_state.json`

`bulk_ingest.py` writes into `data/`.

## Rate Limiting

- `scrape.py` default delay: 1.5 seconds between successful pages
- `bulk_ingest.py` default delay: 2 seconds between requests
- With API key: Can reduce delay or remove it entirely
- Failed URLs are saved to `data/failed_urls.json` for retry

## Example Workflow

```bash
# 1. Extract links from a hub page
python hub_scraper.py

# 2. Scrape all extracted links
python bulk_ingest.py file data/hub_links.json

# 3. Check for failures and retry if needed
python bulk_ingest.py file data/failed_urls.json
```
