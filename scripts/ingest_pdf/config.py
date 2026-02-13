#!/usr/bin/env python3
import os
from pathlib import Path


def load_env_file(path: str = '.env') -> None:
    """Best-effort .env loader that ignores malformed lines."""
    env_path = Path(path)
    if not env_path.exists():
        return
    try:
        for raw_line in env_path.read_text(encoding='utf-8').splitlines():
            line = raw_line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[len('export '):].strip()
            if '=' not in line:
                continue
            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception:
        # Non-fatal: script can still run with existing environment.
        return


def env_snapshot() -> dict:
    keys = [
        'PINECONE_API_KEY',
        'PINECONE_INDEX_HOST',
        'PINECONE_INDEX_NAME',
        'PINECONE_NAMESPACE',
        'EMBEDDING_PROVIDER',
        'EMBEDDING_MODEL',
        'EMBEDDING_DIM',
        'EMBEDDING_BASE_URL',
        'PINECONE_API_VERSION',
    ]
    result = {}
    for key in keys:
        value = os.getenv(key)
        if value is None:
            result[key] = '<missing>'
        elif 'KEY' in key:
            result[key] = f'<set,len={len(value)}>'
        else:
            result[key] = value
    return result
