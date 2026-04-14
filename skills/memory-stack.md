---
name: memory-stack
description: 8-layer memory search, save, verify operations
context: main
paths: []
---
# Memory Stack
## Layers
0. Auto-capture (every tool call logged).
1. Core blocks (user/feedback/project/reference).
2. Working memory (current session state).
3. Knowledge graph (entity relationships).
4. Archival (long-term with temporal decay).
5. Recall (skeptical verification before use).
6. Team memory (shared across agents).
7. Proactive context (predicted needs).
## Tools
- `memory_search(query)` — FTS5 + semantic search.
- `memory_replace(block, key, value)` — Update a block entry.
- `memory_verify(id)` — Mark as verified (higher confidence).
- `memory_archive(id)` — Move to archival storage.
## Rules
- Verify before acting on recalled memories (skeptical memory).
- Save decisions proactively (don't wait to be asked).
