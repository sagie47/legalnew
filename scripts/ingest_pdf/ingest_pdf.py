#!/usr/bin/env python3
import argparse
import json
import logging
import os
import re
from datetime import datetime
from datetime import timezone
from pathlib import Path

from chunk import build_chunks
from config import env_snapshot, load_env_file
from discover import discover_pdf_files
from embed import attach_embeddings, get_embedding_client
from extract import extract_pdf_document
from normalize import normalize_document
from schemas import validate_vectors
from state import load_state, mark_file, save_state
from structure import build_sections
from upsert import delete_existing_source_vectors, filter_existing_vectors, init_index, upsert_batches

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Ingest PDF files into Pinecone')
    parser.add_argument('--directory', default='./pdfs', help='Root directory containing PDF files')
    parser.add_argument('--namespace', default=os.getenv('PINECONE_NAMESPACE', 'ircc-pdf-v1'), help='Pinecone namespace')
    parser.add_argument('--file-glob', default='*.pdf', help='File pattern to match')
    parser.add_argument('--max-files', type=int, default=None, help='Maximum files to process')
    parser.add_argument('--dry-run', action='store_true', help='Process without uploading')
    parser.add_argument('--chunk-size', type=int, default=1000, help='Chunk size for splitting')
    parser.add_argument('--chunk-overlap', type=int, default=150, help='Chunk overlap for splitting')
    parser.add_argument('--no-delete-existing-source', action='store_true', help='Do not delete vectors by source_id')
    parser.add_argument('--skip-existing-ids', action='store_true', help='Skip vectors with existing IDs in namespace')
    parser.add_argument('--enable-ocr', action='store_true', help='Enable OCR fallback mode (placeholder in MVP)')
    parser.add_argument('--state-file', default='tmp/pdf_ingest_state.json', help='State file path')
    parser.add_argument('--write-chunk-artifacts', action='store_true', help='Write per-file chunk JSON artifacts for review')
    parser.add_argument('--artifact-dir', default='tmp/pdf_chunk_preview', help='Output directory for chunk artifacts')
    return parser.parse_args()


def _artifact_filename(rel_path: str) -> str:
    base = rel_path.rsplit('.', 1)[0]
    safe = re.sub(r'[^a-zA-Z0-9._-]+', '_', base)
    return f'{safe}.chunks.json'


def write_chunk_artifact(
    artifact_dir: str,
    chunked: dict,
    sections: list[dict],
    normalized: dict,
) -> str:
    out_dir = Path(artifact_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rel_path = chunked.get('rel_path', 'document.pdf')
    out_path = out_dir / _artifact_filename(rel_path)

    payload = {
        'file': rel_path,
        'source_id': chunked.get('source_id'),
        'manual_code': chunked.get('manual_code'),
        'content_hash': chunked.get('content_hash'),
        'removed_header_patterns': normalized.get('removed_header_patterns', []),
        'removed_footer_patterns': normalized.get('removed_footer_patterns', []),
        'section_count': len(sections),
        'sections': [{
            'heading': s.get('heading'),
            'heading_path': s.get('heading_path', []),
            'page_start': s.get('page_start'),
            'page_end': s.get('page_end'),
            'chars': len(s.get('text', '')),
        } for s in sections],
        'chunk_count': len(chunked.get('vectors', [])),
        'chunks': [{
            'id': v.get('id'),
            'chars': len(v.get('text', '')),
            'page_start': (v.get('metadata') or {}).get('page_start'),
            'page_end': (v.get('metadata') or {}).get('page_end'),
            'heading_path': (v.get('metadata') or {}).get('heading_path', []),
            'text': v.get('text', ''),
            'text_enriched': (v.get('metadata') or {}).get('text_enriched', ''),
        } for v in chunked.get('vectors', [])],
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    return str(out_path)


def main() -> None:
    load_env_file()
    args = parse_args()

    logger.info('Env snapshot: %s', env_snapshot())

    files = discover_pdf_files(args.directory, args.file_glob, args.max_files)
    if not files:
        logger.error('No PDF files found in %s', args.directory)
        raise SystemExit(1)

    state = load_state(args.state_file)
    run_summary = {
        'started_at': datetime.now(timezone.utc).isoformat(),
        'namespace': args.namespace,
        'files_found': len(files),
        'files_processed': 0,
        'files_failed': 0,
        'chunks_built': 0,
        'vectors_upserted': 0,
        'artifacts_written': 0,
    }

    index = None
    if not args.dry_run:
        index = init_index()

    client, model = (None, None)
    if not args.dry_run:
        client, model = get_embedding_client()
        logger.info('Embedding model: %s', model)

    base_dir = Path(args.directory)

    for file_path in files:
        rel_path = str(file_path.relative_to(base_dir))
        try:
            extracted = extract_pdf_document(file_path, enable_ocr=args.enable_ocr)
            normalized = normalize_document(extracted)
            sections = build_sections(normalized)
            chunked = build_chunks(
                normalized,
                sections,
                base_dir=base_dir,
                chunk_size=args.chunk_size,
                chunk_overlap=args.chunk_overlap,
            )
            vectors = chunked['vectors']

            ok, msg = validate_vectors(vectors)
            if not ok:
                raise RuntimeError(msg)

            if args.write_chunk_artifacts:
                artifact_path = write_chunk_artifact(
                    artifact_dir=args.artifact_dir,
                    chunked=chunked,
                    sections=sections,
                    normalized=normalized,
                )
                run_summary['artifacts_written'] += 1
                logger.info('Wrote artifact: %s', artifact_path)

            run_summary['chunks_built'] += len(vectors)
            run_summary['files_processed'] += 1

            if args.dry_run:
                mark_file(state, rel_path, chunked['content_hash'], 'dry_run', len(vectors))
                save_state(args.state_file, state)
                logger.info('Dry run processed %s: %s chunks', rel_path, len(vectors))
                continue

            if not args.no_delete_existing_source:
                try:
                    delete_existing_source_vectors(index, args.namespace, chunked['source_id'])
                except Exception as exc:
                    logger.warning('Delete failed for %s: %s', rel_path, exc)

            vectors_to_embed = vectors
            if args.skip_existing_ids:
                vectors_to_embed = filter_existing_vectors(index, args.namespace, vectors_to_embed)
                if not vectors_to_embed:
                    mark_file(state, rel_path, chunked['content_hash'], 'skipped_existing', 0)
                    save_state(args.state_file, state)
                    logger.info('Skipped existing vectors for %s', rel_path)
                    continue

            payload_vectors = attach_embeddings(vectors_to_embed, client, model, dry_run=False)
            if not payload_vectors:
                raise RuntimeError('embedding failed for one or more chunks')

            upserted = upsert_batches(index, args.namespace, payload_vectors)
            run_summary['vectors_upserted'] += upserted
            mark_file(state, rel_path, chunked['content_hash'], 'upserted', len(payload_vectors))
            save_state(args.state_file, state)
            logger.info('Processed %s: chunks=%s upserted=%s', rel_path, len(vectors), upserted)

        except Exception as exc:
            run_summary['files_failed'] += 1
            mark_file(state, rel_path, 'unknown', 'failed', 0, str(exc))
            save_state(args.state_file, state)
            logger.error('Failed %s: %s', rel_path, exc)

    run_summary['finished_at'] = datetime.now(timezone.utc).isoformat()
    state.setdefault('runs', []).append(run_summary)
    save_state(args.state_file, state)

    logger.info('==================================================')
    logger.info('PDF Ingestion Summary')
    logger.info('==================================================')
    logger.info('Files found: %s', run_summary['files_found'])
    logger.info('Files processed: %s', run_summary['files_processed'])
    logger.info('Files failed: %s', run_summary['files_failed'])
    logger.info('Chunks built: %s', run_summary['chunks_built'])
    logger.info('Vectors upserted: %s', run_summary['vectors_upserted'])
    logger.info('Chunk artifacts written: %s', run_summary['artifacts_written'])
    logger.info('Namespace: %s', args.namespace)


if __name__ == '__main__':
    main()
