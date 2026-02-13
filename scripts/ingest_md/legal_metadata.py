#!/usr/bin/env python3
from __future__ import annotations

import re
from datetime import datetime
from typing import Any


def _to_text(value: Any) -> str:
    if not isinstance(value, str):
        return ''
    return value.strip()


def _normalize_date(value: Any) -> str | None:
    text = _to_text(value)
    if not text:
        return None

    iso_match = re.search(r'(\d{4}-\d{2}-\d{2})', text)
    if iso_match:
        return iso_match.group(1)

    for fmt in ('%a, %d %b %Y %H:%M:%S %Z', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d'):
        try:
            return datetime.strptime(text, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue

    # Try loose ISO parse with timezone suffix.
    if text.endswith('Z'):
        try:
            return datetime.fromisoformat(text.replace('Z', '+00:00')).strftime('%Y-%m-%d')
        except ValueError:
            return None
    try:
        return datetime.fromisoformat(text).strftime('%Y-%m-%d')
    except ValueError:
        return None


def _detect_doc_family(combined: str, url: str, manual: str) -> str:
    c = combined.lower()
    u = url.lower()
    m = manual.lower()

    if 'ontario immigrant nominee' in c or 'oinp' in c or '/ontario/' in u:
        return 'OINP'
    if 'bc pnp' in c or 'bcpnp' in c or 'british columbia pnp' in c:
        return 'BC_PNP'
    if 'alberta advantage immigration' in c or 'aaip' in c:
        return 'AAIP'
    if 'noc 2021' in c or re.search(r'\bnoc\b', c):
        return 'NOC2021'
    if 'lico' in c or 'minimum necessary income' in c or re.search(r'\bmni\b', c):
        return 'LICO_MNI'
    if 'ministerial instruction' in c or re.search(r'\bmi\b', c):
        return 'MI'
    if 'public policy' in c:
        return 'PUBLIC_POLICY'
    if 'visa office' in c or '/visa-office-' in u or '/visa-office/' in u:
        return 'VOI'
    if m.startswith('enf') or '/enforcement/' in u or 'enforcement manual' in c:
        return 'ENF'
    if 'jurisprudential guide' in c or 'irb guide' in c:
        return 'IRB_GUIDE'
    if re.search(r'\birpa\b', c):
        return 'IRPA'
    if re.search(r'\birpr\b', c) or 'sor-2002-227' in c:
        return 'IRPR'
    return 'PDI'


def _authority_from_doc_family(doc_family: str) -> str:
    mapping = {
        'IRPA': 'statute',
        'IRPR': 'regulation',
        'MI': 'ministerial_instruction',
        'PUBLIC_POLICY': 'public_policy',
        'PDI': 'policy',
        'ENF': 'manual',
        'VOI': 'voi',
        'OINP': 'provincial_program',
        'BC_PNP': 'provincial_program',
        'AAIP': 'provincial_program',
        'NOC2021': 'reference',
        'LICO_MNI': 'reference',
        'IRB_GUIDE': 'jurisprudence',
        'CASE_LAW': 'case_law',
    }
    return mapping.get(doc_family, 'policy')


def _detect_jurisdiction(doc_family: str) -> str:
    if doc_family == 'OINP':
        return 'ontario'
    if doc_family == 'BC_PNP':
        return 'bc'
    if doc_family == 'AAIP':
        return 'alberta'
    return 'federal'


def _detect_instrument(combined: str, url: str, doc_family: str) -> str:
    c = combined.lower()
    u = url.lower()

    rules = [
        ('TRV', r'\btrv\b|temporary resident visa|visitor|super visa'),
        ('ETA', r'\beta\b|electronic travel authorization'),
        ('STUDY', r'study permit|student'),
        ('WORK', r'work permit|foreign workers|lmia|r205|r186'),
        ('PR_ECON', r'express entry|economic class|federal skilled|cec|fst|permanent residence.*economic'),
        ('PR_FAMILY', r'family sponsorship|spousal|parent sponsorship'),
        ('PR_REFUGEE', r'refugee|asylum|protected person'),
        ('INADMISSIBILITY', r'inadmissib|criminality|medical inadmissib|security inadmissib'),
        ('MISREP', r'misrep|misrepresentation|\ba40\b'),
        ('ENFORCEMENT', r'enforcement|removal order|detention|admissibility hearing'),
    ]
    for tag, pattern in rules:
        if re.search(pattern, c):
            return tag

    if '/temporary-residents/' in u:
        return 'TRV'
    if '/permanent-residence/' in u:
        return 'PR_ECON'
    if '/enforcement/' in u:
        return 'ENFORCEMENT'
    if '/refugees/' in u:
        return 'PR_REFUGEE'

    defaults = {
        'ENF': 'ENFORCEMENT',
        'OINP': 'PR_ECON',
        'BC_PNP': 'PR_ECON',
        'AAIP': 'PR_ECON',
        'NOC2021': 'WORK',
        'LICO_MNI': 'PR_FAMILY',
    }
    return defaults.get(doc_family, 'WORK')


def _extract_section_id(text: str) -> str | None:
    def format_suffix(parts: list[str]) -> str:
        if not parts:
            return ''
        first = parts[0]
        remainder = ''.join(parts[1:])
        if first.isdigit():
            return f'_{first}{remainder}'
        return f'{first}{remainder}'

    token = re.search(r'\b([RA])(\d{1,3})((?:\([a-z0-9]+\))*)', text, flags=re.IGNORECASE)
    if not token:
        return None

    marker = token.group(1).upper()
    base = token.group(2)
    parts = [item.lower() for item in re.findall(r'\(([a-z0-9]+)\)', token.group(3) or '', flags=re.IGNORECASE)]
    suffix = format_suffix(parts)

    if marker == 'R':
        return f'IRPR_{base}{suffix}'
    if marker == 'A':
        return f'IRPA_A{base}{suffix}'
    return None


def _detect_program_stream(combined: str) -> str | None:
    c = combined.lower()
    rules = [
        ('EXPRESS_ENTRY', r'express entry'),
        ('PNP', r'provincial nominee|oinp|bc pnp|aaip'),
        ('AIP', r'atlantic immigration'),
        ('CAREGIVER', r'caregiver'),
        ('AGRI_FOOD', r'agri[- ]food'),
        ('RURAL', r'rural and northern|rural northern'),
        ('OWP', r'open work permit|\bowp\b'),
        ('PGWP', r'post[- ]graduation|\bpgwp\b'),
        ('SPOUSAL', r'spousal sponsorship'),
    ]
    for value, pattern in rules:
        if re.search(pattern, c):
            return value
    return None


def _extract_noc_code(text: str) -> str | None:
    match = re.search(r'\bNOC\s*([0-9]{4,5})\b', text, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1)


def _extract_teer(text: str) -> str | None:
    match = re.search(r'\bTEER\s*([0-5])\b', text, flags=re.IGNORECASE)
    if not match:
        return None
    return match.group(1)


def _detect_table_type(combined: str) -> str | None:
    c = combined.lower()
    if 'minimum necessary income' in c or re.search(r'\bmni\b', c):
        return 'MNI'
    if 'lico' in c or 'low income cut-off' in c:
        return 'LICO'
    return None


def build_canonical_metadata(
    *,
    url: str,
    title: str,
    manual: str,
    chapter: str,
    last_updated: Any,
    ingest_date: Any,
    chunk_text: str,
    heading_path: list[str] | None,
) -> dict[str, Any]:
    heading = '/'.join(heading_path or [])
    combined = ' | '.join([title, manual, chapter, heading, chunk_text[:200]])

    doc_family = _detect_doc_family(combined, url, manual)
    authority_level = _authority_from_doc_family(doc_family)
    jurisdiction = _detect_jurisdiction(doc_family)
    instrument = _detect_instrument(combined, url, doc_family)

    effective_date = _normalize_date(last_updated) or _normalize_date(ingest_date)
    section_id = _extract_section_id(chunk_text)
    program_stream = _detect_program_stream(combined)
    noc_code = _extract_noc_code(chunk_text)
    teer = _extract_teer(chunk_text)
    table_type = _detect_table_type(combined)

    out: dict[str, Any] = {
        'authority_level': authority_level,
        'doc_family': doc_family,
        'instrument': instrument,
        'jurisdiction': jurisdiction,
    }
    if effective_date:
        out['effective_date'] = effective_date
    if section_id:
        out['section_id'] = section_id
    if program_stream:
        out['program_stream'] = program_stream
    if noc_code:
        out['noc_code'] = noc_code
    if teer:
        out['teer'] = teer
    if table_type:
        out['table_type'] = table_type

    return out
