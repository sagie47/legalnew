#!/usr/bin/env python3
import json
from pathlib import Path
from typing import Any


def load_state(path: str) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        return {'files': {}, 'runs': []}
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return {'files': {}, 'runs': []}


def save_state(path: str, state: dict[str, Any]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, ensure_ascii=True, indent=2), encoding='utf-8')


def mark_file(state: dict[str, Any], rel_path: str, content_hash: str, status: str, chunks: int, error: str | None = None) -> None:
    state.setdefault('files', {})[rel_path] = {
        'content_hash': content_hash,
        'status': status,
        'chunks': chunks,
        'error': error,
    }
