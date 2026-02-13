#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from url_utils import canonicalize_url


REQUIRED_STRING_FIELDS = [
    "source_id",
    "source_type",
    "source_url",
    "canonical_url",
    "title",
    "language",
    "content_hash",
    "crawl_ts",
    "text",
]


def iter_json_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    return sorted([p for p in path.rglob("*.json") if p.name != "summary.json"])


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_record(record: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    for key in REQUIRED_STRING_FIELDS:
        value = record.get(key)
        if not isinstance(value, str) or not value.strip():
            errors.append(f"missing/invalid required string: {key}")

    source_type = record.get("source_type")
    if source_type != "guidance_pdi":
        errors.append("source_type must be guidance_pdi")

    source_url = str(record.get("source_url", "")).strip()
    canonical = str(record.get("canonical_url", "")).strip()
    if source_url and not source_url.startswith(("http://", "https://")):
        errors.append("source_url must be http/https")
    if canonical and not canonical.startswith(("http://", "https://")):
        errors.append("canonical_url must be http/https")

    if canonical and source_url:
        expected = canonicalize_url(source_url)
        if expected and expected != canonical:
            errors.append("canonical_url does not match canonicalized source_url")

    sections = record.get("sections")
    if sections is not None:
        if not isinstance(sections, list):
            errors.append("sections must be a list")
        else:
            for idx, section in enumerate(sections):
                if not isinstance(section, dict):
                    errors.append(f"sections[{idx}] must be object")
                    continue
                heading = section.get("heading")
                text = section.get("text")
                if not isinstance(heading, str) or not heading.strip():
                    errors.append(f"sections[{idx}].heading invalid")
                if not isinstance(text, str):
                    errors.append(f"sections[{idx}].text invalid")

    links = record.get("links")
    if links is not None:
        if not isinstance(links, dict):
            errors.append("links must be object")
        else:
            for key in ("outbound", "internal_children"):
                arr = links.get(key)
                if arr is None:
                    continue
                if not isinstance(arr, list):
                    errors.append(f"links.{key} must be array")
                else:
                    for i, item in enumerate(arr):
                        if not isinstance(item, str):
                            errors.append(f"links.{key}[{i}] must be string")

    quality = record.get("quality")
    if quality is not None and not isinstance(quality, dict):
        errors.append("quality must be object")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate scraped page JSON contract.")
    parser.add_argument("path", nargs="?", default="tmp/scrape_page_json", help="JSON file or directory.")
    args = parser.parse_args()

    base = Path(args.path)
    files = iter_json_files(base)
    if not files:
        print("No JSON files found.")
        raise SystemExit(1)

    invalid = 0
    errors_total = 0
    for path in files:
        try:
            data = read_json(path)
            if not isinstance(data, dict):
                invalid += 1
                errors_total += 1
                print(f"{path}: root must be object")
                continue
            errs = validate_record(data)
            if errs:
                invalid += 1
                errors_total += len(errs)
                for err in errs:
                    print(f"{path}: {err}")
        except Exception as exc:
            invalid += 1
            errors_total += 1
            print(f"{path}: failed to read/parse ({exc})")

    valid = len(files) - invalid
    print(
        json.dumps(
            {
                "files_checked": len(files),
                "files_valid": valid,
                "files_invalid": invalid,
                "errors_total": errors_total,
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if invalid > 0:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

