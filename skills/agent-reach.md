---
name: agent-reach
description: Unified search across 14+ platforms - GitHub, npm, SO, HN, Reddit, arxiv, Dev.to
context: fork
paths: []
---

# Agent Reach

## When to Use

- Researching a new library for a WOTANN provider (checking GitHub stars, recent issues, npm weekly downloads).
- Investigating whether a bug is known on Stack Overflow, Hacker News, or the project issue tracker.
- Finding prior art before building a novel WOTANN capability (skills marketplace, memory engines).
- Scanning Reddit + Dev.to for community workarounds to provider quirks.
- Monitoring discourse around a release (Twitter/X, HN front page, Reddit threads).

## Rules

- Fire platform searches in parallel — never sequentially.
- Use platform-specific syntax (GitHub `language:`, npm `keywords:`, SO `[tag]`).
- Dedupe identical URLs but keep different commentary about the same link.
- Weight results by platform authority for the topic (GitHub for code, SO for errors).
- Always filter by recency when the topic is fast-moving (LLMs, JS frameworks).
- Persist the top results to Engram (`topic_key: research/<topic>`) for future sessions.

## Patterns

- **Platform matrix**: each topic maps to 3-5 best-fit platforms.
- **Query templating**: same intent, platform-specific syntax.
- **Composite relevance**: (votes x recency) / distance-from-signal.
- **Snippet capture**: save 2-3 sentences of context with every link.
- **Feedback loop**: if results are thin, rephrase query and retry.

## Example

Topic: "WebSocket rate limit adaptive backoff"
- GitHub: `gh search code "adaptive backoff" language:typescript websocket`
- npm: `npm search adaptive-backoff websocket`
- Stack Overflow: `[websocket] backoff adaptive`
- Hacker News: HN Algolia search "websocket backoff"
- Reddit: `site:reddit.com/r/node websocket backoff`
- arxiv: "adaptive congestion control 2024"

Aggregate, dedupe, rank, save top 10 to Engram.

## Checklist

- [ ] At least 3 platforms queried in parallel.
- [ ] Platform-specific syntax used (not a generic string everywhere).
- [ ] Results deduplicated by URL.
- [ ] Top 5-10 findings saved to Engram for reuse.

## Common Pitfalls

- Running searches serially wastes minutes; always parallelize.
- Taking top search hit without checking date — stale advice leads to wrong code.
- Ignoring low-star repos that have the cleanest implementation; filter by relevance, not only popularity.
