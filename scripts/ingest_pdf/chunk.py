#!/usr/bin/env python3
import hashlib
import re
from pathlib import Path
from typing import Any

from legal_metadata import build_canonical_metadata
from langchain_text_splitters import RecursiveCharacterTextSplitter


def derive_source_id(rel_path: str) -> str:
    normalized = rel_path.lower().strip()
    return hashlib.md5(normalized.encode()).hexdigest()[:12]


def derive_content_hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()


ACT_TOKEN_RE = re.compile(r'(?<![A-Z0-9])(A\d{1,3}(?:\([^)]+\))?)(?![A-Z0-9])')
REG_TOKEN_RE = re.compile(r'(?<![A-Z0-9])(R\d{1,3}(?:\([^)]+\))?)(?![A-Z0-9])')


def enrich_legal_tokens(text: str) -> str:
    """Conservative enrichment for legal token recall while keeping source text intact."""
    def act_repl(match):
        token = match.group(1)
        tail = text[match.end():match.end() + 32].lower()
        if '(act section' in tail:
            return token
        section = token[1:]
        return f'{token} (Act Section {section})'

    def reg_repl(match):
        token = match.group(1)
        tail = text[match.end():match.end() + 32].lower()
        if '(regulation' in tail:
            return token
        section = token[1:]
        return f'{token} (Regulation {section})'

    enriched = ACT_TOKEN_RE.sub(act_repl, text)
    enriched = REG_TOKEN_RE.sub(reg_repl, enriched)
    return enriched


def derive_manual_code(file_path: Path) -> str:
    stem = file_path.stem.lower()
    match = re.search(r'(?:^|[^a-z0-9])((?:enf|cp|il)\d+(?:-\w+)?|[cio]-\d+(?:\.\d+)?|sor-\d{4}-\d+)', stem)
    if match:
        return match.group(1)
    return re.sub(r'[^a-z0-9\-\.]+', '-', stem)[:48]


def _char_page_ranges(pages: list[dict[str, Any]]) -> list[tuple[int, int, int]]:
    ranges = []
    offset = 0
    for p in pages:
        text = p.get('text', '')
        start = offset
        end = offset + len(text)
        ranges.append((start, end, p.get('page_number', 1)))
        offset = end + 2
    return ranges


def _pages_for_chunk(start: int, end: int, ranges: list[tuple[int, int, int]]) -> tuple[int, int]:
    pages = [pg for rs, re, pg in ranges if not (end < rs or start > re)]
    if not pages:
        return 1, 1
    return min(pages), max(pages)


def build_chunks(
    normalized: dict[str, Any],
    sections: list[dict[str, Any]],
    base_dir: Path,
    chunk_size: int = 1000,
    chunk_overlap: int = 150,
) -> dict[str, Any]:
    file_path = Path(normalized.get('file_path'))
    rel_path = str(file_path.relative_to(base_dir))
    source_id = derive_source_id(rel_path)
    manual_code = derive_manual_code(file_path)
    full_text = normalized.get('full_text', '')
    content_hash = derive_content_hash(full_text)
    page_ranges = _char_page_ranges(normalized.get('pages', []))

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=['\n\n', '\n', ' ', ''],
    )

    vectors = []
    chunk_index = 0
    cursor = 0

    for section in sections:
        section_text = section.get('text', '').strip()
        if not section_text:
            continue
        pieces = splitter.split_text(section_text)
        for piece in pieces:
            piece_original = piece
            piece_enriched = enrich_legal_tokens(piece_original)

            idx = full_text.find(piece, cursor)
            if idx < 0:
                idx = full_text.find(piece)
            if idx >= 0:
                cursor = idx + len(piece)
                p_start, p_end = _pages_for_chunk(idx, idx + len(piece), page_ranges)
            else:
                p_start, p_end = section.get('page_start', 1), section.get('page_end', 1)

            chunk_id = f'pdf|{source_id}|c{chunk_index}'
            heading_path = section.get('heading_path') or [section.get('heading', 'Document')]
            canonical = build_canonical_metadata(
                file_title=file_path.stem,
                manual_code=manual_code,
                section_heading=section.get('heading', 'Document'),
                heading_path=heading_path,
                chunk_text=piece_original,
                full_text=full_text,
            )
            vectors.append({
                'id': chunk_id,
                'text': piece_original,
                'text_embed': piece_enriched,
                'metadata': {
                    'text': piece_original,
                    'text_enriched': piece_enriched,
                    'title': file_path.stem,
                    'source_type': 'guidance_pdf',
                    'source_file': rel_path,
                    'source_id': source_id,
                    'manual_code': manual_code,
                    'chunk_index': chunk_index,
                    'chunk_id': chunk_id,
                    'content_hash': content_hash,
                    'page_start': p_start,
                    'page_end': p_end,
                    'section_heading': section.get('heading', 'Document'),
                    'heading_path': heading_path,
                    **canonical,
                },
            })
            chunk_index += 1

    return {
        'file_path': str(file_path),
        'rel_path': rel_path,
        'source_id': source_id,
        'manual_code': manual_code,
        'content_hash': content_hash,
        'vectors': vectors,
    }
