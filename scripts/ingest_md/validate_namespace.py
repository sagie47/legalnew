#!/usr/bin/env python3
"""
Validation script for markdown ingestion.
Checks namespace health and spot-checks vector metadata.
Validates canonical legal metadata fields per LEGAL_RAG_JUNIOR_PARALLEL_DELEGATION.md.
"""

import argparse
import json
import logging
import os
import re
import sys
from collections import Counter
from datetime import datetime

from pinecone import Pinecone

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Canonical enum values for legal metadata fields
VALID_AUTHORITY_LEVELS = {
    'statute',
    'regulation',
    'ministerial_instruction',
    'public_policy',
    'policy',
    'manual',
    'voi',
    'provincial_program',
    'reference',
    'jurisprudence',
    'case_law',
}

VALID_DOC_FAMILIES = {
    'IRPA',
    'IRPR',
    'MI',
    'PUBLIC_POLICY',
    'PDI',
    'ENF',
    'VOI',
    'OINP',
    'BC_PNP',
    'AAIP',
    'NOC2021',
    'LICO_MNI',
    'IRB_GUIDE',
    'CASE_LAW',
}

VALID_INSTRUMENTS = {
    'TRV',
    'ETA',
    'STUDY',
    'WORK',
    'PR_ECON',
    'PR_FAMILY',
    'PR_REFUGEE',
    'INADMISSIBILITY',
    'MISREP',
    'ENFORCEMENT',
}

VALID_JURISDICTIONS = {'federal', 'ontario', 'bc', 'alberta'}

DATE_PATTERN = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def get_embedding_dimension() -> int:
    """Get embedding dimension from env or default."""
    dim = os.getenv('EMBEDDING_DIM')
    if dim:
        return int(dim)
    return 1536


def validate_date_format(date_str: str, field_name: str) -> tuple[bool, str]:
    """Validate date is in YYYY-MM-DD format."""
    if not date_str:
        return True, ""
    if not DATE_PATTERN.match(date_str):
        return False, f"Invalid date format for {field_name}: {date_str} (expected YYYY-MM-DD)"
    try:
        datetime.strptime(date_str, '%Y-%m-%d')
        return True, ""
    except ValueError:
        return False, f"Invalid date value for {field_name}: {date_str}"


def _normalize_enum_value(value: str, field_name: str) -> str:
    text = str(value).strip()
    if not text:
        return ''
    if field_name in ('authority_level', 'jurisdiction'):
        return text.lower()
    return text.upper()


def _split_values(value: str | list) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    text = str(value).strip()
    if not text:
        return []
    if ',' not in text:
        return [text]
    return [part.strip() for part in text.split(',') if part.strip()]


def validate_enum(value: str | list, valid_set: set, field_name: str) -> tuple[bool, str]:
    """Validate value is in valid enum set."""
    if not value:
        return True, ""
    parts = _split_values(value)
    for part in parts:
        normalized = _normalize_enum_value(part, field_name)
        if normalized not in valid_set:
            return False, f"Invalid {field_name}: '{part}' (valid: {sorted(valid_set)})"
    return True, ""


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
        # New canonical metadata stats
        'canonical_fields': {
            'authority_level': {'present': 0, 'missing': 0, 'invalid': [], 'distribution': Counter()},
            'doc_family': {'present': 0, 'missing': 0, 'invalid': [], 'distribution': Counter()},
            'instrument': {'present': 0, 'missing': 0, 'invalid': [], 'distribution': Counter()},
            'jurisdiction': {'present': 0, 'missing': 0, 'invalid': [], 'distribution': Counter()},
            'effective_date': {'present': 0, 'missing': 0, 'invalid': [], 'invalid_dates': []},
            'expiry_date': {'present': 0, 'missing': 0, 'invalid': [], 'invalid_dates': []},
            'section_id': {'present': 0, 'missing': 0},
            'program_stream': {'present': 0, 'missing': 0},
            'noc_code': {'present': 0, 'missing': 0},
            'teer': {'present': 0, 'missing': 0},
            'table_type': {'present': 0, 'missing': 0},
        },
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
        sample_dimension = get_embedding_dimension()
        sample_query = [0.0] * sample_dimension
        results = index.query(
            vector=sample_query,
            namespace=namespace,
            top_k=min(100, stats['total_vectors']),
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
            
            # Validate canonical metadata fields
            canonical = stats['canonical_fields']
            
            # authority_level
            val = meta.get('authority_level')
            if val:
                canonical['authority_level']['present'] += 1
                valid, err = validate_enum(val, VALID_AUTHORITY_LEVELS, 'authority_level')
                if not valid:
                    canonical['authority_level']['invalid'].append(match.id)
                    logger.warning(f"{err} (id: {match.id})")
                else:
                    canonical['authority_level']['distribution'][_normalize_enum_value(val, 'authority_level')] += 1
            else:
                canonical['authority_level']['missing'] += 1
            
            # doc_family
            val = meta.get('doc_family')
            if val:
                canonical['doc_family']['present'] += 1
                valid, err = validate_enum(val, VALID_DOC_FAMILIES, 'doc_family')
                if not valid:
                    canonical['doc_family']['invalid'].append(match.id)
                    logger.warning(f"{err} (id: {match.id})")
                else:
                    canonical['doc_family']['distribution'][_normalize_enum_value(val, 'doc_family')] += 1
            else:
                canonical['doc_family']['missing'] += 1
            
            # instrument
            val = meta.get('instrument')
            if val:
                canonical['instrument']['present'] += 1
                valid, err = validate_enum(val, VALID_INSTRUMENTS, 'instrument')
                if not valid:
                    canonical['instrument']['invalid'].append(match.id)
                    logger.warning(f"{err} (id: {match.id})")
                else:
                    for item in _split_values(val):
                        canonical['instrument']['distribution'][_normalize_enum_value(item, 'instrument')] += 1
            else:
                canonical['instrument']['missing'] += 1
            
            # jurisdiction
            val = meta.get('jurisdiction')
            if val:
                canonical['jurisdiction']['present'] += 1
                valid, err = validate_enum(val, VALID_JURISDICTIONS, 'jurisdiction')
                if not valid:
                    canonical['jurisdiction']['invalid'].append(match.id)
                    logger.warning(f"{err} (id: {match.id})")
                else:
                    canonical['jurisdiction']['distribution'][_normalize_enum_value(val, 'jurisdiction')] += 1
            else:
                canonical['jurisdiction']['missing'] += 1
            
            # effective_date
            val = meta.get('effective_date')
            if val:
                canonical['effective_date']['present'] += 1
                valid, err = validate_date_format(val, 'effective_date')
                if not valid:
                    canonical['effective_date']['invalid'].append(match.id)
                    canonical['effective_date']['invalid_dates'].append(val)
                    logger.warning(f"{err} (id: {match.id})")
            else:
                canonical['effective_date']['missing'] += 1
            
            # expiry_date
            val = meta.get('expiry_date')
            if val:
                canonical['expiry_date']['present'] += 1
                valid, err = validate_date_format(val, 'expiry_date')
                if not valid:
                    canonical['expiry_date']['invalid'].append(match.id)
                    canonical['expiry_date']['invalid_dates'].append(val)
                    logger.warning(f"{err} (id: {match.id})")
            else:
                canonical['expiry_date']['missing'] += 1
            
            # section_id
            if meta.get('section_id'):
                canonical['section_id']['present'] += 1
            else:
                canonical['section_id']['missing'] += 1
            
            # program_stream
            if meta.get('program_stream'):
                canonical['program_stream']['present'] += 1
            else:
                canonical['program_stream']['missing'] += 1
            
            # noc_code
            if meta.get('noc_code'):
                canonical['noc_code']['present'] += 1
            else:
                canonical['noc_code']['missing'] += 1
            
            # teer
            if meta.get('teer'):
                canonical['teer']['present'] += 1
            else:
                canonical['teer']['missing'] += 1
            
            # table_type
            if meta.get('table_type'):
                canonical['table_type']['present'] += 1
            else:
                canonical['table_type']['missing'] += 1
    
    except Exception as e:
        stats['errors'].append(f"Failed to query vectors: {e}")
    
    return stats


def spot_check_vectors(index, namespace: str, sample_size: int = 3) -> list:
    """Spot-check specific vectors for required fields."""
    checks = []
    
    try:
        # Get random sample
        sample_dimension = get_embedding_dimension()
        sample_query = [0.0] * sample_dimension
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
                # New canonical fields
                'authority_level': meta.get('authority_level'),
                'doc_family': meta.get('doc_family'),
                'instrument': meta.get('instrument'),
                'jurisdiction': meta.get('jurisdiction'),
                'effective_date': meta.get('effective_date'),
                'expiry_date': meta.get('expiry_date'),
                'section_id': meta.get('section_id'),
                'program_stream': meta.get('program_stream'),
                'noc_code': meta.get('noc_code'),
                'teer': meta.get('teer'),
                'table_type': meta.get('table_type'),
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
            vector=[0.0] * get_embedding_dimension(),
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
    parser.add_argument('--strict', action='store_true',
                        help='Exit with error if any canonical field has invalid enum/date values')
    
    args = parser.parse_args()
    
    # Initialize Pinecone
    pinecone_key = os.getenv('PINECONE_API_KEY')
    if not pinecone_key:
        logger.error("PINECONE_API_KEY not set")
        sys.exit(1)
    
    index_name = os.getenv('PINECONE_INDEX_NAME')
    index_host = os.getenv('PINECONE_INDEX_HOST')
    if not index_name and not index_host:
        logger.error("PINECONE_INDEX_NAME or PINECONE_INDEX_HOST not set")
        sys.exit(1)
    
    pc = Pinecone(api_key=pinecone_key)
    if index_host:
        host = index_host.strip().rstrip('/')
        if not host.startswith('http://') and not host.startswith('https://'):
            host = f'https://{host}'
        index = pc.Index(host=host)
    else:
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
    
    # Canonical metadata fields validation
    logger.info("=" * 50)
    logger.info("Canonical Metadata Fields (Sampled)")
    logger.info("=" * 50)
    
    sample_size = min(100, stats['total_vectors'])
    canonical = stats['canonical_fields']
    any_invalid = False
    
    for field in ['authority_level', 'doc_family', 'instrument', 'jurisdiction',
                  'effective_date', 'expiry_date', 'section_id', 'program_stream',
                  'noc_code', 'teer', 'table_type']:
        field_stats = canonical[field]
        present = field_stats['present']
        missing = field_stats['missing']
        total = present + missing
        
        if total > 0:
            presence_rate = (present / total) * 100
            logger.info(f"\n{field}:")
            logger.info(f"  Present: {present}/{total} ({presence_rate:.1f}%)")
            logger.info(f"  Missing: {missing}/{total} ({100-presence_rate:.1f}%)")
            
            # Distribution for enum fields
            if 'distribution' in field_stats and field_stats['distribution']:
                logger.info(f"  Distribution: {dict(field_stats['distribution'].most_common())}")
            
            # Invalid values
            if field_stats.get('invalid'):
                any_invalid = True
                invalid_ids = field_stats['invalid'][:5]
                logger.warning(f"  INVALID: {len(field_stats['invalid'])} vectors ({invalid_ids}...)")
            
            # Invalid dates
            if field_stats.get('invalid_dates'):
                any_invalid = True
                unique_invalid = list(set(field_stats['invalid_dates']))[:5]
                logger.warning(f"  INVALID DATES: {unique_invalid}...")
        else:
            logger.info(f"\n{field}: No data (namespace may be empty)")
    
    # Spot check
    logger.info("=" * 50)
    logger.info("Spot Check (Sample Vectors)")
    logger.info("=" * 50)
    
    spot_checks = spot_check_vectors(index, args.namespace)
    for i, check in enumerate(spot_checks, 1):
        logger.info(f"\nVector {i}: {check['id']}")
        for field, present in check.items():
            if field != 'id':
                if field in ['authority_level', 'doc_family', 'instrument', 'jurisdiction',
                            'effective_date', 'expiry_date', 'section_id', 'program_stream',
                            'noc_code', 'teer', 'table_type']:
                    status = "✓" if present else "○"
                    logger.info(f"  {status} {field}: {present or '(not set)'}")
                else:
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
        if args.strict and any_invalid:
            logger.info("✗ VALIDATION FAILED (strict mode: invalid enum/date values found)")
            sys.exit(1)
        else:
            logger.info("✓ VALIDATION PASSED")
    else:
        logger.info("✗ VALIDATION FAILED")
        sys.exit(1)


if __name__ == '__main__':
    main()
