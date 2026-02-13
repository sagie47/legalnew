# Scrape Work Queue (Junior)

Last updated: 2026-02-13

## Objective
Prepare scraped PDI page data for reliable chunking and upsert by enforcing a consistent page-level JSON contract and quality gate.

## Ticket 1: URL Canonicalization Utility
Owner: Junior
Estimate: 0.5 day

Deliverables:
- Add `scripts/scraper/url_utils.py` with:
  - `canonicalize_url(url: str) -> str | None`
  - `build_source_id(canonical_url: str) -> str`
- Normalize:
  - lowercase host
  - drop fragments
  - remove tracking query params (`utm_*`, `gclid`, `fbclid`, etc.)
  - collapse duplicate slashes and normalize path trailing slash

Acceptance Criteria:
- 20+ URL fixtures pass expected canonical outputs.
- Same semantic URL always resolves to same `source_id`.

## Ticket 2: Scraped Page JSON Exporter
Owner: Junior
Estimate: 1 day

Deliverables:
- Add `scripts/scraper/export_page_json.py`.
- Input: scraped markdown files (`scripts/scraper/ircc_data_clean/*.md`).
- Output: page-level JSON files under `tmp/scrape_page_json/`.
- Must follow `SCRAPE_JSON_CONTRACT.md`.

Acceptance Criteria:
- Script runs end-to-end on full folder.
- Writes one JSON file per markdown file.
- Includes required fields and non-empty `text`.

## Ticket 3: JSON Contract Validator
Owner: Junior
Estimate: 0.5 day

Deliverables:
- Add `scripts/scraper/validate_scrape_json.py`.
- Validate required fields/types in exported JSON objects.
- Exit code `1` when invalid objects are present.

Acceptance Criteria:
- Reports invalid file count + per-file error lines.
- Exit code behavior is deterministic for CI usage.

## Ticket 4: Quality Report Generator
Owner: Junior
Estimate: 0.5 day

Deliverables:
- Add `scripts/scraper/report_quality.py`.
- Report:
  - total docs
  - empty/short text docs
  - duplicate `content_hash` groups
  - missing `last_updated`
  - top repeated first lines

Acceptance Criteria:
- Produces JSON summary to stdout.
- Works against full scrape output without manual edits.

## Ticket 5: Test Fixtures
Owner: Junior
Estimate: 0.5 day

Deliverables:
- Add fixtures for:
  - TOC-heavy page
  - legal section-heavy page
  - sparse/near-empty page
  - link-heavy page

Acceptance Criteria:
- Validator and quality report scripts run against fixtures in CI/local checks.

## Daily Update Format
Junior should post:
1. What changed (files + command run).
2. What passed/failed.
3. Blockers.
4. Next step.

