#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit


TRACKING_QUERY_KEYS = {
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "gclid",
    "fbclid",
    "msclkid",
    "mc_cid",
    "mc_eid",
    "_hsenc",
    "_hsmi",
    "ref",
    "source",
    "campaign",
}


def canonicalize_url(raw_url: str, base_url: str | None = None) -> str | None:
    if not raw_url:
        return None
    value = str(raw_url).strip()
    if not value:
        return None

    joined = urljoin(base_url, value) if base_url else value
    try:
        split = urlsplit(joined)
    except Exception:
        return None

    if split.scheme not in ("http", "https"):
        return None
    if not split.hostname:
        return None

    hostname = split.hostname.lower()
    port = split.port
    if port and not ((split.scheme == "http" and port == 80) or (split.scheme == "https" and port == 443)):
        netloc = f"{hostname}:{port}"
    else:
        netloc = hostname

    path = re.sub(r"/{2,}", "/", split.path or "/")
    if not path.startswith("/"):
        path = "/" + path
    if path != "/":
        path = path.rstrip("/")

    query_items = []
    for key, val in parse_qsl(split.query, keep_blank_values=True):
        lower_key = key.lower()
        if lower_key.startswith("utm_") or lower_key in TRACKING_QUERY_KEYS:
            continue
        query_items.append((key, val))
    query_items.sort(key=lambda item: (item[0], item[1]))
    query = urlencode(query_items, doseq=True)

    return urlunsplit((split.scheme.lower(), netloc, path, query, ""))


def build_source_id(canonical_url: str) -> str:
    digest = hashlib.sha1(canonical_url.encode("utf-8")).hexdigest()[:12]
    return f"pdi_{digest}"

