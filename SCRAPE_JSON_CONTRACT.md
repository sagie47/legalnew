# Scrape JSON Contract

Last updated: 2026-02-13

## Purpose
Defines the page-level JSON structure produced by scraping, before chunking.

## Required Fields
- `source_id`: string, stable ID derived from canonical URL.
- `source_type`: string, fixed value `guidance_pdi`.
- `source_url`: string, original URL.
- `canonical_url`: string, normalized URL.
- `title`: string.
- `language`: string (for current corpus usually `en`).
- `content_hash`: string, SHA-256 of normalized page text.
- `crawl_ts`: string, ISO timestamp.
- `text`: string, cleaned full page text (pre-chunk).

## Optional But Recommended
- `manual`: string.
- `chapter`: string.
- `heading_path`: array of strings.
- `last_updated`: string.
- `http`: object with scrape transport metadata.
- `raw_html_path`: string.
- `markdown_path`: string.
- `sections`: array of section objects.
- `links`: object with outbound and internal child URLs.
- `quality`: object with flags and notes.

## Section Object
- `heading`: string.
- `heading_path`: array of strings.
- `anchor`: string.
- `text`: string.

## Example
```json
{
  "source_id": "pdi_3e9a16e0f5b0",
  "source_type": "guidance_pdi",
  "source_url": "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/temporary-residents/functional-guidance-table-contents.html",
  "canonical_url": "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/temporary-residents/functional-guidance-table-contents.html",
  "title": "Functional guidance: table of contents",
  "language": "en",
  "manual": "Temporary residents",
  "chapter": "Functional guidance",
  "heading_path": ["Functional guidance: table of contents"],
  "last_updated": "2025-02-20",
  "crawl_ts": "2026-02-13T00:00:00Z",
  "http": {
    "status_code": 200,
    "content_type": "text/html"
  },
  "content_hash": "7a6d07f18f5d52c17e75e404b0a6f9fba80c957f6db2f6b1a2ec2e6f0af45a24",
  "raw_html_path": null,
  "markdown_path": "scripts/scraper/ircc_data_clean/functional-guidance-table-contents-f147df03b1.md",
  "text": "Full cleaned text before chunking.",
  "sections": [
    {
      "heading": "Overview",
      "heading_path": ["Functional guidance: table of contents", "Overview"],
      "anchor": "#overview",
      "text": "Section text..."
    }
  ],
  "links": {
    "outbound": [
      "https://www.canada.ca/en/immigration-refugees-citizenship.html"
    ],
    "internal_children": [
      "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/temporary-residents/..."
    ]
  },
  "quality": {
    "is_toc_like": false,
    "is_low_text": false,
    "notes": []
  }
}
```

