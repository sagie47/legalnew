#!/usr/bin/env python3
from pathlib import Path
from typing import List


def discover_pdf_files(directory: str, file_glob: str = '*.pdf', max_files: int | None = None) -> List[Path]:
    base_dir = Path(directory)
    if not base_dir.exists():
        return []
    files = sorted(base_dir.rglob(file_glob))
    if max_files:
        files = files[:max_files]
    return files
