#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


def iter_json_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted([p for p in path.rglob("*.json") if p.name != "summary.json"])


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
        return None
    except Exception:
        return None


def first_nonempty_line(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line:
            return line
    return ""


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate quality report for scraped page JSON files.")
    parser.add_argument("path", nargs="?", default="tmp/scrape_page_json", help="JSON file or directory.")
    parser.add_argument("--short-threshold", type=int, default=400, help="Character threshold for short docs.")
    args = parser.parse_args()

    files = iter_json_files(Path(args.path))
    if not files:
        print(json.dumps({"error": "no json files found"}, indent=2))
        raise SystemExit(1)

    total = 0
    empty_text = []
    short_text = []
    missing_last_updated = []
    missing_heading_path = []
    bad_sections = []
    first_line_counter = Counter()
    hash_to_files: dict[str, list[str]] = defaultdict(list)

    for path in files:
        data = load_json(path)
        if data is None:
            continue
        total += 1

        text = str(data.get("text") or "")
        text_len = len(text.strip())
        if text_len == 0:
            empty_text.append(path.name)
        elif text_len < args.short_threshold:
            short_text.append({"file": path.name, "chars": text_len})

        if not data.get("last_updated"):
            missing_last_updated.append(path.name)

        hp = data.get("heading_path")
        if not isinstance(hp, list) or len(hp) == 0:
            missing_heading_path.append(path.name)

        sections = data.get("sections")
        if isinstance(sections, list):
            for idx, section in enumerate(sections):
                if not isinstance(section, dict):
                    bad_sections.append(f"{path.name}: sections[{idx}] not object")
                    continue
                if not section.get("heading"):
                    bad_sections.append(f"{path.name}: sections[{idx}] missing heading")
        else:
            bad_sections.append(f"{path.name}: sections missing or not list")

        first_line = first_nonempty_line(text)
        if first_line:
            first_line_counter[first_line] += 1

        content_hash = str(data.get("content_hash") or "").strip()
        if content_hash:
            hash_to_files[content_hash].append(path.name)

    duplicate_hash_groups = []
    for content_hash, group in hash_to_files.items():
        if len(group) > 1:
            duplicate_hash_groups.append({"content_hash": content_hash, "files": sorted(group)})

    summary = {
        "files_total": total,
        "empty_text_count": len(empty_text),
        "short_text_count": len(short_text),
        "missing_last_updated_count": len(missing_last_updated),
        "missing_heading_path_count": len(missing_heading_path),
        "bad_sections_count": len(bad_sections),
        "duplicate_content_hash_groups": len(duplicate_hash_groups),
        "top_repeated_first_lines": [
            {"line": line, "count": count}
            for line, count in first_line_counter.most_common(10)
        ],
        "examples": {
            "empty_text": empty_text[:20],
            "short_text": short_text[:20],
            "missing_last_updated": missing_last_updated[:20],
            "missing_heading_path": missing_heading_path[:20],
            "bad_sections": bad_sections[:20],
            "duplicate_content_hash_groups": duplicate_hash_groups[:20],
        },
    }

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

