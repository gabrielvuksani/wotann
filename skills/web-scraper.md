---
name: web-scraper
description: 6-phase web scraping with anti-bot bypass and validation
context: fork
paths: []
requires:
  bins: ["node"]
---

# Web Scraper

## 6-Phase Pipeline
1. **Recon** — Analyze target site structure, robots.txt, rate limits.
2. **Stealth** — Set appropriate headers, respect rate limits, use delays.
3. **Extract** — Parse HTML/JSON, handle pagination, follow links.
4. **Validate** — Verify extracted data completeness and correctness.
5. **Protect** — Sanitize data, remove PII if not needed, check legal.
6. **Report** — Output structured data (JSON, CSV) with metadata.

## Tools (prefer in order)
1. **Lightpanda** — Fastest headless browser (9x faster, 16x less memory).
2. **Playwright** — Full browser automation when JS rendering needed.
3. **fetch/curl** — Simple HTTP when no JS rendering needed.

## Rules
- ALWAYS respect robots.txt.
- ALWAYS add delays between requests (1-3 seconds minimum).
- ALWAYS set a descriptive User-Agent header.
- NEVER scrape personal data without explicit consent.
- NEVER overload target servers.

## Error Handling
- Retry with exponential backoff on 429/503.
- Rotate User-Agent on repeated blocks.
- Save checkpoint data to resume interrupted scrapes.
