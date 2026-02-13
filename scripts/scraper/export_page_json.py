#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import frontmatter

from url_utils import build_source_id, canonicalize_url


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
LINK_RE = re.compile(r"\[[^\]]+\]\((https?://[^)\s]+)\)", re.IGNORECASE)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def extract_last_updated(text: str) -> str | None:
    # Canada.ca pages often include "Page details ... YYYY-MM-DD"
    date_matches = re.findall(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
    if not date_matches:
        return None
    return date_matches[-1]


def normalize_text(text: str) -> str:
    out = text.replace("\r\n", "\n").replace("\r", "\n")
    out = re.sub(r"\n{3,}", "\n\n", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    return out.strip()


def parse_sections(text: str, root_title: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    sections = []
    current_heading = root_title
    current_level = 1
    current_lines: list[str] = []
    heading_stack = [root_title]

    def flush():
        if not current_lines:
            return
        body = "\n".join(current_lines).strip()
        if not body:
            return
        anchor = "#" + re.sub(r"[^a-z0-9]+", "-", current_heading.lower()).strip("-")
        sections.append(
            {
                "heading": current_heading,
                "heading_path": heading_stack.copy(),
                "anchor": anchor,
                "text": body,
            }
        )

    for line in lines:
        match = HEADING_RE.match(line.strip())
        if match:
            flush()
            hashes, title = match.groups()
            level = len(hashes)
            title = title.strip() or "Section"
            if level <= 1:
                heading_stack = [title]
            else:
                keep = max(1, level - 1)
                heading_stack = heading_stack[:keep]
                heading_stack.append(title)
            current_heading = title
            current_level = level
            current_lines = []
            continue
        current_lines.append(line)

    flush()
    if not sections:
        sections.append(
            {
                "heading": root_title,
                "heading_path": [root_title],
                "anchor": "#" + re.sub(r"[^a-z0-9]+", "-", root_title.lower()).strip("-"),
                "text": text,
            }
        )
    return sections


def parse_links(markdown_text: str) -> list[str]:
    links = []
    seen = set()
    for url in LINK_RE.findall(markdown_text):
        canonical = canonicalize_url(url) or url
        if canonical in seen:
            continue
        seen.add(canonical)
        links.append(canonical)
    return links


def infer_language(url: str) -> str:
    lower = (url or "").lower()
    if "/fr/" in lower:
        return "fr"
    return "en"


def infer_manual(title: str) -> tuple[str | None, str | None]:
    clean = title.strip()
    if not clean:
        return None, None
    parts = [p.strip() for p in re.split(r"\s*-\s*", clean) if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    return parts[0], None


def build_page_json(md_path: Path, repo_root: Path) -> dict[str, Any]:
    md_path = md_path.resolve()
    post = frontmatter.load(md_path)
    metadata = post.metadata if isinstance(post.metadata, dict) else {}
    body = normalize_text(post.content or "")

    source_url_raw = metadata.get("url") or metadata.get("fetched_url") or ""
    source_url = str(source_url_raw).strip()
    canonical_url = canonicalize_url(source_url) or source_url
    source_id = build_source_id(canonical_url if canonical_url else str(md_path))
    title = str(metadata.get("title") or md_path.stem).strip()
    language = infer_language(canonical_url)

    manual, chapter = infer_manual(title)
    sections = parse_sections(body, root_title=title)
    links = parse_links(body)

    content_hash = str(metadata.get("content_hash") or hashlib.sha256(body.encode("utf-8")).hexdigest())
    last_updated = extract_last_updated(body)

    ingest_date = str(metadata.get("ingest_date") or "").strip()
    if ingest_date:
        crawl_ts = f"{ingest_date}T00:00:00Z"
    else:
        crawl_ts = iso_now()

    try:
        relative_md = md_path.relative_to(repo_root).as_posix()
    except Exception:
        relative_md = md_path.as_posix()

    is_toc_like = "contents" in body.lower() and bool(re.search(r"\.{3,}\s*\d{1,4}\s*$", body, re.MULTILINE))
    is_low_text = len(body) < 300

    return {
        "source_id": source_id,
        "source_type": "guidance_pdi",
        "source_url": source_url,
        "canonical_url": canonical_url,
        "title": title,
        "language": language,
        "manual": manual,
        "chapter": chapter,
        "heading_path": [title] if title else [],
        "last_updated": last_updated,
        "crawl_ts": crawl_ts,
        "http": {
            "status_code": 200,
            "content_type": "text/markdown",
        },
        "content_hash": content_hash,
        "raw_html_path": None,
        "markdown_path": relative_md,
        "text": body,
        "sections": sections,
        "links": {
            "outbound": links,
            "internal_children": [],
        },
        "quality": {
            "is_toc_like": is_toc_like,
            "is_low_text": is_low_text,
            "notes": [],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Export page-level JSON from scraped markdown files.")
    parser.add_argument("--input-dir", default="scripts/scraper/ircc_data_clean", help="Directory with scraped markdown files.")
    parser.add_argument("--output-dir", default="tmp/scrape_page_json", help="Output directory for page JSON files.")
    parser.add_argument("--max-files", type=int, default=None, help="Optional cap on number of markdown files to export.")
    args = parser.parse_args()

    repo_root = Path.cwd().resolve()
    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    md_files = sorted(input_dir.glob("*.md"))
    if args.max_files:
        md_files = md_files[: args.max_files]

    exported = 0
    failed = 0
    for md_path in md_files:
        try:
            page_json = build_page_json(md_path, repo_root=repo_root)
            out_name = md_path.stem + ".json"
            out_path = output_dir / out_name
            out_path.write_text(json.dumps(page_json, ensure_ascii=False, indent=2), encoding="utf-8")
            exported += 1
        except Exception as exc:
            failed += 1
            print(f"failed {md_path}: {exc}")

    summary = {
        "input_dir": str(input_dir),
        "output_dir": str(output_dir),
        "files_discovered": len(sorted(input_dir.glob('*.md'))),
        "files_attempted": len(md_files),
        "files_exported": exported,
        "files_failed": failed,
        "timestamp": iso_now(),
    }
    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
