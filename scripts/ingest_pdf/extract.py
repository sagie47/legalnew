#!/usr/bin/env python3
from pathlib import Path
from typing import Any


def _extract_page_with_pymupdf(page) -> dict[str, Any]:
    page_dict = page.get_text('dict')
    text = page.get_text('text') or ''
    blocks = page_dict.get('blocks', []) if isinstance(page_dict, dict) else []

    figures = []
    for b in blocks:
        if isinstance(b, dict) and b.get('type') == 1:
            bbox = b.get('bbox')
            figures.append({'bbox': bbox, 'kind': 'image_or_chart'})

    return {
        'page_number': page.number + 1,
        'text': text,
        'char_count': len(text),
        'figures': figures,
        'blocks': blocks,
    }


def extract_pdf_document(file_path: Path, enable_ocr: bool = False) -> dict[str, Any]:
    """
    Extract pages with PyMuPDF.
    OCR fallback is a placeholder for future integration.
    """
    try:
        import fitz  # PyMuPDF
    except Exception as exc:
        raise RuntimeError('PyMuPDF is required: pip install pymupdf') from exc

    pages = []
    warnings = []

    with fitz.open(file_path) as doc:
        total_pages = len(doc)
        for page in doc:
            page_obj = _extract_page_with_pymupdf(page)
            if page_obj['char_count'] < 20:
                msg = f'Low text density on page {page_obj["page_number"]}'
                if enable_ocr:
                    msg += ' (OCR fallback not implemented in MVP)'
                warnings.append(msg)
            pages.append(page_obj)

    return {
        'file_path': str(file_path),
        'total_pages': total_pages,
        'pages': pages,
        'warnings': warnings,
    }
