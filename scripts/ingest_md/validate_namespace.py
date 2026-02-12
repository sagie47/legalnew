#!/usr/bin/env python3
"""
Validation script for markdown ingestion.
Checks namespace health and spot-checks vector metadata.
"""

import argparse
import json
import logging
import os
import sys

from pinecone import Pinecone

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def validate_namespace(index, namespace: str) -> dict:
    """Validate a Pinecone namespace and return stats."""
    stats = {
        'total_vectors': 0,
        'unique_sources': set(),
        'unique_files': set(),
        'missing_url': 0,
        'missing_title': 0,
        'missing_text': 0,
        'legal_enrichment_present': 0,
        'errors': [],
    }
    
    # Get stats
    try:
        index_stats = index.describe_index_stats()
        if namespace in index_stats.namespaces:
            stats['total_vectors'] = index_stats.namespaces[namespace].vector_count
        else:
            stats['errors'].append(f"Namespace {namespace} not found")
            return stats
    except Exception as e:
        stats['errors'].append(f"Failed to get index stats: {e}")
        return stats
    
    # Sample vectors for spot-checking
    try:
        # Query with a dummy vector to get sample results
        sample_query = [0.0] * 1536
        results = index.query(
            vector=sample_query,
            namespace=namespace,
            top_k=10,
            include_metadata=True
        )
        
        for match in results.matches:
            meta = match.metadata or {}
            
            # Check for metadata fields
            if not meta.get('url') and not meta.get('source_url'):
                stats['missing_url'] += 1
            
            if not meta.get('title'):
                stats['missing_title'] += 1
            
            if not meta.get('text'):
                stats['missing_text'] += 1
            
            # Track sources
            if meta.get('source_id'):
                stats['unique_sources'].add(meta['source_id'])
            
            if meta.get('source_file'):
                stats['unique_files'].add(meta['source_file'])
            
            # Check for legal enrichment
            text = meta.get('text', '')
            if 'Regulation 205' in text or 'Act Section 25' in text:
                stats['legal_enrichment_present'] += 1
    
    except Exception as e:
        stats['errors'].append(f"Failed to query vectors: {e}")
    
    return stats


def spot_check_vectors(index, namespace: str, sample_size: int = 3) -> list:
    """Spot-check specific vectors for required fields."""
    checks = []
    
    try:
        # Get random sample
        sample_query = [0.0] * 1536
        results = index.query(
            vector=sample_query,
            namespace=namespace,
            top_k=sample_size,
            include_metadata=True
        )
        
        for i, match in enumerate(results.matches):
            meta = match.metadata or {}
            check = {
                'id': match.id,
                'has_url': bool(meta.get('url') or meta.get('source_url')),
                'has_title': bool(meta.get('title')),
                'has_text': bool(meta.get('text')),
                'has_source_id': bool(meta.get('source_id')),
                'has_source_file': bool(meta.get('source_file')),
                'has_chunk_index': meta.get('chunk_index') is not None,
                'has_content_hash': bool(meta.get('content_hash')),
            }
            checks.append(check)
    
    except Exception as e:
        logger.error(f"Spot check failed: {e}")
    
    return checks


def check_idempotency(index, namespace: str, source_id: str) -> dict:
    """Check if namespace handles idempotency correctly."""
    result = {
        'vector_count_for_source': 0,
        'consistent': True,
    }
    
    try:
        # Query with filter for specific source_id
        results = index.query(
            vector=[0.0] * 1536,
            namespace=namespace,
            filter={"source_id": {"$eq": source_id}},
            top_k=1000,
            include_metadata=True
        )
        
        result['vector_count_for_source'] = len(results.matches)
        
        # Check for duplicate chunk indices
        indices = set()
        for match in results.matches:
            idx = match.metadata.get('chunk_index')
            if idx in indices:
                result['consistent'] = False
                logger.warning(f"Duplicate chunk_index {idx} for source {source_id}")
            indices.add(idx)
    
    except Exception as e:
        logger.error(f"Idempotency check failed: {e}")
        result['consistent'] = False
    
    return result


def main():
    parser = argparse.ArgumentParser(description='Validate Pinecone namespace')
    parser.add_argument('--namespace', default=os.getenv('PINECONE_NAMESPACE', 'immigration-v2'),
                        help='Namespace to validate')
    parser.add_argument('--source-id', help='Specific source_id to check for idempotency')
    
    args = parser.parse_args()
    
    # Initialize Pinecone
    pinecone_key = os.getenv('PINECONE_API_KEY')
    if not pinecone_key:
        logger.error("PINECONE_API_KEY not set")
        sys.exit(1)
    
    index_name = os.getenv('PINECONE_INDEX_NAME')
    if not index_name:
        logger.error("PINECONE_INDEX_NAME not set")
        sys.exit(1)
    
    pc = Pinecone(api_key=pinecone_key)
    index = pc.Index(index_name)
    
    logger.info(f"Validating namespace: {args.namespace}")
    
    # Run validation
    stats = validate_namespace(index, args.namespace)
    
    logger.info("=" * 50)
    logger.info("Validation Results")
    logger.info("=" * 50)
    logger.info(f"Total vectors: {stats['total_vectors']}")
    logger.info(f"Unique sources: {len(stats['unique_sources'])}")
    logger.info(f"Unique files: {len(stats['unique_files'])}")
    logger.info(f"Vectors missing url: {stats['missing_url']}")
    logger.info(f"Vectors missing title: {stats['missing_title']}")
    logger.info(f"Vectors missing text: {stats['missing_text']}")
    logger.info(f"With legal enrichment: {stats['legal_enrichment_present']}")
    
    if stats['errors']:
        logger.error("Errors encountered:")
        for err in stats['errors']:
            logger.error(f"  - {err}")
    
    # Spot check
    logger.info("=" * 50)
    logger.info("Spot Check (Sample Vectors)")
    logger.info("=" * 50)
    
    spot_checks = spot_check_vectors(index, args.namespace)
    for i, check in enumerate(spot_checks, 1):
        logger.info(f"\nVector {i}: {check['id']}")
        for field, present in check.items():
            if field != 'id':
                status = "✓" if present else "✗"
                logger.info(f"  {status} {field}")
    
    # Idempotency check
    if args.source_id:
        logger.info("=" * 50)
        logger.info(f"Idempotency Check (source_id: {args.source_id})")
        logger.info("=" * 50)
        
        idem = check_idempotency(index, args.namespace, args.source_id)
        logger.info(f"Vectors for source: {idem['vector_count_for_source']}")
        logger.info(f"Consistent (no duplicates): {idem['consistent']}")
    
    # Overall pass/fail
    logger.info("=" * 50)
    if stats['total_vectors'] > 0 and not stats['errors'] and stats['missing_url'] == 0:
        logger.info("✓ VALIDATION PASSED")
    else:
        logger.info("✗ VALIDATION FAILED")
        sys.exit(1)


if __name__ == '__main__':
    main()
