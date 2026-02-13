#!/usr/bin/env python3


def validate_vector(v: dict) -> tuple[bool, str]:
    if not isinstance(v, dict):
        return False, 'vector is not an object'
    if not v.get('id'):
        return False, 'missing id'
    if 'metadata' not in v or not isinstance(v['metadata'], dict):
        return False, 'missing metadata'
    if 'text' in v and not isinstance(v['text'], str):
        return False, 'text must be string'
    return True, ''


def validate_vectors(vectors: list[dict]) -> tuple[bool, str]:
    for i, v in enumerate(vectors):
        ok, msg = validate_vector(v)
        if not ok:
            return False, f'vector[{i}] invalid: {msg}'
    return True, ''
