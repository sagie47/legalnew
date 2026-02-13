#!/usr/bin/env python3
import re
from typing import Any


NUMBERED_HEADING_RE = re.compile(r'^(?P<num>\d+(?:\.\d+)*)(?:[.)])?\s+(?P<title>.+)$')
UPPER_HEADING_RE = re.compile(r'^[A-Z][A-Z0-9 ,:/()\-]{4,}$')


def _normalize_heading_text(text: str) -> str:
    return re.sub(r'\s+', ' ', text.strip()).strip(':-')


def _parse_heading(text: str) -> tuple[int, str] | None:
    line = _normalize_heading_text(text)
    if not line or len(line) < 4 or len(line) > 130:
        return None
    if line.startswith(('-', '*', '•')):
        return None
    if line.endswith((';', ',')):
        return None
    if '(canada.ca)' in line.lower():
        return None
    if re.search(r'\bv\.\s+[A-Z]', line):
        return None
    if re.search(r'\.{3,}', line):
        return None
    if line.lower() in {'table of contents', 'updates to chapter', 'page details'}:
        return None

    numbered = NUMBERED_HEADING_RE.match(line)
    if numbered:
        title = numbered.group('title').strip()
        if len(title) > 100 and ';' in title:
            return None
        level = len(numbered.group('num').split('.'))
        return level, line

    if UPPER_HEADING_RE.match(line):
        return 1, line

    return None


def _apply_heading_stack(stack: list[str], level: int, heading: str) -> list[str]:
    desired_len = max(0, level - 1)
    truncated = stack[:desired_len]
    truncated.append(heading)
    return truncated


def build_sections(normalized: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Section detection with heading hierarchy.
    Falls back to one 'Document' section when headings are unclear.
    """
    pages = normalized.get('pages', [])
    if not pages:
        return []

    sections = []
    heading_stack = ['Document']
    current = {
        'heading': heading_stack[-1],
        'heading_path': heading_stack.copy(),
        'page_start': pages[0]['page_number'],
        'page_end': pages[0]['page_number'],
        'text_parts': [],
    }

    def flush_current():
        text = '\n\n'.join(current['text_parts']).strip()
        if not text:
            return
        sections.append({
            'heading': current['heading'],
            'heading_path': current['heading_path'],
            'page_start': current['page_start'],
            'page_end': current['page_end'],
            'text': text,
        })

    for p in pages:
        page_number = p.get('page_number', 1)
        page_text = p.get('text', '')
        paragraphs = [part.strip() for part in page_text.split('\n\n') if part.strip()]

        if not paragraphs:
            continue

        for para in paragraphs:
            first_line = para.splitlines()[0].strip()
            heading = _parse_heading(first_line)
            if heading:
                flush_current()
                level, heading_text = heading
                heading_stack = _apply_heading_stack(heading_stack, level, heading_text)
                current = {
                    'heading': heading_stack[-1],
                    'heading_path': heading_stack.copy(),
                    'page_start': page_number,
                    'page_end': page_number,
                    'text_parts': [para],
                }
            else:
                current['text_parts'].append(para)
                current['page_end'] = page_number

    flush_current()

    if not sections:
        return [{
            'heading': 'Document',
            'heading_path': ['Document'],
            'page_start': pages[0].get('page_number', 1),
            'page_end': pages[-1].get('page_number', 1),
            'text': normalized.get('full_text', ''),
        }]

    return sections
