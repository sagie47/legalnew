#!/usr/bin/env python3
"""
Recursive crawler for Canada.ca IRCC manual pages using Jina Reader for clean markdown extraction.

Features:
- strict host/path filtering
- canonical URL dedupe (fragments, tracking params, query ordering)
- recursive BFS crawl with max depth/page guards
- resilient HTTP retries with exponential backoff + jitter
- checkpoint state for resume
- manifest + failed URL logs
- markdown files with YAML frontmatter metadata
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as curl_requests

    HAS_CURL_CFFI = True
except Exception:
    curl_requests = None
    HAS_CURL_CFFI = False

# --- Defaults ---
TOC_URL = (
    "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/"
    "publications-manuals/operational-bulletins-manuals/temporary-residents/"
    "functional-guidance-table-contents.html"
)
ALLOW_PATH_PREFIX = (
    "/en/immigration-refugees-citizenship/corporate/publications-manuals/"
    "operational-bulletins-manuals/"
)
DEFAULT_OUTPUT_DIR = "ircc_data_clean"
DEFAULT_INPUT_LINKS_MD = "input_links.md"

STATE_FILE = "_crawl_state.json"
MANIFEST_FILE = "manifest.json"
FAILED_FILE = "failed_urls.json"

JINA_API_KEY = os.getenv("JINA_API_KEY", "").strip()

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

BLOCKED_CONTENT_PATTERNS = [
    r"enable javascript",
    r"access denied",
    r"request blocked",
    r"captcha",
    r"cloudflare",
]

DEFAULT_EXCLUDE_SELECTORS = ".pagedetails, .gc-sub-footer, .gc-npr-row, nav, footer, header"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def save_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def parse_retry_after_seconds(value: Optional[str]) -> Optional[float]:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        seconds = float(value)
        return max(0.0, seconds)
    except ValueError:
        pass

    try:
        from email.utils import parsedate_to_datetime

        dt = parsedate_to_datetime(value)
        delta = (dt - datetime.now(dt.tzinfo)).total_seconds()
        return max(0.0, delta)
    except Exception:
        return None


def canonicalize_url(raw_url: str, base_url: Optional[str] = None) -> Optional[str]:
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

    query_items: List[Tuple[str, str]] = []
    for key, value in parse_qsl(split.query, keep_blank_values=True):
        lower_key = key.lower()
        if lower_key.startswith("utm_") or lower_key in TRACKING_QUERY_KEYS:
            continue
        query_items.append((key, value))
    query_items.sort(key=lambda item: (item[0], item[1]))
    query = urlencode(query_items, doseq=True)

    return urlunsplit((split.scheme.lower(), netloc, path, query, ""))


def is_valid_ingestion_target(url: str) -> bool:
    """
    User-defined ingestion policy:
    1) Keep all core manual pages under operational-bulletins-manuals
    2) Keep visa country list exception (visit/visas.asp)
    3) Drop generic /services/ pages except transit/without-visa
    """
    canonical = canonicalize_url(url) or ""
    if not canonical:
        return False

    split = urlsplit(canonical)
    host = (split.hostname or "").lower()
    path = (split.path or "").lower()
    whole = canonical.lower()

    # Restrict to expected canada.ca hosts
    if host not in {"www.canada.ca", "canada.ca", "ircc.canada.ca"}:
        return False

    if "/corporate/publications-manuals/operational-bulletins-manuals/" in whole:
        return True

    if "visit/visas.asp" in whole:
        return True

    if "/services/" in whole:
        if "transit/without-visa" in whole:
            return True
        return False

    # Everything else is excluded by default.
    return False


def url_is_allowed(url: str, allow_domains: Set[str], allow_path_prefixes: Sequence[str]) -> bool:
    try:
        split = urlsplit(url)
    except Exception:
        return False

    host = (split.hostname or "").lower()
    if allow_domains and host not in allow_domains:
        return False

    if split.path.lower().endswith(".pdf"):
        return False

    # Primary policy gate.
    if is_valid_ingestion_target(url):
        return True

    # Optional additional allow prefixes (for custom runs).
    if allow_path_prefixes and any(split.path.startswith(prefix) for prefix in allow_path_prefixes):
        return True

    return False


def parse_urls_from_markdown(text: str) -> List[str]:
    if not text:
        return []

    urls: List[str] = []
    seen: Set[str] = set()

    md_link_pattern = re.compile(r"\[[^\]]+\]\((https?://[^)\s]+)\)", re.IGNORECASE)
    bare_url_pattern = re.compile(r"https?://[^\s<>)\]\"']+", re.IGNORECASE)

    for match in md_link_pattern.findall(text):
        canonical = canonicalize_url(match)
        if not canonical or canonical in seen:
            continue
        seen.add(canonical)
        urls.append(canonical)

    for match in bare_url_pattern.findall(text):
        canonical = canonicalize_url(match)
        if not canonical or canonical in seen:
            continue
        seen.add(canonical)
        urls.append(canonical)

    return urls


def load_seed_urls_from_markdown(path: Path) -> List[str]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    return parse_urls_from_markdown(text)


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/127.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
        }
    )
    return session


def request_with_backoff(
    session: requests.Session,
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 30.0,
    retries: int = 3,
    backoff_base: float = 1.5,
    retry_statuses: Iterable[int] = (429, 500, 502, 503, 504),
) -> Any:
    last_exc: Optional[Exception] = None
    retry_statuses = set(retry_statuses)

    for attempt in range(retries + 1):
        try:
            if HAS_CURL_CFFI and curl_requests is not None:
                try:
                    response = curl_requests.request(
                        method=method.upper(),
                        url=url,
                        headers=headers,
                        timeout=timeout,
                        allow_redirects=True,
                        impersonate="chrome",
                    )
                except Exception:
                    response = session.request(
                        method=method.upper(),
                        url=url,
                        headers=headers,
                        timeout=timeout,
                        allow_redirects=True,
                    )
            else:
                response = session.request(
                    method=method.upper(),
                    url=url,
                    headers=headers,
                    timeout=timeout,
                    allow_redirects=True,
                )
        except Exception as exc:
            last_exc = exc
            if attempt >= retries:
                raise RuntimeError(f"Network request failed after {retries + 1} attempts: {exc}") from exc
            wait_s = min(30.0, (backoff_base ** (attempt + 1)) + random.uniform(0.0, 0.4))
            time.sleep(wait_s)
            continue

        if response.status_code in retry_statuses and attempt < retries:
            retry_after = parse_retry_after_seconds(response.headers.get("Retry-After"))
            if retry_after is None:
                retry_after = min(30.0, (backoff_base ** (attempt + 1)) + random.uniform(0.0, 0.4))
            time.sleep(retry_after)
            continue

        return response

    if last_exc:
        raise RuntimeError(str(last_exc)) from last_exc
    raise RuntimeError("Request failed for unknown reason")


def fetch_page_html(
    session: requests.Session,
    url: str,
    *,
    timeout: float,
    retries: int,
    backoff_base: float,
) -> Tuple[str, str]:
    response = request_with_backoff(
        session,
        "GET",
        url,
        timeout=timeout,
        retries=retries,
        backoff_base=backoff_base,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    if response.status_code != 200:
        raise RuntimeError(f"HTML fetch failed ({response.status_code})")

    content_type = response.headers.get("Content-Type", "")
    if "text/html" not in content_type and "application/xhtml+xml" not in content_type:
        raise RuntimeError(f"Unsupported content type: {content_type}")

    return response.text, response.url


def scrape_with_jina(
    session: requests.Session,
    url: str,
    *,
    target_selector: str = "main",
    exclude_selectors: Optional[Sequence[str]] = None,
    wait_for_selector: Optional[str] = None,
    with_generated_alt: bool = True,
    timeout: float = 30.0,
    retries: int = 3,
    backoff_base: float = 1.5,
) -> str:
    jina_url = f"https://r.jina.ai/{url}"
    headers: Dict[str, str] = {
        "X-Return-Format": "markdown",
        "Accept": "text/plain",
    }
    if target_selector:
        headers["X-Target-Selector"] = target_selector
    if exclude_selectors:
        headers["X-Exclude-Selector"] = ", ".join(exclude_selectors)
    if wait_for_selector:
        headers["X-Wait-For-Selector"] = wait_for_selector
    if with_generated_alt and JINA_API_KEY:
        headers["X-With-Generated-Alt"] = "true"
    if JINA_API_KEY:
        headers["Authorization"] = f"Bearer {JINA_API_KEY}"

    response = request_with_backoff(
        session,
        "GET",
        jina_url,
        headers=headers,
        timeout=timeout,
        retries=retries,
        backoff_base=backoff_base,
        retry_statuses=(429, 500, 502, 503, 504),
    )
    if response.status_code == 401 and "Authorization" in headers:
        retry_headers = dict(headers)
        retry_headers.pop("Authorization", None)
        response = request_with_backoff(
            session,
            "GET",
            jina_url,
            headers=retry_headers,
            timeout=timeout,
            retries=retries,
            backoff_base=backoff_base,
            retry_statuses=(429, 500, 502, 503, 504),
        )
    if response.status_code != 200:
        raise RuntimeError(f"Jina scrape failed ({response.status_code})")
    return response.text


def extract_title_from_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    h1 = soup.find("h1")
    if h1:
        title = normalize_whitespace(h1.get_text(" ", strip=True))
        if title:
            return title
    title_tag = soup.find("title")
    if title_tag:
        title = normalize_whitespace(title_tag.get_text(" ", strip=True))
        if title:
            return title
    return "Untitled"


def extract_links_from_html(html: str, base_url: str) -> List[str]:
    soup = BeautifulSoup(html, "html.parser")
    container = soup.find(id="wb-cont") or soup.find("main") or soup

    links: List[str] = []
    seen: Set[str] = set()
    for anchor in container.find_all("a", href=True):
        canonical = canonicalize_url(anchor.get("href", ""), base_url=base_url)
        if not canonical:
            continue
        if canonical in seen:
            continue
        seen.add(canonical)
        links.append(canonical)
    return links


def extract_markdown_from_html(html: str) -> str:
    """
    Fallback extractor used when Jina is unavailable.
    Produces markdown-like text from the page content container.
    """
    soup = BeautifulSoup(html, "html.parser")
    container = soup.find(id="wb-cont") or soup.find("main") or soup.body or soup

    for junk in container.select("script, style, noscript, nav, header, footer"):
        junk.decompose()

    lines: List[str] = []
    seen: Set[str] = set()

    for node in container.find_all(["h1", "h2", "h3", "h4", "p", "li", "blockquote", "tr"]):
        tag = (node.name or "").lower()
        if tag == "tr":
            cells = [normalize_whitespace(cell.get_text(" ", strip=True)) for cell in node.find_all(["th", "td"])]
            cells = [cell for cell in cells if cell]
            if not cells:
                continue
            text = " | ".join(cells)
        else:
            text = normalize_whitespace(node.get_text(" ", strip=True))
            if not text:
                continue

        if tag.startswith("h") and len(tag) == 2 and tag[1].isdigit():
            level = max(1, min(4, int(tag[1])))
            line = f"{'#' * level} {text}"
        elif tag == "li":
            line = f"- {text}"
        elif tag == "tr":
            line = f"Table row: {text}"
        else:
            line = text

        if line in seen:
            continue
        seen.add(line)
        lines.append(line)

    if not lines:
        return normalize_whitespace(container.get_text(" ", strip=True))
    return "\n\n".join(lines)


def derive_title_from_url(url: str) -> str:
    slug = make_slug(url)
    return slug.replace("-", " ").strip().title() or "Untitled"


def looks_like_block_page(markdown: str, min_chars: int = 200) -> Optional[str]:
    content = normalize_whitespace(markdown).lower()
    if len(content) < min_chars:
        return f"content too short ({len(content)} chars)"
    for pattern in BLOCKED_CONTENT_PATTERNS:
        if re.search(pattern, content):
            return f"blocked pattern detected: {pattern}"
    return None


def make_slug(url: str) -> str:
    path = urlsplit(url).path
    slug = path.rstrip("/").split("/")[-1]
    slug = re.sub(r"\.html?$", "", slug, flags=re.IGNORECASE)
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "-", slug).strip("-_").lower()
    return slug or "page"


def escape_yaml_string(value: str) -> str:
    return str(value).replace('"', '\\"')


def extract_filename_from_url(url: str) -> str:
    canonical = canonicalize_url(url) or url
    slug = make_slug(canonical)
    digest = hashlib.sha1(canonical.encode("utf-8")).hexdigest()[:10]
    return f"{slug}-{digest}.md"


def build_frontmatter(
    *,
    url: str,
    title: str,
    fetched_url: str,
    parent_url: Optional[str],
    depth: int,
    content_hash: str,
) -> str:
    ingest_date = datetime.now().strftime("%Y-%m-%d")
    safe_title = escape_yaml_string(title)
    parent = parent_url or ""
    return (
        "---\n"
        f"url: {url}\n"
        f"fetched_url: {fetched_url}\n"
        f"title: \"{safe_title}\"\n"
        f"parent_url: {parent}\n"
        f"depth: {depth}\n"
        f"ingest_date: {ingest_date}\n"
        f"content_hash: \"{content_hash}\"\n"
        "type: manual_section\n"
        "---\n\n"
    )


def append_manifest_record(manifest: Dict[str, Any], record: Dict[str, Any]) -> None:
    manifest.setdefault("pages", []).append(record)
    manifest["updated_at"] = utc_now_iso()


def crawl_recursive(
    *,
    seed_urls: Sequence[str],
    output_dir: Path,
    allow_domains: Set[str],
    allow_path_prefixes: Sequence[str],
    max_depth: int,
    max_pages: int,
    delay_seconds: float,
    timeout: float,
    retries: int,
    backoff_base: float,
    target_selector: str,
    exclude_selectors: Sequence[str],
    wait_for_selector: Optional[str],
    with_generated_alt: bool,
    resume: bool,
    reject_low_quality: bool,
    dedupe_content_hash: bool,
    save_every: int = 10,
) -> Dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    state_path = output_dir / STATE_FILE
    manifest_path = output_dir / MANIFEST_FILE
    failed_path = output_dir / FAILED_FILE

    if resume and state_path.exists():
        state = load_json(state_path, {})
    else:
        state = {
            "version": 1,
            "created_at": utc_now_iso(),
            "visited": [],
            "queue": [],
            "failed": [],
        }

    manifest = load_json(
        manifest_path,
        {
            "created_at": utc_now_iso(),
            "updated_at": utc_now_iso(),
            "seed_urls": list(seed_urls),
            "allow_domains": sorted(list(allow_domains)),
            "allow_path_prefixes": list(allow_path_prefixes),
            "pages": [],
        },
    )

    visited: Set[str] = set(state.get("visited", []))
    queue_data: List[Dict[str, Any]] = state.get("queue", [])
    queue: Deque[Dict[str, Any]] = deque(queue_data)
    queued_set: Set[str] = {item.get("url", "") for item in queue_data if item.get("url")}
    failed: List[Dict[str, Any]] = list(state.get("failed", []))

    known_urls: Set[str] = set()
    known_hashes: Dict[str, str] = {}
    for page in manifest.get("pages", []):
        url = page.get("url")
        if isinstance(url, str) and url:
            known_urls.add(url)
        content_hash = page.get("content_hash")
        filename = page.get("file")
        if isinstance(content_hash, str) and content_hash and isinstance(filename, str) and filename:
            known_hashes[content_hash] = filename

    for seed in seed_urls:
        canonical = canonicalize_url(seed)
        if not canonical:
            continue
        if not url_is_allowed(canonical, allow_domains, allow_path_prefixes):
            continue
        if canonical in visited or canonical in queued_set:
            continue
        queue.append({"url": canonical, "depth": 0, "parent_url": None})
        queued_set.add(canonical)

    session = make_session()
    pages_attempted = 0
    pages_saved = 0
    pages_skipped = 0

    while queue and pages_attempted < max_pages:
        item = queue.popleft()
        url = item.get("url")
        depth = int(item.get("depth", 0))
        parent_url = item.get("parent_url")
        queued_set.discard(url)

        if not url:
            continue
        if url in visited:
            continue
        if not url_is_allowed(url, allow_domains, allow_path_prefixes):
            pages_skipped += 1
            continue
        if depth > max_depth:
            pages_skipped += 1
            continue

        pages_attempted += 1
        visited.add(url)
        print(f"[{pages_attempted}/{max_pages}] Fetching (depth={depth}): {url}")

        html: Optional[str] = None
        fetched_url = url
        fetch_warning: Optional[str] = None
        try:
            html, fetched_url = fetch_page_html(
                session,
                url,
                timeout=timeout,
                retries=retries,
                backoff_base=backoff_base,
            )
        except Exception as exc:
            fetch_warning = str(exc)
            print(f"  ! HTML fetch fallback via Jina: {fetch_warning}")

        final_url = canonicalize_url(fetched_url) or url
        if not url_is_allowed(final_url, allow_domains, allow_path_prefixes):
            pages_skipped += 1
            append_manifest_record(
                manifest,
                {
                    "url": final_url,
                    "fetched_url": fetched_url,
                    "title": None,
                    "depth": depth,
                    "parent_url": parent_url,
                    "status": "out_of_scope",
                    "file": None,
                    "content_hash": None,
                    "timestamp": utc_now_iso(),
                },
            )
            continue
        if final_url != url and final_url in visited:
            pages_skipped += 1
            continue
        if final_url != url:
            visited.add(final_url)
            url = final_url

        if depth < max_depth and html is not None:
            links = extract_links_from_html(html, fetched_url)
            for link in links:
                if not url_is_allowed(link, allow_domains, allow_path_prefixes):
                    continue
                if link in visited or link in queued_set:
                    continue
                queue.append({"url": link, "depth": depth + 1, "parent_url": url})
                queued_set.add(link)

        title = extract_title_from_html(html) if html is not None else derive_title_from_url(url)
        scrape_warning: Optional[str] = None
        try:
            markdown = scrape_with_jina(
                session,
                url,
                target_selector=target_selector,
                exclude_selectors=exclude_selectors,
                wait_for_selector=wait_for_selector,
                with_generated_alt=with_generated_alt,
                timeout=timeout,
                retries=retries,
                backoff_base=backoff_base,
            )
        except Exception as exc:
            if html is not None:
                scrape_warning = f"jina_failed: {exc}"
                print(f"  ! Jina fallback via HTML parser: {exc}")
                markdown = extract_markdown_from_html(html)
            else:
                combined_error = f"{exc}; html_fetch={fetch_warning}" if fetch_warning else str(exc)
                error_entry = {
                    "url": url,
                    "depth": depth,
                    "parent_url": parent_url,
                    "stage": "scrape_jina",
                    "error": combined_error,
                    "timestamp": utc_now_iso(),
                }
                failed.append(error_entry)
                append_manifest_record(
                    manifest,
                    {
                        "url": url,
                        "fetched_url": fetched_url,
                        "title": title,
                        "depth": depth,
                        "parent_url": parent_url,
                        "status": "scrape_failed",
                        "file": None,
                        "content_hash": None,
                        "error": combined_error,
                        "timestamp": utc_now_iso(),
                    },
                )
                continue

        # If direct HTML fetch failed, recurse by extracting URLs from markdown output.
        if depth < max_depth and html is None:
            links = parse_urls_from_markdown(markdown)
            for link in links:
                if not url_is_allowed(link, allow_domains, allow_path_prefixes):
                    continue
                if link in visited or link in queued_set:
                    continue
                queue.append({"url": link, "depth": depth + 1, "parent_url": url})
                queued_set.add(link)

        quality_issue = looks_like_block_page(markdown)
        if reject_low_quality and quality_issue:
            pages_skipped += 1
            failed.append(
                {
                    "url": url,
                    "depth": depth,
                    "parent_url": parent_url,
                    "stage": "quality_check",
                    "error": quality_issue,
                    "timestamp": utc_now_iso(),
                }
            )
            append_manifest_record(
                manifest,
                {
                    "url": url,
                    "fetched_url": fetched_url,
                    "title": title,
                    "depth": depth,
                    "parent_url": parent_url,
                    "status": "quality_rejected",
                    "file": None,
                    "content_hash": None,
                    "error": quality_issue,
                    "timestamp": utc_now_iso(),
                },
            )
            continue

        content_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
        if dedupe_content_hash and content_hash in known_hashes:
            pages_skipped += 1
            existing_file = known_hashes[content_hash]
            append_manifest_record(
                manifest,
                {
                    "url": url,
                    "fetched_url": fetched_url,
                    "title": title,
                    "depth": depth,
                    "parent_url": parent_url,
                    "status": "duplicate_content",
                    "file": existing_file,
                    "content_hash": content_hash,
                    "timestamp": utc_now_iso(),
                },
            )
        else:
            filename = extract_filename_from_url(url)
            file_path = output_dir / filename
            frontmatter = build_frontmatter(
                url=url,
                fetched_url=fetched_url,
                title=title,
                parent_url=parent_url,
                depth=depth,
                content_hash=content_hash,
            )

            if not file_path.exists():
                file_path.write_text(frontmatter + markdown, encoding="utf-8")
            known_hashes[content_hash] = filename
            known_urls.add(url)
            pages_saved += 1

            append_manifest_record(
                manifest,
                {
                    "url": url,
                    "fetched_url": fetched_url,
                    "title": title,
                    "depth": depth,
                    "parent_url": parent_url,
                    "status": "saved",
                    "file": filename,
                    "content_hash": content_hash,
                    "fetch_warning": fetch_warning,
                    "scrape_warning": scrape_warning,
                    "timestamp": utc_now_iso(),
                },
            )

        if delay_seconds > 0:
            time.sleep(delay_seconds)

        if pages_attempted % max(1, save_every) == 0:
            state_payload = {
                "version": 1,
                "created_at": state.get("created_at", utc_now_iso()),
                "updated_at": utc_now_iso(),
                "visited": sorted(list(visited)),
                "queue": list(queue),
                "failed": failed,
            }
            save_json(state_path, state_payload)
            save_json(manifest_path, manifest)
            save_json(failed_path, failed)

    state_payload = {
        "version": 1,
        "created_at": state.get("created_at", utc_now_iso()),
        "updated_at": utc_now_iso(),
        "visited": sorted(list(visited)),
        "queue": list(queue),
        "failed": failed,
    }
    save_json(state_path, state_payload)
    save_json(manifest_path, manifest)
    save_json(failed_path, failed)

    return {
        "status": "ok",
        "seed_count": len(seed_urls),
        "seed_sample": list(seed_urls)[:10],
        "output_dir": str(output_dir),
        "pages_attempted": pages_attempted,
        "pages_saved": pages_saved,
        "pages_skipped": pages_skipped,
        "queue_remaining": len(queue),
        "failed_count": len(failed),
    }


# Backward-compatible helper used by existing scripts.
def scrape_canada_ca(
    url: str,
    target_selector: Optional[str] = "main",
    exclude_selectors: Optional[List[str]] = None,
    wait_for_selector: Optional[str] = None,
) -> Optional[str]:
    session = make_session()
    try:
        return scrape_with_jina(
            session,
            url,
            target_selector=target_selector or "main",
            exclude_selectors=exclude_selectors or [],
            wait_for_selector=wait_for_selector,
        )
    except Exception as exc:
        print(f"Failed to scrape {url}: {exc}")
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Recursive Canada.ca IRCC manual crawler")
    parser.add_argument("--toc-url", default=TOC_URL, help="Seed URL used when --url is not provided.")
    parser.add_argument(
        "--input-links-md",
        default=DEFAULT_INPUT_LINKS_MD,
        help="Markdown file to extract seed links from (default: input_links.md in this folder).",
    )
    parser.add_argument(
        "--no-input-links-md",
        action="store_true",
        help="Disable loading seed links from markdown file.",
    )
    parser.add_argument(
        "--url",
        action="append",
        default=[],
        help="Additional seed URL(s). Can be provided multiple times.",
    )
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Directory for markdown + state + manifest.")
    parser.add_argument("--allow-domain", action="append", default=["www.canada.ca"], help="Allowed hostname.")
    parser.add_argument(
        "--allow-path-prefix",
        action="append",
        default=[ALLOW_PATH_PREFIX],
        help="Allowed URL path prefix. Can be provided multiple times.",
    )
    parser.add_argument("--max-depth", type=int, default=2, help="Maximum crawl depth from seed URLs.")
    parser.add_argument("--max-pages", type=int, default=250, help="Maximum pages attempted per run.")
    parser.add_argument("--delay-seconds", type=float, default=1.5, help="Delay between successful page scrapes.")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds.")
    parser.add_argument("--retries", type=int, default=3, help="Retries for transient fetch/scrape failures.")
    parser.add_argument("--backoff-base", type=float, default=1.5, help="Exponential backoff base.")
    parser.add_argument("--target-selector", default="main", help="Jina target selector.")
    parser.add_argument("--exclude-selector", default=DEFAULT_EXCLUDE_SELECTORS, help="Comma-separated CSS selectors.")
    parser.add_argument("--wait-for-selector", default=None, help="Optional Jina wait selector.")
    parser.add_argument("--no-generated-alt", action="store_true", help="Disable Jina generated image alt text.")
    parser.add_argument("--no-resume", action="store_true", help="Ignore existing crawl state and start fresh.")
    parser.add_argument(
        "--reject-low-quality",
        action="store_true",
        help="Skip pages that look blocked/too short (disabled by default to preserve all text).",
    )
    parser.add_argument(
        "--dedupe-content-hash",
        action="store_true",
        help="Skip saving pages whose markdown content hash already exists (disabled by default).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    seed_urls: List[str] = []
    if not args.no_input_links_md:
        input_md_path = Path(args.input_links_md)
        if not input_md_path.is_absolute():
            input_md_path = Path(__file__).resolve().parent / input_md_path
        md_urls = load_seed_urls_from_markdown(input_md_path)
        if md_urls:
            print(f"Loaded {len(md_urls)} seed links from: {input_md_path}")
            seed_urls.extend(md_urls)

    seed_urls.extend(list(args.url))
    if not seed_urls:
        seed_urls = [args.toc_url]

    allow_domains = {d.strip().lower() for d in args.allow_domain if d and d.strip()}
    allow_prefixes = [p.strip() for p in args.allow_path_prefix if p and p.strip()]
    exclude_selectors = [s.strip() for s in args.exclude_selector.split(",") if s.strip()]

    result = crawl_recursive(
        seed_urls=seed_urls,
        output_dir=Path(args.output_dir),
        allow_domains=allow_domains,
        allow_path_prefixes=allow_prefixes,
        max_depth=max(0, args.max_depth),
        max_pages=max(1, args.max_pages),
        delay_seconds=max(0.0, args.delay_seconds),
        timeout=max(1.0, args.timeout),
        retries=max(0, args.retries),
        backoff_base=max(1.1, args.backoff_base),
        target_selector=args.target_selector,
        exclude_selectors=exclude_selectors,
        wait_for_selector=args.wait_for_selector,
        with_generated_alt=not args.no_generated_alt,
        resume=not args.no_resume,
        reject_low_quality=args.reject_low_quality,
        dedupe_content_hash=args.dedupe_content_hash,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
