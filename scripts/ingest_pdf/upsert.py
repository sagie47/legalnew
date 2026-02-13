#!/usr/bin/env python3
import json
from typing import Any

from pinecone import Pinecone


def init_index() -> Any:
    import os

    api_key = os.getenv('PINECONE_API_KEY')
    if not api_key:
        raise RuntimeError('PINECONE_API_KEY not set')

    index_name = os.getenv('PINECONE_INDEX_NAME')
    index_host = os.getenv('PINECONE_INDEX_HOST')
    if not index_name and not index_host:
        raise RuntimeError('PINECONE_INDEX_NAME or PINECONE_INDEX_HOST must be set')

    pc = Pinecone(api_key=api_key)
    if index_host:
        host = index_host.strip().rstrip('/')
        if not host.startswith('http://') and not host.startswith('https://'):
            host = f'https://{host}'
        return pc.Index(host=host)
    return pc.Index(index_name)


def delete_existing_source_vectors(index: Any, namespace: str, source_id: str) -> None:
    index.delete(filter={'source_id': {'$eq': source_id}}, namespace=namespace)


def filter_existing_vectors(index: Any, namespace: str, vectors: list[dict], fetch_batch_size: int = 50) -> list[dict]:
    if not vectors:
        return vectors

    existing_ids = set()
    ids = [v.get('id') for v in vectors if v.get('id')]
    for i in range(0, len(ids), fetch_batch_size):
        batch_ids = ids[i:i + fetch_batch_size]
        response = index.fetch(ids=batch_ids, namespace=namespace)
        vectors_map = None
        if isinstance(response, dict):
            vectors_map = response.get('vectors') or {}
        elif hasattr(response, 'vectors'):
            vectors_map = response.vectors or {}
        elif hasattr(response, 'to_dict'):
            vectors_map = (response.to_dict() or {}).get('vectors') or {}

        if isinstance(vectors_map, dict):
            existing_ids.update(vectors_map.keys())
        elif isinstance(vectors_map, list):
            for item in vectors_map:
                if isinstance(item, dict) and item.get('id'):
                    existing_ids.add(item['id'])

    return [v for v in vectors if v.get('id') not in existing_ids]


def _calculate_batch_size(vectors: list[dict], max_bytes: int = 1800000) -> int:
    if not vectors:
        return 0
    total_size = sum(len(json.dumps(v)) for v in vectors)
    avg_size = total_size / len(vectors)
    return max(1, int(max_bytes / avg_size))


def upsert_batches(index: Any, namespace: str, vectors: list[dict], target_batch_size: int = 100) -> int:
    total_upserted = 0
    i = 0
    while i < len(vectors):
        remaining = vectors[i:]
        batch_size = min(target_batch_size, len(remaining))
        byte_limited = _calculate_batch_size(remaining[:batch_size])
        take = min(batch_size, byte_limited)
        batch = remaining[:take]
        index.upsert(vectors=batch, namespace=namespace)
        total_upserted += len(batch)
        i += take
    return total_upserted
