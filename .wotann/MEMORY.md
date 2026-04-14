# WOTANN Memory Index

## Memory Layers
- Layer 0 (Auto-Capture): Hook-driven, every tool call logged
- Layer 1 (Core Blocks): Always-in-context, agent self-editable
- Layer 2 (Working): Topic-keyed, FTS5 search
- Layer 3 (Knowledge Graph): Bi-temporal facts, entity relationships
- Layer 4 (Archival): Vector search + FTS5 fusion
- Layer 5 (Recall): Auto-summarized conversation archives
- Layer 6 (Team): Multi-agent shared memory
- Layer 7 (Proactive): Predicted context pre-loading

## Database
- Path: ~/.wotann/memory.db
- Engine: SQLite + FTS5 + WAL mode
- Search: hybrid (BM25 + vector + LLM re-ranking)
