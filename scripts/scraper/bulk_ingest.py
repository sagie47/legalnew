#!/usr/bin/env python3
"""
Bulk ingestion script for scraping multiple Canada.ca pages.
Uses Jina AI Reader API with content selection for clean markdown extraction.
"""

import os
import time
import json
from typing import List, Optional
from scrape import scrape_canada_ca, extract_filename_from_url

# Configuration
DATA_DIR = "data"
RATE_LIMIT_DELAY = 2  # Seconds between requests (Jina free tier rate limit)

def ensure_data_dir():
    """Ensure the data directory exists."""
    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)

def scrape_single_page(url: str, output_dir: str = DATA_DIR) -> bool:
    """
    Scrape a single page and save to file.
    
    Args:
        url: The URL to scrape
        output_dir: Directory to save the file
    
    Returns:
        True if successful, False otherwise
    """
    print(f"Scraping: {url}")
    
    content = scrape_canada_ca(url)
    
    if content:
        filename = extract_filename_from_url(url)
        filepath = os.path.join(output_dir, filename)
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        
        print(f"  ✓ Saved to {filepath} ({len(content)} chars)")
        return True
    else:
        print(f"  ✗ Failed to scrape")
        return False

def bulk_scrape(urls: List[str], output_dir: str = DATA_DIR, delay: float = RATE_LIMIT_DELAY):
    """
    Scrape multiple URLs with rate limiting.
    
    Args:
        urls: List of URLs to scrape
        output_dir: Directory to save files
        delay: Seconds to wait between requests
    """
    ensure_data_dir()
    
    print(f"\nStarting bulk scrape of {len(urls)} URLs")
    print(f"Output directory: {output_dir}")
    print(f"Rate limit delay: {delay}s")
    print("="*80)
    
    success_count = 0
    fail_count = 0
    failed_urls = []
    
    for i, url in enumerate(urls, 1):
        print(f"\n[{i}/{len(urls)}]", end=" ")
        
        if scrape_single_page(url, output_dir):
            success_count += 1
        else:
            fail_count += 1
            failed_urls.append(url)
        
        # Rate limiting - sleep between requests (except for the last one)
        if i < len(urls):
            time.sleep(delay)
    
    # Summary
    print("\n" + "="*80)
    print("BULK SCRAPE COMPLETE")
    print("="*80)
    print(f"Total URLs: {len(urls)}")
    print(f"Successful: {success_count}")
    print(f"Failed: {fail_count}")
    
    if failed_urls:
        print("\nFailed URLs:")
        for url in failed_urls:
            print(f"  - {url}")
        
        # Save failed URLs for retry
        failed_path = os.path.join(output_dir, "failed_urls.json")
        with open(failed_path, "w") as f:
            json.dump(failed_urls, f, indent=2)
        print(f"\nFailed URLs saved to {failed_path}")

def scrape_from_hub(hub_url: str, link_pattern: Optional[str] = None):
    """
    Two-step process: scrape hub page, extract links, then scrape all leaf pages.
    
    Args:
        hub_url: The hub page URL
        link_pattern: Optional regex to filter links
    """
    from hub_scraper import extract_links_from_hub
    
    # Step 1: Extract links from hub
    print("Step 1: Extracting links from hub page...")
    links = extract_links_from_hub(hub_url, base_pattern=link_pattern)
    
    if not links:
        print("No links found. Exiting.")
        return
    
    # Save links for reference
    ensure_data_dir()
    links_path = os.path.join(DATA_DIR, "extracted_links.json")
    with open(links_path, "w") as f:
        json.dump(links, f, indent=2)
    print(f"Saved {len(links)} links to {links_path}")
    
    # Step 2: Scrape all leaf pages
    print("\nStep 2: Scraping leaf pages...")
    bulk_scrape(links)

def scrape_from_list(urls: List[str]):
    """Scrape a predefined list of URLs."""
    bulk_scrape(urls)

def scrape_from_file(filepath: str):
    """Load URLs from a JSON file and scrape them."""
    with open(filepath, "r") as f:
        urls = json.load(f)
    bulk_scrape(urls)

if __name__ == "__main__":
    import sys
    
    # Example usage with hardcoded URLs
    # You can also load from a file or extract from a hub
    
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == "hub" and len(sys.argv) > 2:
            # python bulk_ingest.py hub <hub_url> [pattern]
            hub_url = sys.argv[2]
            pattern = sys.argv[3] if len(sys.argv) > 3 else None
            scrape_from_hub(hub_url, pattern)
            
        elif command == "file" and len(sys.argv) > 2:
            # python bulk_ingest.py file <json_file>
            filepath = sys.argv[2]
            scrape_from_file(filepath)
            
        elif command == "list":
            # python bulk_ingest.py list url1 url2 url3 ...
            urls = sys.argv[2:]
            scrape_from_list(urls)
            
        else:
            print("Usage:")
            print("  python bulk_ingest.py hub <hub_url> [pattern]")
            print("  python bulk_ingest.py file <json_file>")
            print("  python bulk_ingest.py list <url1> <url2> ...")
    else:
        # Default: scrape from a predefined list
        print("No arguments provided. Using example URLs...")
        
        example_urls = [
            "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/refugee-protection/resettlement.html",
        ]
        
        # Or extract from hub first
        hub_url = "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/refugee-protection.html"
        scrape_from_hub(hub_url, link_pattern=r'refugee-protection')
