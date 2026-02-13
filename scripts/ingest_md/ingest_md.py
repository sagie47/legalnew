#!/usr/bin/env python3
"""
Markdown ingestion worker for IRCC policy documents.
Indexes cleaned legal content into Pinecone with citation metadata.
"""

import argparse
import hashlib
import json
import logging
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from urllib import request as urllib_request
from urllib import error as urllib_error

import frontmatter
from openai import OpenAI, RateLimitError
from pinecone import Pinecone
from langchain_text_splitters import RecursiveCharacterTextSplitter

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# Regex patterns
IMAGE_PATTERN = re.compile(r'!\[[^\]]*\]\([^)]+\)')
LINK_PATTERN = re.compile(r'(?<!!)\[([^\]]+)\]\([^)]+\)')
# Legal term enrichment patterns
R205_PATTERN = re.compile(r'\bR205\(?(\w*)\)?', re.IGNORECASE)
A25_PATTERN = re.compile(r'\bA25\(?(\w*)\)?', re.IGNORECASE)


def load_env_file(path: str = '.env') -> None:
    """
    Best-effort .env loader that ignores malformed bare lines.
    This avoids shell `source .env` failures during local runs.
    """
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
    except Exception as e:
        logger.warning(f"Failed to parse .env file: {e}")


def clean_and_enrich_text(text: str) -> str:
    """Clean markdown and enrich legal terms."""
    # 1. Remove images
    text = IMAGE_PATTERN.sub('', text)
    
    # 2. Convert links: [label](url) -> label
    text = LINK_PATTERN.sub(r'\1', text)
    
    # 3. Legal enrichment
    def replace_r205(match):
        subsec = match.group(1) or 'd'
        return f'R205({subsec}) (Regulation 205)'
    
    def replace_a25(match):
        subsec = match.group(1) or '1'
        return f'A25({subsec}) (Act Section 25)'
    
    text = R205_PATTERN.sub(replace_r205, text)
    text = A25_PATTERN.sub(replace_a25, text)
    
    # 4. Normalize whitespace - preserve paragraph boundaries
    # Collapse multiple newlines to double newline (paragraph break)
    text = re.sub(r'\n{3,}', '\n\n', text)
    # Collapse multiple spaces
    text = re.sub(r' {2,}', ' ', text)
    
    return text.strip()


def derive_source_id(rel_path: str) -> str:
    """Generate stable source_id from relative file path."""
    normalized = rel_path.lower().strip()
    return hashlib.md5(normalized.encode()).hexdigest()[:12]


def derive_content_hash(content: str) -> str:
    """Generate content hash for duplicate detection."""
    return hashlib.sha256(content.encode()).hexdigest()


def get_embedding_client() -> tuple[OpenAI, str]:
    """Initialize embedding client with model."""
    provider = os.getenv('EMBEDDING_PROVIDER', 'pinecone')
    
    if provider == 'pinecone':
        # Pinecone embeds are handled via direct /embed requests in embed_chunks.
        model = os.getenv('EMBEDDING_MODEL') or os.getenv('EMBED_MODEL') or 'llama-text-embed-v2'
        return None, model
    
    # Check for NVIDIA API first, fallback to OpenAI
    nvidia_key = os.getenv('NVIDIA_API_KEY')
    openai_key = os.getenv('OPENAI_API_KEY')
    
    if nvidia_key:
        # Use NVIDIA embedding API
        base_url = os.getenv('NVIDIA_BASE_URL', 'https://api.nvidia.com/v1')
        client = OpenAI(api_key=nvidia_key, base_url=base_url)
        model = os.getenv('EMBEDDING_MODEL') or os.getenv('EMBED_MODEL') or 'nvidia/nv-embed-v1'
    else:
        client = OpenAI(api_key=openai_key)
        model = os.getenv('EMBEDDING_MODEL') or os.getenv('EMBED_MODEL') or 'text-embedding-3-small'
    
    return client, model


def embed_chunks(client: OpenAI, model: str, texts: List[str], max_retries: int = 3) -> List[List[float]]:
    """Embed multiple texts with retry logic."""
    embeddings = []
    provider = os.getenv('EMBEDDING_PROVIDER', 'pinecone')
    
    for attempt in range(max_retries):
        try:
            if provider == 'pinecone':
                # Pinecone embed endpoint: POST /embed
                api_key = os.getenv('PINECONE_API_KEY')
                base_url = (os.getenv('EMBEDDING_BASE_URL') or 'https://api.pinecone.io').rstrip('/')
                api_version = os.getenv('PINECONE_API_VERSION', '2025-10')
                dimension = os.getenv('EMBEDDING_DIM')
                body = {
                    'model': model,
                    'inputs': [{'text': t} for t in texts],
                    'parameters': {
                        'input_type': 'passage',
                        'truncate': 'END'
                    }
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
                        'Api-Key': api_key or '',
                        'X-Pinecone-API-Version': api_version,
                    },
                    method='POST',
                )
                with urllib_request.urlopen(req, timeout=30) as resp:
                    payload = json.loads(resp.read().decode('utf-8'))
                data = payload.get('data') or []
                embeddings = [item.get('values') for item in data if isinstance(item, dict) and isinstance(item.get('values'), list)]
                return embeddings
            else:
                # Standard OpenAI format
                response = client.embeddings.create(model=model, input=texts)
                embeddings = [e.embedding for e in response.data]
                return embeddings
        except RateLimitError:
            wait_time = (2 ** attempt) + (attempt * 0.1)
            logger.warning(f"Rate limit hit, waiting {wait_time:.1f}s...")
            time.sleep(wait_time)
        except urllib_error.HTTPError as e:
            try:
                details = e.read().decode('utf-8')
            except Exception:
                details = str(e)
            logger.error(f"Embedding HTTP error: {e.code} {details}")
            if attempt == max_retries - 1:
                logger.error("Max retries exceeded for batch")
                return []
            time.sleep(1)
        except urllib_error.URLError as e:
            logger.error(f"Embedding network error: {e}")
            if attempt == max_retries - 1:
                logger.error("Max retries exceeded for batch")
                return []
            time.sleep(1)
        except Exception as e:
            logger.error(f"Embedding error: {e}")
            if attempt == max_retries - 1:
                logger.error("Max retries exceeded for batch")
                return []
            time.sleep(1)
    
    return embeddings


def process_file(
    file_path: Path,
    base_dir: Path,
    splitter: RecursiveCharacterTextSplitter,
    client: OpenAI,
    model: str,
    dry_run: bool = False
) -> Optional[List[dict]]:
    """Process a single markdown file into vector records."""
    try:
        # Read and parse frontmatter
        post = frontmatter.load(file_path)
        
        # Validate frontmatter
        if not isinstance(post.metadata, dict):
            logger.error(f"Invalid frontmatter in {file_path}")
            return None
        
        # Get relative path and derive IDs
        rel_path = str(file_path.relative_to(base_dir))
        source_id = derive_source_id(rel_path)
        
        # Clean and enrich text
        cleaned_text = clean_and_enrich_text(post.content)
        if not cleaned_text:
            logger.warning(f"Empty content after cleaning: {file_path}")
            return None
        
        content_hash = derive_content_hash(cleaned_text)
        
        # Extract metadata from frontmatter
        frontmatter_url = post.metadata.get('url', '')
        url = frontmatter_url if frontmatter_url else ''
        title = post.metadata.get('title', file_path.stem)
        last_updated = post.metadata.get('last_updated', datetime.now().isoformat())
        manual = post.metadata.get('manual', 'General')
        chapter = post.metadata.get('chapter', '')
        heading_path = post.metadata.get('heading_path', [])
        
        # Chunk the text
        chunks = splitter.split_text(cleaned_text)
        if not chunks:
            logger.warning(f"No chunks produced from: {file_path}")
            return None
        
        # Generate vectors with metadata
        vectors = []
        for i, chunk_text in enumerate(chunks):
            chunk_id = f"md|{source_id}|{i}"
            
            # Get embedding.
            # For non-dry runs we always call embed_chunks(), including when
            # EMBEDDING_PROVIDER=pinecone (client is intentionally None there).
            if dry_run:
                # Dummy embedding for dry run only.
                embedding = [0.0] * 1536
            else:
                embeddings = embed_chunks(client, model, [chunk_text])
                if not embeddings or not embeddings[0]:
                    logger.warning(f"Failed to embed chunk {i} in {file_path}")
                    continue
                embedding = embeddings[0]
            
            metadata = {
                'text': chunk_text,
                'title': title,
                'url': url,
                'source_url': url,
                'source_type': 'guidance_pdi',
                'last_updated': last_updated,
                'manual': manual,
                'source_file': rel_path,
                'source_id': source_id,
                'chunk_index': i,
                'chunk_id': chunk_id,
                'content_hash': content_hash,
            }
            
            if chapter:
                metadata['chapter'] = chapter
            if heading_path:
                metadata['heading_path'] = json.dumps(heading_path) if isinstance(heading_path, list) else str(heading_path)
            
            vectors.append({
                'id': chunk_id,
                'values': embedding,
                'metadata': metadata,
            })
        
        logger.info(f"Processed {file_path.name}: {len(vectors)} chunks")
        return vectors
        
    except Exception as e:
        logger.error(f"Error processing {file_path}: {e}")
        return None


def delete_existing_source_vectors(index, namespace: str, source_id: str):
    """Delete all vectors for a given source_id to prevent ghosts."""
    try:
        filter_dict = {"source_id": {"$eq": source_id}}
        index.delete(filter=filter_dict, namespace=namespace)
        logger.info(f"Deleted existing vectors for source_id: {source_id}")
    except Exception as e:
        logger.error(f"Failed to delete existing vectors for {source_id}: {e}")


def calculate_batch_size(vectors: List[dict], max_bytes: int = 1800000) -> int:
    """Calculate how many vectors fit under byte limit."""
    if not vectors:
        return 0
    
    total_size = sum(len(json.dumps(v)) for v in vectors)
    avg_size = total_size / len(vectors)
    return max(1, int(max_bytes / avg_size))


def filter_existing_vectors(index, namespace: str, vectors: List[dict], fetch_batch_size: int = 500) -> List[dict]:
    """Return only vectors whose IDs are not already present in the namespace."""
    if not vectors:
        return vectors

    existing_ids = set()
    ids = [v.get('id') for v in vectors if isinstance(v, dict) and v.get('id')]

    for i in range(0, len(ids), fetch_batch_size):
        batch_ids = ids[i:i + fetch_batch_size]
        try:
            response = index.fetch(ids=batch_ids, namespace=namespace)
            vectors_map = None

            if isinstance(response, dict):
                vectors_map = response.get('vectors') or {}
            elif hasattr(response, 'vectors'):
                vectors_map = response.vectors or {}
            elif hasattr(response, 'to_dict'):
                as_dict = response.to_dict()
                vectors_map = as_dict.get('vectors') or {}

            if isinstance(vectors_map, dict):
                existing_ids.update(vectors_map.keys())
            elif isinstance(vectors_map, list):
                for item in vectors_map:
                    if isinstance(item, dict) and item.get('id'):
                        existing_ids.add(item['id'])
        except Exception as e:
            logger.warning(f"Failed to fetch existing IDs for dedupe: {e}")
            return vectors

    filtered = [v for v in vectors if v.get('id') not in existing_ids]
    skipped = len(vectors) - len(filtered)
    if skipped > 0:
        logger.info(f"Skipped {skipped} existing vectors by ID")
    return filtered


def upsert_batches(
    index,
    namespace: str,
    vectors: List[dict],
    target_batch_size: int = 100
):
    """Upsert vectors in size-aware batches."""
    total_upserted = 0
    i = 0
    
    while i < len(vectors):
        # Calculate how many fit in this batch
        remaining = vectors[i:]
        batch_size = min(target_batch_size, len(remaining))
        
        # Check byte limit
        byte_limit = calculate_batch_size(remaining[:batch_size])
        actual_batch_size = min(batch_size, byte_limit)
        
        batch = remaining[:actual_batch_size]
        
        try:
            index.upsert(vectors=batch, namespace=namespace)
            total_upserted += len(batch)
            logger.info(f"Upserted batch of {len(batch)} vectors")
        except Exception as e:
            logger.error(f"Upsert failed for batch {i}: {e}")
        
        i += actual_batch_size
    
    return total_upserted


def main():
    load_env_file()

    parser = argparse.ArgumentParser(description='Ingest markdown files into Pinecone')
    parser.add_argument('--directory', default=os.getenv('MD_DIRECTORY', './markdown'),
                        help='Root directory containing markdown files')
    parser.add_argument('--namespace', default=os.getenv('PINECONE_NAMESPACE', 'immigration-v2'),
                        help='Pinecone namespace')
    parser.add_argument('--file-glob', default='*.md',
                        help='File pattern to match')
    parser.add_argument('--max-files', type=int, default=None,
                        help='Maximum files to process')
    parser.add_argument('--dry-run', action='store_true',
                        help='Process without uploading')
    parser.add_argument('--chunk-size', type=int, default=1000,
                        help='Chunk size for splitting')
    parser.add_argument('--chunk-overlap', type=int, default=150,
                        help='Chunk overlap for splitting')
    parser.add_argument('--no-delete-existing-source', action='store_true',
                        help='Do not delete existing vectors by source_id before upsert')
    parser.add_argument('--skip-existing-ids', action='store_true',
                        help='Before upsert, fetch and skip vectors whose IDs already exist in namespace')
    
    args = parser.parse_args()
    
    # Initialize Pinecone (skip in dry-run mode)
    index = None
    if not args.dry_run:
        pinecone_key = os.getenv('PINECONE_API_KEY')
        if not pinecone_key:
            logger.error("PINECONE_API_KEY not set")
            sys.exit(1)
        
        index_name = os.getenv('PINECONE_INDEX_NAME')
        index_host = os.getenv('PINECONE_INDEX_HOST')
        
        if not index_name and not index_host:
            logger.error("PINECONE_INDEX_NAME or PINECONE_INDEX_HOST must be set")
            sys.exit(1)
        
        pc = Pinecone(api_key=pinecone_key)
        if index_host:
            host = index_host.strip().rstrip('/')
            # Accept either full URL or raw host.
            if host.startswith('http://') or host.startswith('https://'):
                index = pc.Index(host=host)
            else:
                index = pc.Index(host=f'https://{host}')
        else:
            index = pc.Index(index_name)
    
    # Initialize text splitter
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=args.chunk_size,
        chunk_overlap=args.chunk_overlap,
        separators=["\n\n", "\n", " ", ""]
    )
    
    # Initialize embedding client (skip in dry-run mode)
    client, model = None, None
    if not args.dry_run:
        client, model = get_embedding_client()
        logger.info(f"Using embedding model: {model}")
    
    # Find markdown files
    base_dir = Path(args.directory)
    if not base_dir.exists():
        logger.error(f"Directory not found: {base_dir}")
        sys.exit(1)
    
    md_files = list(base_dir.rglob(args.file_glob))
    if args.max_files:
        md_files = md_files[:args.max_files]
    
    logger.info(f"Found {len(md_files)} markdown files")
    
    # Track stats
    stats = {
        'files_processed': 0,
        'files_failed': 0,
        'chunks_embedded': 0,
        'vectors_upserted': 0,
        'skipped': 0,
    }
    
    # Process files
    for file_path in md_files:
        rel_path = str(file_path.relative_to(base_dir))
        source_id = derive_source_id(rel_path)

        # Process file
        vectors = process_file(
            file_path=file_path,
            base_dir=base_dir,
            splitter=splitter,
            client=client,
            model=model,
            dry_run=args.dry_run
        )
        
        if vectors is None:
            stats['files_failed'] += 1
            continue
        
        if not vectors:
            stats['skipped'] += 1
            continue

        # Delete existing vectors for this source unless explicitly disabled.
        if not args.dry_run and not args.no_delete_existing_source:
            delete_existing_source_vectors(index, args.namespace, source_id)

        # Optionally skip vectors that already exist in namespace.
        if not args.dry_run and args.skip_existing_ids:
            vectors = filter_existing_vectors(index, args.namespace, vectors)
            if not vectors:
                stats['skipped'] += 1
                continue
        
        stats['files_processed'] += 1
        stats['chunks_embedded'] += len(vectors)
        
        # Upsert vectors
        if not args.dry_run and vectors:
            upserted = upsert_batches(index, args.namespace, vectors)
            stats['vectors_upserted'] += upserted
    
    # Print summary
    logger.info("=" * 50)
    logger.info("Ingestion Summary")
    logger.info("=" * 50)
    logger.info(f"Files processed: {stats['files_processed']}")
    logger.info(f"Chunks embedded: {stats['chunks_embedded']}")
    logger.info(f"Vectors upserted: {stats['vectors_upserted']}")
    logger.info(f"Files failed: {stats['files_failed']}")
    logger.info(f"Skipped (empty): {stats['skipped']}")
    
    if args.dry_run:
        logger.info("DRY RUN - No vectors were uploaded")
    else:
        logger.info(f"Namespace: {args.namespace}")


if __name__ == '__main__':
    main()
