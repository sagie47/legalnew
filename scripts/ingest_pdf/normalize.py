#!/usr/bin/env python3
from collections import Counter
from typing import Any
import re


TOC_DOT_LEADER_RE = re.compile(r'^(?P<body>.*?)(?:\.{3,}\s*|\s{2,})(?P<page>\d{1,4})\s*$')
DOTS_ONLY_RE = re.compile(r'^\.*\s*$')
MULTI_DOT_RE = re.compile(r'\.{3,}')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def _canonical_line(line: str) -> str:
    text = line.strip().lower()
    text = re.sub(r'\d+', '#', text)
    text = re.sub(r'\s+', ' ', text)
    return text


def _top_bottom_nonempty(lines: list[str], window: int = 4) -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
    indexed = [(i, ln.strip()) for i, ln in enumerate(lines) if ln.strip()]
    if not indexed:
        return [], []
    top = indexed[:window]
    bottom = indexed[-window:]
    return top, bottom


def _collect_repeated_patterns(pages: list[dict[str, Any]], ratio: float = 0.55) -> tuple[set[str], set[str]]:
    header_counter = Counter()
    footer_counter = Counter()

    for p in pages:
        lines = p.get('text', '').splitlines()
        top, bottom = _top_bottom_nonempty(lines, window=4)

        for _idx, ln in top:
            header_counter[_canonical_line(ln)] += 1
        for _idx, ln in bottom:
            footer_counter[_canonical_line(ln)] += 1

    threshold = max(3, int(len(pages) * ratio))
    repeated_headers = {k for k, v in header_counter.items() if v >= threshold}
    repeated_footers = {k for k, v in footer_counter.items() if v >= threshold}
    return repeated_headers, repeated_footers


def _clean_toc_line(line: str) -> str:
    stripped = line.strip()
    if not stripped:
        return ''
    if DOTS_ONLY_RE.match(stripped):
        return ''

    # Remove dotted leaders and trailing page number in TOC-like entries.
    match = TOC_DOT_LEADER_RE.match(stripped)
    if match and re.search(r'[A-Za-z]', match.group('body') or ''):
        return match.group('body').rstrip()

    # Fallback: collapse long dot runs to a single separator token.
    return MULTI_DOT_RE.sub(' ', stripped).strip()


def _remove_repeated_artifacts(text: str, repeated_headers: set[str], repeated_footers: set[str]) -> str:
    lines = text.splitlines()
    if not lines:
        return text

    top, bottom = _top_bottom_nonempty(lines, window=4)
    drop_idxs = set()

    for idx, ln in top:
        canonical = _canonical_line(ln)
        if canonical in repeated_headers:
            drop_idxs.add(idx)
    for idx, ln in bottom:
        canonical = _canonical_line(ln)
        if canonical in repeated_footers:
            drop_idxs.add(idx)

    kept = []
    for idx, ln in enumerate(lines):
        if idx in drop_idxs:
            continue
        cleaned = _clean_toc_line(ln)
        if cleaned or ln.strip() == '':
            kept.append(cleaned)

    out = '\n'.join(kept)

    # Remove isolated date/footer lines that commonly remain.
    out_lines = []
    for ln in out.splitlines():
        if DATE_RE.match(ln.strip()):
            continue
        out_lines.append(ln)
    out = '\n'.join(out_lines)

    out = re.sub(r'(\w)-\n(\w)', r'\1\2', out)
    out = re.sub(r'\n{3,}', '\n\n', out)
    out = re.sub(r' {2,}', ' ', out)
    return out.strip()


def normalize_document(extracted: dict[str, Any]) -> dict[str, Any]:
    pages = extracted.get('pages', [])
    repeated_headers, repeated_footers = _collect_repeated_patterns(pages)

    norm_pages = []
    all_text_parts = []
    for p in pages:
        txt = _remove_repeated_artifacts(p.get('text', ''), repeated_headers, repeated_footers)
        rec = {
            'page_number': p.get('page_number'),
            'text': txt,
            'char_count': len(txt),
            'figures': p.get('figures', []),
        }
        norm_pages.append(rec)
        if txt:
            all_text_parts.append(txt)

    full_text = '\n\n'.join(all_text_parts).strip()
    return {
        'file_path': extracted.get('file_path'),
        'pages': norm_pages,
        'full_text': full_text,
        'warnings': extracted.get('warnings', []),
        'removed_header_patterns': sorted(repeated_headers),
        'removed_footer_patterns': sorted(repeated_footers),
    }
