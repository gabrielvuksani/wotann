---
name: multi-source-research
description: Cross-platform research with composite scoring across docs, code, papers, forums
context: fork
paths: []
---

# Multi-Source Research

## When to Use

- Evaluating a new library, framework, or architectural approach before committing.
- Writing a technical RFC that demands triangulation between official docs and field reports.
- Debugging a rare error where a single source won't reveal the real cause.
- Comparing competing solutions (e.g., SQLite vs. DuckDB for WOTANN memory).
- Researching WOTANN provider quirks (Claude vs. GPT vs. Gemini behavior).

## Rules

- Always consult at least 3 independent sources before forming a conclusion.
- Primary sources (official docs, source code, RFCs) outweigh secondary (blog posts).
- Cite every claim with a URL plus access date; undated facts are untrustworthy.
- Prefer content dated within 12 months for fast-moving domains (LLM SDKs, frontend frameworks).
- Record disagreements explicitly rather than silently picking a winner.
- Run searches in parallel, never serially, to save wall time.

## Patterns

- **Priority tiers**: docs (Context7) -> source code (GitHub) -> Q&A (Stack Overflow) -> papers (arxiv) -> blogs.
- **Composite score** = recency x authority x agreement-across-sources.
- **Cross-reference loop**: if two sources contradict, pull a third tiebreaker.
- **Artifact capture**: save key snippets to Engram (`topic_key: research/<topic>`) for reuse.
- **Contradiction log**: note conflicts in `findings.md` so the plan doesn't silently pick a side.

## Example

Researching rate-limit backoff for the WOTANN `providers/router.ts`:
1. Context7 `resolve-library-id: anthropic` -> official retry guidance.
2. GitHub `gh search code "exponential backoff" path:anthropic-sdk-typescript`.
3. arxiv search for "adaptive rate limiting 2025" -> jitter algorithm paper.
4. Stack Overflow for edge cases reported in production.
5. Synthesize into `research/provider-backoff.md` with all five citations.

## Checklist

- [ ] Minimum 3 sources consulted, at least 1 primary.
- [ ] Each claim in the write-up has a citation (URL + date).
- [ ] Recency noted (e.g., "as of 2026-04") for anything time-sensitive.
- [ ] Disagreements explicitly listed with the chosen resolution.
- [ ] Findings saved to Engram for future sessions.

## Common Pitfalls

- Accepting the first SEO-ranked blog as truth; always check the author and date.
- Skipping official docs because they're "boring" — they're the highest-authority source.
- Missing the changelog: a breaking change in v2 invalidates advice written for v1.
