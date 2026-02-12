import requests
import re
from typing import List, Optional
import os

API_KEY = os.getenv("JINA_API_KEY", "")

def extract_links_from_hub(hub_url: str, base_pattern: Optional[str] = None) -> List[str]:
    """
    Scrape a hub page and extract all relevant links.
    
    Args:
        hub_url: The hub page URL containing links to content pages
        base_pattern: Optional regex pattern to filter links (e.g., r'refugee-protection')
    
    Returns:
        List of extracted URLs
    """
    from scrape import scrape_canada_ca
    
    print(f"Scraping hub: {hub_url}")
    hub_content = scrape_canada_ca(hub_url, target_selector="#wb-cont")
    
    if not hub_content:
        print("Failed to scrape hub page")
        return []
    
    # Find all URLs in the markdown content
    # Look for markdown links [text](url) or bare URLs
    url_pattern = r'https?://[^\s\)\]<>"{}|\\^`\[\]]+'
    found_urls = re.findall(url_pattern, hub_content)
    
    # Clean up URLs (remove trailing punctuation)
    found_urls = [url.rstrip('.,;:!?)') for url in found_urls]
    
    # Filter to only canada.ca URLs
    canada_urls = [url for url in found_urls if 'canada.ca' in url]
    
    # Remove duplicates while preserving order
    seen = set()
    unique_urls = []
    for url in canada_urls:
        if url not in seen:
            seen.add(url)
            unique_urls.append(url)
    
    # Apply base pattern filter if provided
    if base_pattern:
        import re as re_module
        unique_urls = [url for url in unique_urls if re_module.search(base_pattern, url)]
    
    print(f"Found {len(unique_urls)} unique links")
    return unique_urls

def extract_links_from_html(hub_content: str, base_url: str) -> List[str]:
    """
    Alternative: Extract links from HTML content using regex.
    
    Args:
        hub_content: The HTML or markdown content
        base_url: Base URL for resolving relative links
    
    Returns:
        List of absolute URLs
    """
    # Look for href attributes
    href_pattern = r'href=["\']([^"\']+)["\']'
    hrefs = re.findall(href_pattern, hub_content)
    
    absolute_urls = []
    for href in hrefs:
        if href.startswith('http'):
            absolute_urls.append(href)
        elif href.startswith('/'):
            # Relative to root
            from urllib.parse import urljoin
            absolute_urls.append(urljoin(base_url, href))
    
    return list(set(absolute_urls))

if __name__ == "__main__":
    # Example: Scrape the refugee protection hub
    hub_url = "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/refugee-protection.html"
    
    # Extract links related to refugee-protection
    links = extract_links_from_hub(hub_url, base_pattern=r'refugee-protection')
    
    print("\n" + "="*80)
    print("EXTRACTED LINKS:")
    print("="*80)
    for i, link in enumerate(links[:20], 1):  # Show first 20
        print(f"{i}. {link}")
    
    if len(links) > 20:
        print(f"\n... and {len(links) - 20} more links")
    
    # Save to file for bulk ingestion
    import json
    with open("data/hub_links.json", "w") as f:
        json.dump(links, f, indent=2)
    print(f"\nSaved {len(links)} links to data/hub_links.json")
