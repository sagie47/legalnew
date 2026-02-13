#!/usr/bin/env python3
import json
import os
import time
from urllib import request as urllib_request
from urllib import error as urllib_error

from openai import OpenAI, RateLimitError


def get_embedding_client() -> tuple[OpenAI | None, str]:
    provider = os.getenv('EMBEDDING_PROVIDER', 'pinecone')

    if provider == 'pinecone':
        model = os.getenv('EMBEDDING_MODEL') or 'llama-text-embed-v2'
        return None, model

    nvidia_key = os.getenv('NVIDIA_API_KEY')
    openai_key = os.getenv('OPENAI_API_KEY')

    if nvidia_key:
        base_url = os.getenv('NVIDIA_BASE_URL', 'https://api.nvidia.com/v1')
        client = OpenAI(api_key=nvidia_key, base_url=base_url)
        model = os.getenv('EMBEDDING_MODEL') or 'nvidia/nv-embed-v1'
    else:
        client = OpenAI(api_key=openai_key)
        model = os.getenv('EMBEDDING_MODEL') or 'text-embedding-3-small'

    return client, model


def embed_texts(client: OpenAI | None, model: str, texts: list[str], max_retries: int = 3) -> list[list[float]]:
    provider = os.getenv('EMBEDDING_PROVIDER', 'pinecone')

    for attempt in range(max_retries):
        try:
            if provider == 'pinecone':
                api_key = os.getenv('PINECONE_API_KEY') or ''
                base_url = (os.getenv('EMBEDDING_BASE_URL') or 'https://api.pinecone.io').rstrip('/')
                api_version = os.getenv('PINECONE_API_VERSION', '2025-10')
                dimension = os.getenv('EMBEDDING_DIM')
                body = {
                    'model': model,
                    'inputs': [{'text': t} for t in texts],
                    'parameters': {'input_type': 'passage', 'truncate': 'END'},
                }
                if dimension:
                    try:
                        body['parameters']['dimension'] = int(dimension)
                    except ValueError:
                        pass

                req = urllib_request.Request(
                    f'{base_url}/embed',
                    data=json.dumps(body).encode('utf-8'),
                    headers={
                        'Content-Type': 'application/json',
                        'Api-Key': api_key,
                        'X-Pinecone-API-Version': api_version,
                    },
                    method='POST',
                )
                with urllib_request.urlopen(req, timeout=30) as resp:
                    payload = json.loads(resp.read().decode('utf-8'))
                data = payload.get('data') or []
                return [d.get('values') for d in data if isinstance(d, dict) and isinstance(d.get('values'), list)]

            if client is None:
                raise RuntimeError('Embedding client is missing for non-pinecone provider')
            response = client.embeddings.create(model=model, input=texts)
            return [e.embedding for e in response.data]
        except RateLimitError:
            time.sleep((2 ** attempt) + (attempt * 0.1))
        except urllib_error.HTTPError:
            if attempt == max_retries - 1:
                return []
            time.sleep(1)
        except urllib_error.URLError:
            if attempt == max_retries - 1:
                return []
            time.sleep(1)
        except Exception:
            if attempt == max_retries - 1:
                return []
            time.sleep(1)

    return []


def attach_embeddings(vectors: list[dict], client: OpenAI | None, model: str, dry_run: bool = False) -> list[dict]:
    if dry_run:
        for v in vectors:
            v['values'] = [0.0] * 16
        return vectors

    batch_size = int(os.getenv('PDF_EMBED_BATCH_SIZE', '32'))
    if batch_size <= 0:
        batch_size = 32

    out = []
    for i in range(0, len(vectors), batch_size):
        batch = vectors[i:i + batch_size]
        texts = [v.get('text_embed') or v.get('text') or '' for v in batch]
        embeds = embed_texts(client, model, texts)
        if len(embeds) != len(batch):
            return []

        for v, e in zip(batch, embeds):
            out.append({'id': v['id'], 'values': e, 'metadata': v['metadata']})

    return out
