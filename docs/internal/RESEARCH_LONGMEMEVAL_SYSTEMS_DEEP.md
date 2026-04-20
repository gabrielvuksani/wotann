# RESEARCH: LongMemEval Leaderboard Systems — Deep Dive (2026-04-20)

> **Scope**: Every system on the LongMemEval leaderboard (and the memory-adjacent projects worth stealing from), researched to per-algorithm depth. WOTANN already ships `src/memory/` with 45+ files (observation-extractor, graph-rag, wings-rooms-halls, mem-palace, dual-timestamp, freshness-decay, hybrid-retrieval-v2, etc.) — this document is the *competitive port list* and *authoritative scoring map*, not the implementation plan skeleton.
> **Method**: 16 WebFetch pulls + 10 WebSearch passes, every claim URL-cited. Cross-checked the same metric from 2+ sources whenever a system self-reports a headline number.
> **Predecessor**: `RESEARCH_BENCHMARK_LEADERS_TECHNIQUES.md` (covered Mastra OM, MemPalace, Mem0 at tactical depth). This doc goes one level deeper on every remaining competitor and closes the gap for a full taxonomy.

---

## EXECUTIVE SUMMARY (400 words)

**State of LongMemEval-S on 2026-04-20** (headline numbers on the 500-question S-split unless noted):

| Rank | System | Score | Model | Reproducible? | Moat |
|---|---|---|---|---|---|
| — | **MemPalace "raw"** | 96.6% R@5 | n/a (retrieval-only) | **Yes — ChromaDB baseline** | Not MemPalace code; ChromaDB default [[mempalace Issue #39](https://github.com/MemPalace/mempalace/issues/39)]|
| 1 | **Hindsight (OSS-120B + Gemini-3)** | 91.4% | Gemini-3-Pro | Apache-2.0, MIT [[GH](https://github.com/vectorize-io/hindsight)] | TEMPR 4-way retrieval + CARA opinion layer [[arXiv 2512.12818](https://arxiv.org/html/2512.12818v1)]|
| 2 | **OMEGA** | 95.4% (466/500) | Local CPU + GPT-4o judge | **Apache-2.0** [[omegamax.co](https://omegamax.co/benchmarks)] | 3-layer SQLite + ONNX + sqlite-vec fully local |
| 3 | **Mastra Observational Memory** | 94.87% (gpt-5-mini); 84.23% (gpt-4o) | gpt-5-mini | **Yes** [[mastra.ai](https://mastra.ai/research/observational-memory)] | Stable-prefix cacheable context (Observer+Reflector) |
| 4 | **Mem0 v3 (token-efficient)** | 93.4% | gpt-5-mini | **Apache-2.0** [[mem0.ai/blog](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm)] | Single-pass ADD-only + entity linking |
| 5 | **Supermemory ASMR (experimental)** | ~99% | Gemini 2.0 Flash agents | Open-source planned [[blog](https://blog.supermemory.ai/we-broke-the-frontier-in-agent-memory-introducing-99-sota-memory-system/)] | Agent swarm replaces vector DB |
| 6 | **Hindsight OSS-120B (open only)** | 89.0% | OSS-120B | MIT [[GH](https://github.com/vectorize-io/hindsight)] | Same TEMPR+CARA, smaller model |
| 7 | **Supermemory (production)** | 85.2% (Gemini-3), 84.6% (GPT-4.5), 81.6% (GPT-4o) | GPT-4o/Gemini-3 | Paid [[research](https://supermemory.ai/research/)] | Chunk-based ingestion + relational versioning |
| 8 | **Hindsight (OSS-20B)** | 83.6% | OSS-20B | MIT | Same pipeline, small model |
| 9 | **EverMemOS** | 83.0% | Python | **Apache-2.0** [[GH](https://github.com/EverMind-AI/EverOS)] | HyperMem hypergraph + 4-layer brain-inspired |
| 10 | **RetainDB** | 79% | gpt-5.4-mini | Closed (self-serve) [[retaindb.com](https://www.retaindb.com/benchmark)] | Chronological dump, 13ms retrieval |
| 11 | **TiMem** | 76.88% (S-split) | gpt-4o-mini | **arXiv** [[2601.02845](https://arxiv.org/abs/2601.02845)] | 5-level Temporal Memory Tree, -52% recall tokens |
| 12 | **Zep / Graphiti** | 71.2% (gpt-4o, LongMemEval); 94.8% (DMR) | gpt-4o | **Apache-2.0** [[GH](https://github.com/getzep/graphiti)] | Bi-temporal edges (t_valid/t_invalid) |
| 13 | **Full-context gpt-4o** | 60-64% | gpt-4o | Free | Baseline (dump whole history) |
| 14 | **Naive RAG** | 52% | Retrieve turns + gpt-4o | Free | Sanity floor |
| 15 | **No-retrieval gpt-4o** | ~30% | Raw call | Free | Paper minimum [[arXiv 2410.10813](https://arxiv.org/abs/2410.10813)] |

**Top-5 techniques WOTANN must ship in src/memory/ within 30 days:**

1. **Stable-prefix observational context** (Mastra) — kill per-turn retrieval injection; observations live at the top of the prompt and only change at threshold-triggered reflection boundaries. 4-10× prompt-cache savings. File: `src/memory/observational.ts` (new).
2. **Single-pass ADD-only extraction** (Mem0 v3) — no UPDATE/DELETE reconciliation; new facts live alongside old. +53.6pp on assistant memory alone. File: `src/memory/conversation-miner.ts` (refactor existing).
3. **Four-way parallel retrieval + RRF + cross-encoder rerank** (Hindsight TEMPR) — semantic HNSW + BM25 + graph spreading + temporal filter, fused via RRF(f)=Σ 1/(k+rᵢ), reranked by ms-marco-MiniLM-L-6-v2. File: `src/memory/hybrid-retrieval-v2.ts` (extend).
4. **Bi-temporal typed edges** (Zep/Graphiti) — every memory relation carries (t_valid, t_invalid) on knowledge timeline + (t'_created, t'_expired) on ingest timeline. Enables knowledge-updates category gain (+6.5pp Zep, +20.6pp EverMemOS). File: `src/memory/dual-timestamp.ts` + `src/memory/graph-rag.ts`.
5. **Agent-generated facts are first-class** (Mem0 v3) — when the agent says "I've booked your flight," that line gets extracted with user-equal priority. Closes the single-session-assistant blind spot. File: `src/memory/observation-extractor.ts`.

**What NOT to copy**: MemPalace's wings/rooms/drawers palace structure — the 96.6% is ChromaDB's default, not the structure. Rooms mode regresses 7 pts vs raw. WOTANN has `src/memory/wings-rooms-halls.ts` — deprecate or keep as an *organizational* view, but never claim it's the retrieval path.

**WOTANN's defensible target**: 92-94% on LongMemEval-S with gpt-5-mini via Mastra's Observational Memory pattern + Mem0's single-pass extraction + Hindsight's TEMPR retrieval, each already partially represented in `src/memory/`. The path to >95% requires an agent-swarm extraction pipeline (Supermemory ASMR) or a cross-encoder reranker tuned on the S-split — neither in-scope for the next sprint.

---

## PART 0 — The LongMemEval Benchmark Itself (arXiv:2410.10813)

### 0.1 What the benchmark actually measures

LongMemEval ([Wu et al. 2024, ICLR 2025](https://arxiv.org/abs/2410.10813)) is the field-standard benchmark for long-term memory in conversational assistants. 500 meticulously curated questions embedded in freely-scalable multi-session histories.

**The 5 core memory abilities** ([GitHub README](https://github.com/xiaowu0162/longmemeval)):

1. **Information Extraction** — Locate a specific fact within one chat history turn.
2. **Multi-session Reasoning** — Synthesize facts across multiple past sessions (e.g., "which cuisines has the user eaten that are less than 500 calories?").
3. **Knowledge Updates** — Track evolving state (e.g., user changes their job, address, or preference over time).
4. **Temporal Reasoning** — Date arithmetic, event ordering, duration queries.
5. **Abstention** — Recognize when the question refers to something that never happened; refuse to hallucinate.

### 0.2 The three splits

| Split | Sessions | Tokens | Questions |
|---|---|---|---|
| **LongMemEval-S** | ~40 history sessions per question (~50 in some category reshuffles) | ~115k per question for Llama-3 tokenizer; ~57M total across all 500 | 500 |
| **LongMemEval-M** | ~500 history sessions per question | Unspecified; order-of-magnitude 10× S | 500 |
| **LongMemEval-Oracle** | Evidence-only — just the sessions that contain the answer | Minimal | 500 |

Most published numbers (Mastra, OMEGA, Mem0, Supermemory, Hindsight, EverMemOS) are on **LongMemEval-S**. Oracle is effectively the "memory-retrieval bypass" ceiling — it measures how well the backbone reasons when retrieval is perfect. Mastra's gpt-4o beats Oracle (84.23% vs 82.4%) because OM's consolidated observations are actually *easier* to reason over than the raw evidence sessions. That inversion is an important insight: *good summarization can exceed oracle retrieval because it removes distractors*.

### 0.3 Official scorer

```bash
python3 evaluate_qa.py gpt-4o your_hypothesis_file ../../data/longmemeval_oracle.json
```

The scorer runs **GPT-4o as judge** with a question-type-specific prompt (the S-split ships `autoeval_label` per question). Each response is labeled 1 or 0 by the judge; final accuracy is mean over the 500 questions, reported overall + per-category. There is no published inter-annotator agreement between judge models; the community uses GPT-4o. When a paper reports numbers using a different judge (Gemini-3 Pro for example), *do not compare directly* to GPT-4o-judged numbers without an ablation (Mastra publishes both judges).

**Common scoring pitfalls** (detected via [MemPalace Issue #29](https://github.com/MemPalace/mempalace/issues/29) and [Issue #875](https://github.com/MemPalace/mempalace/issues/875)):
- **R@5 retrieval recall** is not QA accuracy. MemPalace's 96.6% is R@5 recall; Mastra's 94.87% is binary QA accuracy. Placing them in the same column is dishonest.
- **Holdout vs. tuned set**. MemPalace's 100% "hybrid v4 + Haiku" was tuned on failing questions; held-out is 98.4%. Always cite held-out.
- **Top-k > session count**. MemPalace LoCoMo 100% used top-k=50 retrieval against 19-32 session conversations — effectively dumping the whole conversation and calling it "retrieval."

---

## PART 1 — Per-System Deep Dives

### 1.1 OMEGA — 95.4% (466/500) — Apache-2.0 — [omegamax.co](https://omegamax.co/benchmarks)

**Identity**: [github.com/omega-memory/omega-memory](https://github.com/omega-memory/omega-memory), Apache-2.0, v1.4.7 (Apr 14, 2026), 102 stars / 19 forks. Omega-pro (paid) adds 47 more MCP tools.

**Architecture — 3-layer SQLite**:
- **Memory table**: typed records (decision / lesson / error / preference / session_summary) with SHA256 deduplication.
- **Vector index**: 384-dim bge-small-en-v1.5 ONNX embeddings via `sqlite-vec` for cosine similarity.
- **Graph layer**: typed edges (`related` / `supersedes` / `contradicts`), BFS up to 5 hops.

Whole thing runs CPU-only in a single process. Startup ~31MB RSS, ~337MB after model load. Embedding ~8ms, queries <50ms.

**Hybrid 6-stage retrieval**:
1. Vector similarity (sqlite-vec cosine)
2. FTS5 keyword match
3. Type-weighted scoring (decisions/lessons × 2)
4. Contextual re-ranking (tag/project/file boosting)
5. Cross-encoder rerank (ms-marco-MiniLM-L-6-v2)
6. Dedup + time-decay

**LongMemEval-S score breakdown** (2026-04-20):

| Category | Score | N |
|---|---|---|
| Single-Session Recall | 99% | 125/126 |
| Preference Application | 100% | 30/30 |
| Multi-Session Reasoning | 83% | 111/133 |
| Knowledge Updates | 96% | 75/78 |
| Temporal Reasoning | 94% | 125/133 |
| **Overall** | **95.4%** | **466/500** |

**25 MCP tools** ship out of the box: `omega_store`, `omega_query`, `omega_similar`, `omega_timeline`, `omega_traverse`, `omega_consolidate`, `omega_compact`, `omega_lessons`, `omega_checkpoint`, `omega_resume_task`, etc.

**Memory decay**: no TTL. Session summaries expire after 1 day; lessons + preferences are permanent. Dedup = SHA256 (exact) + embedding ≥ 0.85 (semantic). Evolution at similarity 55-95% appends insights rather than creating duplicates.

**Signature techniques** (top 5):
1. **Single-process MCP** — everything (storage, embeddings, graph, rerank) in one binary, no Docker, no Neo4j.
2. **Typed-edge graph** — `supersedes` and `contradicts` edges capture knowledge evolution natively.
3. **Type-weighted scoring** — decisions/lessons get 2× boost (institutional knowledge > one-off facts).
4. **CPU-only ONNX + sqlite-vec** — zero GPU, zero external service dependency.
5. **Evolution-not-deduplication** — similar content (55-95%) triggers append, not replace. Preserves history.

**WOTANN port priority**: **P0**. WOTANN has `src/memory/store.ts`, `src/memory/vector-store.ts`, `src/memory/graph-rag.ts`, `src/memory/relationship-types.ts` — the *shape* is there. Missing: (a) the 6-stage hybrid retrieval pipeline ordered exactly as OMEGA runs it, (b) typed `supersedes`/`contradicts` edges in the relationship-types, (c) type-weighted scoring multipliers. Target file: `src/memory/hybrid-retrieval-v2.ts` (extend to match OMEGA ordering).

**Reproducibility**: Highly reproducible. Apache-2.0, ~12MB db per 242 memories, clone + `npm start` gets you a working MCP server. WOTANN should run OMEGA against its own `evals/` split as a sanity reference.

---

### 1.2 Hindsight (Vectorize) — 91.4% (Gemini-3), 89.0% (OSS-120B), 83.6% (OSS-20B) — MIT — [arXiv 2512.12818](https://arxiv.org/html/2512.12818v1)

**Identity**: [github.com/vectorize-io/hindsight](https://github.com/vectorize-io/hindsight), MIT, v0.5.3 (Apr 17, 2026), 9.8k stars / 588 forks. Monorepo: hindsight-api, hindsight-cli, hindsight-embed, hindsight-control-plane, helm/, docker/. 70.4% Python, 16.7% TypeScript, 3.6% Rust.

**Architecture — TEMPR + CARA**:

TEMPR (Temporal Entity Memory Priming Retrieval) does both retain + recall:

**Retain phase**:
- LLM extracts 2-5 **comprehensive facts per conversation** (narrative chunking, not sentence-level).
- Each fact gets temporal metadata (occurrence interval + mention time) and a classification into one of **4 networks**: world (objective) / experience (agent biography) / opinion (subjective) / observation (entity summary).
- Entity resolution = string similarity + co-occurrence + temporal proximity.
- Memory graph connects facts via 4 link types: **temporal** (exponential decay by time diff), **semantic** (cosine ≥ threshold), **entity** (same entity mentioned), **causal** (explicit cause-effect).

**Recall phase — 4 parallel channels, RRF fusion, neural rerank**:
1. **Semantic**: HNSW vector similarity
2. **Keyword**: BM25
3. **Graph**: spreading activation across entity/temporal/causal links
4. **Temporal**: interval-filter when query has time constraint

RRF formula: `RRF(f) = Σ¹⁴ 1/(k + rᵢ(f))` where each channel contributes inverse of its rank. Then ms-marco-MiniLM-L-6-v2 cross-encoder reranks, then token-budget filter.

CARA (Coherent Adaptive Reasoning Agents) is the opinion/preference layer:
- **3 disposition parameters on 1-5 scale**: skepticism, literalism, empathy.
- **Bias strength 0-1**: modulates disposition weight.
- Opinions store (text, confidence 0-1, timestamp, related entities).
- Reinforcement: new evidence classified reinforcing (+α) / weakening (-α) / contradicting (-2α) / neutral (unchanged).

**LongMemEval-S results** (Gemini-3 Pro Preview, the 91.4% run):

| Model | Overall | Δ vs full-context baseline |
|---|---|---|
| Hindsight + OSS-20B | 83.6% | +44.6 |
| Hindsight + OSS-120B | 89.0% | — |
| Hindsight + Gemini-3 | **91.4%** | — |

**Signature techniques** (top 5):
1. **Narrative chunking (2-5 facts per conversation)** — preserves cross-turn context vs sentence splits.
2. **4-network fact classification** — world/experience/opinion/observation makes retrieval type-aware.
3. **4-channel parallel retrieval + RRF + cross-encoder** — the "canonical" 2026 retrieval stack.
4. **Exponential time-decay on temporal links** — `weight = exp(-λ·Δt)` on link weights.
5. **CARA's numeric disposition prompts** — "skepticism=4" gets verbalized into system prompt at retrieval time.

**WOTANN port priority**: **P0** for TEMPR 4-channel retrieval; **P2** for CARA (opinion layer is domain-specific). WOTANN already has `src/memory/hybrid-retrieval-v2.ts`, `src/memory/contextual-embeddings.ts`, `src/memory/freshness-decay.ts` — the channels exist. Missing: (a) spreading activation on the graph (`src/memory/graph-rag.ts` needs a `spread(seed_nodes, hops, decay_fn)` API), (b) the RRF fusion code path, (c) cross-encoder rerank stage. Target file: `src/memory/hybrid-retrieval-v2.ts` + `src/memory/graph-rag.ts`.

**Reproducibility**: MIT, Docker-ready. The v0.5.3 ships a `hindsight-embed` that runs without any server — ideal as a reference. WOTANN's `src/memory/evals/` should have a Hindsight comparator.

---

### 1.3 Mastra Observational Memory — 94.87% (gpt-5-mini), 84.23% (gpt-4o), 93.27% (gemini-3) — Proprietary/Open — [mastra.ai](https://mastra.ai/research/observational-memory)

**Identity**: [mastra.ai](https://mastra.ai/), TypeScript agent framework. Observational Memory (OM) is the memory subsystem of the Mastra framework.

**Architecture — Observer/Reflector dyad**:

- **Observer agent** watches conversations; when message history crosses a token threshold, it converts raw messages into "concise, dense notes" with: current task, priority-tagged observations (🔴🟡🟢), titles, date-grouped timestamps.
- **Reflector agent** fires on a second (higher) threshold — restructures observations: combines related items, reflects on patterns, removes superseded context.
- **Storage format**: formatted **text, not structured JSON**. Two-level bulleted lists with emoji priority markers. 3-6× compression on text; 5-40× on tool-heavy workloads.

**The critical insight — prompt-cache compatibility**:

> "The prefix (system prompt + observations) doesn't change between turns. This means high prompt cache hit rates."

Every other memory system (Mem0, Zep, Hindsight, OMEGA) injects *per-turn retrieved* memories into the context, *breaking* the prompt cache on every turn. Mastra mutates observations **only at reflection boundaries**, so 4-10× of the context tokens stay cached across many agent/user turns. This is the single biggest cost-per-query advantage in the leaderboard.

**LongMemEval-S scores by backbone**:

| Backbone | Overall | Single-session-pref | Multi-session (ceiling) |
|---|---|---|---|
| gpt-4o | 84.23% | 73.3%-100% | 87.2% |
| gemini-3-pro-preview | 93.27% | — | — |
| **gpt-5-mini** | **94.87%** | — | — |

Mastra explicitly notes gpt-4o beats the Oracle split (82.4%) — their consolidated observations remove distractors that Oracle keeps.

**Signature techniques** (top 5):
1. **Text, not JSON, for observations** — humans+LLMs both read text better than nested objects; cheaper to consolidate.
2. **Two-threshold dyad (Observer + Reflector)** — not one compaction pass; two different abstraction layers.
3. **Stable-prefix cache compatibility** — *the* Mastra moat. Anyone can copy it.
4. **Emoji priority markers** — 🔴🟡🟢 in the text itself; model learns to weight via prompt attention.
5. **Current-task pinning** — Observer explicitly tracks "current task" at top of notes so the model always knows "where we are."

**WOTANN port priority**: **P0**. WOTANN has `src/memory/observation-extractor.ts`, `src/memory/active-memory.ts`, `src/memory/session-ingestion.ts` — the Observer side exists. Missing: (a) Reflector as a *separate* agent (current WOTANN likely conflates them), (b) the text-not-JSON serialization format, (c) the emoji-priority convention, (d) **the stable-prefix contract** — WOTANN's prompt-engine needs to guarantee memory changes only at reflection boundaries. Target files: `src/memory/observational.ts` (new), refactor `src/memory/session-ingestion.ts` + `src/prompt/` to expose the cache-stable region.

**Reproducibility**: Mastra's blog is a reference architecture with pseudocode; the Mastra framework itself implements it. Very replicable. WOTANN can ship an Observational Memory middleware as a provider-agnostic TS module.

---

### 1.4 Mem0 v3 (token-efficient) — 93.4% LongMemEval / 91.6% LoCoMo — Apache-2.0 — [mem0.ai/blog](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm)

**Identity**: [github.com/mem0ai/mem0](https://github.com/mem0ai/mem0), Apache-2.0, 53.6k stars / 6k forks. Python 58.4% + TypeScript 31.3%. The v2→v3 "token-efficient" algorithm shipped in early April 2026.

**The 67.8% → 93.4% jump**: +26pp on LongMemEval + +20pp on LoCoMo. Driver of the jump:

**Old algorithm (v2)** — 2-pass extraction:
1. LLM pass 1: extract candidate facts from messages.
2. LLM pass 2: reconcile against existing memories using ADD / UPDATE / DELETE.

Failure modes:
- UPDATE sometimes *overwrote* relevant info.
- DELETE sometimes removed info that became relevant later.
- Agent-generated facts ("I've booked your flight") were *ignored*.
- Keyword search failed on verb forms ("attend" vs "attending").
- No entity linking.
- No temporal state representation.

**New algorithm (v3)** — single-pass ADD-only:
- **One LLM call, ADD only**. When info changes, new fact lives *alongside* old. Both survive.
- **50% extraction-latency drop** (1 LLM call vs 2).
- **Entity linking layer**: every memory gets entity analysis (proper nouns, quotes, compound phrases). Entities embedded + indexed in a dedicated lookup table. Query entities match against the lookup; matching memories get rank boost.
- **Triple-signal retrieval scored in parallel, fused via rank**:
  - Semantic (vector)
  - BM25 keyword (with verb-form normalization)
  - Entity matching (from the lookup layer)
- **Agent-generated facts get user-equal priority** — single biggest win: single-session-assistant category jumped 46.4% → 100% (+53.6pp).

**Per-category gains** (LongMemEval, v2 → v3):

| Category | Δ |
|---|---|
| Single-session-assistant | **+53.6** |
| Temporal reasoning | **+42.1** |
| Knowledge updates | +16.7 |
| Multi-hop reasoning | +23.1 (LoCoMo) |
| Temporal queries | +29.6 (LoCoMo) |

**Mean tokens per retrieval call**: 6,780 LongMemEval / 6,950 LoCoMo — under 7k. Full-context baselines use 25,000+.

**Signature techniques** (top 5):
1. **ADD-only, never overwrite** — resolves the "delete-then-need" bug class.
2. **Agent facts = user facts** — closes the assistant blind spot.
3. **Entity-lookup layer** — not a graph; a flat index that boosts semantic/keyword hits.
4. **Triple-signal parallel retrieval with rank fusion** — same shape as Hindsight's 4-channel, simpler implementation.
5. **Verb-form normalization on BM25** — small but +pp on temporal + multi-session.

**WOTANN port priority**: **P0**. WOTANN has `src/memory/entity-types.ts`, `src/memory/conversation-miner.ts` — the entity layer and miner exist. Missing: (a) explicit ADD-only contract (current code likely has UPDATE/DELETE paths), (b) verb-form normalizer in BM25, (c) agent-generated-fact priority in the miner, (d) parallel-scored triple-signal retrieval. Target files: `src/memory/conversation-miner.ts`, `src/memory/entity-types.ts`, `src/memory/hybrid-retrieval-v2.ts`, `src/memory/observation-extractor.ts`.

**Reproducibility**: Highest of any system. Apache-2.0, 53.6k stars, Python + TS SDKs. WOTANN should run Mem0 as a baseline in `src/memory/evals/`.

---

### 1.5 Supermemory — 81.6% (GPT-4o prod), ~99% (ASMR experimental) — [blog](https://blog.supermemory.ai/we-broke-the-frontier-in-agent-memory-introducing-99-sota-memory-system/)

**Identity**: Closed-source production system; ASMR experimental flow promised open-source "early April 2026." [supermemory.ai](https://supermemory.ai/research/).

**Architecture — production stack (81.6%)**: 5-layer context stack with a vector graph engine, ontology-aware edges, automatic relationship/contradiction/temporal reasoning. Chunk-based ingestion, relational versioning, temporal grounding, hybrid search, session-based ingestion.

**Architecture — ASMR (99%)**: *Agent swarm replaces vector DB entirely*.

**Reader Agents** (ingestion): 3 parallel Gemini 2.0 Flash agents read raw sessions concurrently. They extract across 6 vectors:
1. Personal Information
2. Preferences
3. Events
4. Temporal Data
5. Updates
6. Assistant Info

**Search Agents** (retrieval): 3 parallel specialists when a query arrives:
- One hunts direct facts.
- One chases contextual cues.
- One reconstructs timelines.

They reason (not semantic-match) over stored findings. "Cognitive reasoning over stored findings."

**Answer Ensembles**: two experimental flows — 8 variants running independently (98.60% accuracy), or 12-variant decision forests with aggregator synthesis (97.20%).

**LongMemEval-S**:

| System | Model | Score |
|---|---|---|
| Supermemory (prod) | GPT-4o | 81.6% |
| Supermemory (prod) | GPT-4.5 | 84.6% |
| Supermemory (prod) | Gemini-3 | 85.2% |
| Supermemory ASMR (8-variant) | Gemini 2.0 Flash swarm | 98.60% |
| Supermemory ASMR (12-variant) | Gemini 2.0 Flash swarm | 97.20% |

**Signature techniques** (top 5):
1. **Agent swarm replaces vector DB** — retrieval is *reasoning*, not similarity.
2. **6 extraction vectors as explicit schema** — forces the reader to cover all categories.
3. **Parallel specialist search agents** — each agent has a *role* (fact-finder, context-reader, timeline-reconstructor).
4. **Answer ensembles** — 8-12 variants + aggregator. Explicit majority voting.
5. **Fast readers (Gemini 2.0 Flash)** — cheap enough to parallelize 3-12×.

**WOTANN port priority**: **P1** (production 5-layer), **P2** (ASMR swarm — expensive per query). Production path is achievable; ASMR is a later moonshot. Missing from WOTANN: (a) ontology-aware edges (`src/memory/relationship-types.ts` has types, needs ontology), (b) relational versioning (every memory mutation tracked), (c) multi-agent reader orchestration. Target files: `src/memory/unified-knowledge.ts`, `src/memory/incremental-indexer.ts`, new `src/memory/reader-swarm.ts` for the 3-reader pattern.

**Reproducibility**: Production is closed-source. ASMR is pending open-source; once released, port directly.

---

### 1.6 EverMemOS — 83.0% — Apache-2.0 — [GitHub EverMind-AI/EverOS](https://github.com/EverMind-AI/EverOS)

**Identity**: 4.1k stars / 441 forks, Apache-2.0, Python 94.4%. Backed by TCCI (Tencent Cloud Computing International). Won an $80,000 memory competition in April 2026 [[aijourn](https://aijourn.com/end-agentic-amnesia-evermind-launches-a-memory-platform-and-an-80000-global-competition-as-evermemos-sets-new-sota-results-across-multiple-benchmarks/)].

**Architecture — 4 brain-inspired layers**:
- **Episodic memory** — conversation histories
- **Semantic memory** — facts and relationships
- **Procedural memory** — learned patterns
- **Autobiographical memory** — personalized patterns

Plus two functional systems:
- **Agentic Layer** — prefrontal-cortex analog: attention, planning, executive control.
- **Memory Layer** — cerebral-cortex analog: long-term consolidation + storage.

**Two core modules**:
- **EverCore** — self-organizing memory OS, "biological imprinting" metaphor. Extracts, structures, retrieves long-term knowledge.
- **HyperMem** — hypergraph-based hierarchical memory. Hyperedges capture high-order associations. Organized into topic / event / fact layers.

**Benchmarks**:
- LongMemEval: **83.0%** (with +20.6pp on knowledge-updates specifically — category leader).
- LoCoMo: 93% overall; HyperMem 92.73%.
- Also evaluates on PersonaMem.

**EvoAgentBench** — a companion benchmark EverMind publishes: measures longitudinal growth curves (transfer efficiency, error avoidance, skill-hit quality) of agents *with vs without evolution*.

**Signature techniques** (top 5):
1. **Hypergraph over flat graph** — hyperedges capture N-ary relations (not pairwise).
2. **Brain-inspired 4-type memory** — mirrors psychological model (episodic/semantic/procedural/autobiographical).
3. **Biological-imprinting extraction** — marketing frame, but underlying algo is pattern-locking on repeated facts.
4. **Self-evolving agents** — longitudinal improvement, evaluated on EvoAgentBench.
5. **Agentic layer / memory layer split** — planner vs. memory store is cleanly separated.

**WOTANN port priority**: **P2**. WOTANN has `src/memory/episodic-memory.ts` and enough graph infrastructure. The hypergraph + procedural/autobiographical distinctions are worth borrowing, but the +20.6pp on knowledge-updates is achievable via bi-temporal edges (Zep pattern) without the full brain metaphor. Target files: `src/memory/episodic-memory.ts`, `src/memory/knowledge-update-dynamics.ts`.

**Reproducibility**: Apache-2.0, repo live, EvoAgentBench published. Clone-able.

---

### 1.7 RetainDB — 79% — Closed (self-serve) — [retaindb.com/benchmark](https://www.retaindb.com/benchmark)

**Identity**: Proprietary SaaS, published LongMemEval numbers March 2026. *Best-in-class for preference recall (88%)*.

**Architecture — 4-stage chronological**:
1. **Turn-by-turn extraction**: every user AND assistant turn processed individually by gpt-5.4-mini. Sliding 3-turn context window to resolve pronouns/vague references without leaking future info.
2. **Canonical deduplication**: dedup during write, with structured metadata for temporal tracking.
3. **Schema per memory**: `{eventDate, documentDate, confidence}`. Quality gates filter casual chatter + unresolved references pre-index.
4. **Chronological retrieval**: "dumps" the whole memory timeline in date order (not semantic-filtered). Lets the LLM do temporal reasoning natively.

**LongMemEval-S per-category**:

| Category | RetainDB | Supermemory (prod) | Zep |
|---|---|---|---|
| Single-session user | 88% | 97% | 93% |
| **Single-session preference** | **88%** (SOTA) | 70% | 57% |
| Temporal reasoning | 74% | 77% | 62% |
| Knowledge update | 76% | 89% | 83% |
| Multi-session | 68% | 71% | 58% |
| **Overall** | **79%** | 81.6% | — |

**Ancillary claims**: 0% hallucination on code documentation Q&A (vs 95.5% for vanilla GPT-5). 13ms average retrieval latency.

**Signature techniques** (top 5):
1. **Turn-by-turn extraction with 3-turn sliding window** — not session-level, not per-message; "triplet" context.
2. **Explicit eventDate + documentDate + confidence per memory** — temporal provenance is a schema field, not a side effect.
3. **Chronological-dump retrieval** — no semantic filtering for the temporal category. LLM does the work.
4. **Quality gates pre-index** — drop casual chatter / unresolved refs before write (not retrieval).
5. **Preference-specialist pipeline** — 88% preference recall = category SOTA.

**WOTANN port priority**: **P1** for the per-turn extractor with 3-turn window. Simplest algorithm in this list; highest preference-category score. Target files: `src/memory/observation-extractor.ts`, `src/memory/dual-timestamp.ts` (already exists — extend to include `confidence`).

**Reproducibility**: Closed SaaS. Self-serve API. Not replicable, but the *algorithm* is described in plain text on the benchmark page and trivial to port.

---

### 1.8 TiMem — 76.88% (LongMemEval-S) — arXiv:2601.02845

**Identity**: [arXiv:2601.02845](https://arxiv.org/abs/2601.02845), [github.com/TiMEM-AI/timem](https://github.com/TiMEM-AI/timem). Research paper with code.

**Architecture — Temporal Memory Tree (TMT)**: 5-level hierarchy:

| Level | Name | Contents |
|---|---|---|
| **L1** | Segments | Short utterance ranges (message-level) |
| **L2** | Sessions | Full conversations |
| **L3** | Days | Date-aggregated patterns |
| **L4** | Weeks | Week-aggregated evolving patterns |
| **L5** | Profile | Long-lived persona representation |

**Structural invariants**:
- **Temporal containment**: parent interval ⊇ child interval.
- **Progressive consolidation**: |M_i| ≤ |M_{i-1}| — higher levels are strictly smaller than lower.
- **Semantic consolidation**: level-specific prompts control abstraction type (factual at L1-L2, patterns at L3-L4, persona at L5).
- **Stratified scheduling**: online consolidation at L1; scheduled consolidation at temporal boundaries (day/week rollover) for L2-L5.

**Complexity-aware recall** — 3 stages:
1. **Recall Planner**: classify query as simple / hybrid / complex; extract keywords.
2. **Hierarchical Recall**: dual-channel (semantic + lexical) scoring activates base leaves, then propagates to ancestors based on complexity class.
3. **Recall Gating**: LLM filters the candidates, orders by level + temporal proximity.

**Per-category scores (gpt-4o-mini-2024-07-18)**:

| Category | Score |
|---|---|
| Single-Session User | 95.71% |
| Knowledge Update | 86.16% |
| Single-Session Assistant | 82.14% |
| Multi-Session | 70.83% |
| Temporal Reasoning | 68.42% |
| Single-Session Preference | 63.33% |
| **Overall** | **76.88%** |

**Key result**: reduces recalled context 52.20% on LoCoMo via recall planning + gating. That is a major efficiency gain.

**Signature techniques** (top 5):
1. **5-level time hierarchy** — the only system with week-level abstraction.
2. **Progressive consolidation invariant** — enforces summarization quality gate.
3. **Complexity-aware recall** — query classification determines search depth.
4. **Recall gating** — LLM filter *after* retrieval, not before.
5. **Stratified scheduling** — online vs offline consolidation based on level.

**WOTANN port priority**: **P2**. WOTANN has `src/memory/temporal-memory.ts`, `src/memory/context-tree.ts`, `src/memory/progressive-context-loader.ts` — infrastructure for hierarchical/temporal memory exists. The TMT specifically requires week/day rollovers which most applications don't need. Borrow the **complexity-aware recall planner** (P1). Target file: `src/memory/progressive-context-loader.ts`.

**Reproducibility**: Open-source. arXiv + GitHub published. 76.88% is modest vs leaders but technique is clean.

---

### 1.9 Zep / Graphiti — 71.2% (LongMemEval, gpt-4o); 94.8% DMR (SOTA over MemGPT 93.4%) — Apache-2.0

**Identity**: [github.com/getzep/graphiti](https://github.com/getzep/graphiti), Apache-2.0. Paper: [arXiv:2501.13956](https://arxiv.org/abs/2501.13956). Commercial Zep offering on top.

**Architecture — bi-temporal knowledge graph 𝒢 = (𝒩, ℰ, φ)**:

**Dual timelines per edge**:
- **T** (reality): `t_valid`, `t_invalid` — when the fact held true in the real world.
- **T'** (ingest): `t'_created`, `t'_expired` — when the system learned/forgot.

Four timestamps per edge. This is the cleanest temporal-model in the field.

**3 hierarchical layers** (nested subgraphs):

| Layer | 𝒢 | Nodes | Edges | Purpose |
|---|---|---|---|---|
| Episode | 𝒢ₑ | Raw messages | Link to semantic | Non-lossy storage |
| Semantic | 𝒢ₛ | Entities | Facts (with bi-temporal) | Synthesized knowledge |
| Community | 𝒢ₖ | Entity clusters | Link to members | High-level domain summaries |

**Retrieval function** `f(α) = χ(ρ(φ(α))) = β`:
- **φ (search)**: three parallel methods — `φ_cos` (cosine), `φ_bm25` (Okapi BM25), `φ_bfs` (breadth-first graph traversal).
- **ρ (reranker)**: RRF or MMR or episode-mention-frequency or node-distance or cross-encoder LLM.
- **χ (constructor)**: formats nodes+edges to text with validity ranges.

**Benchmarks**:

| Benchmark | Model | Score |
|---|---|---|
| DMR | gpt-4-turbo | 94.8% (vs MemGPT 93.4%) |
| DMR | gpt-4o-mini | **98.2%** |
| LongMemEval overall (gpt-4o) | gpt-4o | 71.2% (+18.5% over full-context 60.2%) |
| LongMemEval single-session-preference | gpt-4o | 56.7% (vs full-context 20.0%, +184%) |

**Latency gain**: 28.9s → 2.58s (90% reduction). Retrieves ~1.6K tokens vs 115K full history. IQR drops 6.01s → 0.684s (consistency).

**Signature techniques** (top 5):
1. **Bi-temporal edges (t_valid, t_invalid) in T + (t'_created, t'_expired) in T'** — the canonical temporal model.
2. **3-layer subgraph (episode, semantic, community)** — mirrors psychological memory theory.
3. **Graph BFS as a retrieval signal** — φ_bfs alongside cos + bm25.
4. **Community detection for high-level summaries** — 𝒢ₖ is a Louvain-style clustering output.
5. **Non-lossy episodic store** — 𝒢ₑ keeps raw messages, 𝒢ₛ synthesizes; you can always reconstruct.

**WOTANN port priority**: **P0** for bi-temporal edges + 3-layer subgraph; **P1** for community detection. WOTANN has `src/memory/dual-timestamp.ts` (two timestamps), `src/memory/graph-rag.ts`, `src/memory/mem-palace.ts` — needs (a) **4 timestamps** per edge not 2, (b) explicit 𝒢ₑ/𝒢ₛ/𝒢ₖ layering, (c) BFS retrieval channel. Target files: `src/memory/dual-timestamp.ts` → rename to `quad-timestamp.ts` or add second pair, `src/memory/graph-rag.ts`, `src/memory/unified-knowledge.ts`.

**Reproducibility**: Apache-2.0 on Graphiti. Paper + repo. WOTANN should adopt Graphiti's bi-temporal interface directly.

---

### 1.10 MemPalace — 96.6% R@5 "raw" (=ChromaDB baseline), 84.2% AAAK, 49% BEAM QA — MIT — [github.com/MemPalace/mempalace](https://github.com/MemPalace/mempalace)

**Identity**: MIT, 48.4k stars, v3.3.1 (Apr 18, 2026), 52 contributors, 184 open issues. Launched by Milla Jovovich team in April 2026 [[danilchenko.dev](https://www.danilchenko.dev/posts/2026-04-10-mempalace-review-ai-memory-system-milla-jovovich/)].

**Architecture — palace metaphor**:
- **Wings**: people + projects
- **Rooms**: topics within wings
- **Drawers**: original verbatim content

**The actual scoring story** (from [Issue #214](https://github.com/MemPalace/mempalace/issues/214), [#39](https://github.com/MemPalace/mempalace/issues/39), [#875](https://github.com/MemPalace/mempalace/issues/875)):

| Mode | LongMemEval R@5 | BEAM QA | What runs |
|---|---|---|---|
| **raw** | **96.6%** | — | Fresh ChromaDB `EphemeralClient()` + all-MiniLM-L6-v2 embeddings. **Never touches palace code paths.** |
| aaak (compression) | 84.2% | — | -12.4pp vs raw |
| rooms (scoped) | 89.4% | — | -7.2pp vs raw |
| hybrid v4 + Haiku rerank | 100% (tuned) / 98.4% (held-out) | — | Added LLM rerank |
| raw (independent M2 Ultra verify) | 96.6% | 49% | Confirmed by [Issue #39](https://github.com/MemPalace/mempalace/issues/39) |
| aaak + rooms | — | 89.4% / 84.2% | Regresses vs raw on BEAM too |

**Verdict**: The 96.6% is real and reproducible — it's just **not MemPalace**. It's ChromaDB's default nearest-neighbor. The palace-specific modes (AAAK, rooms) *regress* vs raw. Defensible MemPalace-specific score: **49% BEAM raw QA** (the only end-to-end QA metric published).

**AAAK compression** — the README doesn't explain the algorithm; community inference is "attention-aware abstractive knowledge" style LLM compression. Whatever it is, it loses 12.4pp.

**Signature techniques WOTANN SHOULD adopt** (independent of score dispute):
1. **Wings/rooms/drawers as organizational layer** — human-readable navigation, even if not retrieval path. File: `src/memory/wings-rooms-halls.ts` already exists — keep it as *browse* UI, not retrieval path.
2. **Pluggable retrieval backend** — MemPalace's architecture lets you swap ChromaDB for any vector store. Good pattern.
3. **Honest baseline publishing** — explicitly label "raw ChromaDB" alongside your special modes so regressions are obvious.

**Signature techniques WOTANN SHOULD NOT adopt**:
- AAAK compression claimed as memory-specific. If the structure regresses vs the stock embedding, it's not an improvement.
- Marketing 96.6% as your score when the code path is stock sentence-transformers.

**WOTANN port priority**: **P3**. File already exists (`src/memory/mem-palace.ts`, `src/memory/wings-rooms-halls.ts`) — keep as organizational/browse layer, never quote its R@5 as a moat.

**Reproducibility**: High (MIT, 48.4k stars). Issue trail is a case study in benchmark integrity; WOTANN should link it in evals to avoid repeating the mistake.

---

## PART 2 — Memory-Adjacent Systems

### 2.1 Letta (formerly MemGPT) — Apache-2.0 — 22.2k stars — [github.com/letta-ai/letta](https://github.com/letta-ai/letta)

**Origin paper**: [MemGPT arXiv:2310.08560](https://arxiv.org/abs/2310.08560). OS-inspired virtual context management. Main-memory vs external-memory tiers. Tool-based memory editing (`core_memory_append`, `core_memory_replace`, `archival_memory_insert`, `archival_memory_search`, `conversation_search`). Interrupt mechanism for control flow.

**Letta (current)**: Not 8 blocks by default. The **memory-block** primitive is arbitrary text; conventional chat apps use **"human"** + **"persona"** blocks (not 8). 2000-char default limit per block. Archival memory sits in a vector DB behind the scenes.

**LongMemEval**: no published score from Letta directly.

**Signature techniques** (top 5):
1. **Tool-based self-editing of memory** — the OS model: the agent writes to its own memory via tool calls.
2. **Core vs archival split** — small always-in-context core + large searchable archive.
3. **Memory-block pattern** — named text segments pinned to context.
4. **Interrupts** — the agent can pause and yield control back to user mid-tool-loop.
5. **DMR benchmark origin** — Letta/MemGPT team created DMR, which Zep beats.

**WOTANN port priority**: **P1** — the tool-based self-editing pattern. WOTANN has `src/memory/memory-tools.ts` and the hooks framework — extend to expose memory-block tools the agent calls. Target files: `src/memory/memory-tools.ts`, `src/memory/active-memory.ts`.

---

### 2.2 Cognee — Apache-2.0 — 16.5k stars — [github.com/topoteretes/cognee](https://github.com/topoteretes/cognee)

**Architecture**: Hybrid knowledge graph + vector DB. Unified ingestion, graph/vector search, local runtime, ontology grounding, multimodal. The "14 retrieval types" marketing claim corresponds to its internal retrievers module — vector, graph, hybrid, summary, completion, document, chunks, etc.

**API**:
- `remember()` — stores data in KG
- `recall()` — queries with auto-routing to optimal search strategy
- `forget()` — removes datasets
- `improve()` — enhances existing knowledge

**LongMemEval**: no published score.

**Signature techniques** (top 5):
1. **Auto-routing in `recall()`** — query type classifier picks retriever.
2. **Ontology grounding** — knowledge graph has a type system, not free-form.
3. **Unified multimodal pipeline** — text + image + audio into same graph.
4. **Session cache + persistent graph** — 2-tier async sync.
5. **14-retriever menu** — explicit diversity of retrieval strategies.

**WOTANN port priority**: **P2**. Auto-routing is the key idea. WOTANN has `src/memory/extended-search-types.ts` — extend to carry a router.

---

### 2.3 ByteRover (formerly Cipher) — [github.com/campfirein/byterover-cli](https://github.com/campfirein/byterover-cli)

**Architecture — 3-tier memory for coding agents**:
- **System 1**: programming concepts, business logic, past interactions.
- **System 2**: reasoning steps the model uses when generating code.
- **Workspace**: team-wide shared context.

**Connectivity**: MCP. Compatible with Cursor, Windsurf, Claude Desktop, Claude Code, Gemini CLI, VS Code, Roo Code, Kimi K2, Kiro. Portability is the marketing headline: "your memory travels with you."

**Benchmark**: 92.2% retrieval accuracy (benchmark unclear — likely a Cipher-internal retrieval task, *not* LongMemEval).

**Signature techniques** (top 5):
1. **Multi-IDE memory via MCP** — single server, many clients.
2. **System 1 / System 2 split** — dual-process-theory influence; separates "what I know" from "how I reason."
3. **Workspace memory** — team-shared context with scoped access.
4. **File-based, cloud-portable** — local files + cloud sync.
5. **Version control on memory** — built-in.

**WOTANN port priority**: **P1** — the System 1 / System 2 split + MCP memory server. WOTANN has `src/memory/unified-knowledge.ts` and `src/memory/context-tree.ts` — refactor to expose a ByteRover-style tri-tier model via MCP. Target file: consider `src/memory/tri-tier.ts` or extend `src/memory/active-memory.ts`.

---

### 2.4 Anthropic Extended Context (Opus 4.6/4.7, 1M tokens GA) — [anthropic.com/claude/opus](https://www.anthropic.com/claude/opus)

**Context size**: 1M tokens GA on Opus 4.6 & Sonnet 4.6. Opus 4.7 announced Apr 2026, same 1M, up to 128K output. **No long-context premium** — 900K request billed at same per-token rate as 9K.

**Server-side compaction** in beta: auto-condense earlier conversation to fit long runs.

**MRCR v2** (Multi-hop Retrieval with Context Reasoning): Opus 4.6 scores 78.3% at 1M, highest among frontier models.

**Mailbox Protocol** (multi-agent): each agent its own 1M window, peer-to-peer messaging.

**Implications for the memory landscape**:
- "Just stuff everything into context" is now economically viable at 1M tokens.
- The LongMemEval-S workload (~115k tokens) is *trivial* — a naive full-context Opus 4.7 call handles it in one shot.
- Mastra's and Mem0's token-efficiency edge (7k vs 25k vs 115k tokens) *matters less* when the 1M ticket is cheap. The new moat is *stable prefix* (cache hits), not token count.
- The MRCR v2 78.3% at 1M says Opus 4.7 can *retrieve* needle-in-haystack at long context. Memory systems no longer need to compress for accuracy; they compress for **cost per turn** and **prompt-cache hit rate**.

**WOTANN posture**:
- Continue memory-system implementation — the cache-stability story (Mastra) still matters even at 1M.
- Add a `FullContext` mode as a baseline: Opus 4.7 at 1M with server-side compaction, no memory system. Benchmark it as the ceiling.
- The cost-per-session economics change: 115k × 60 turns × $5/M = $34.50 without cache; with Mastra-style cache hits, ~$3.50. Worth reporting in the memory system's cost spec.

---

### 2.5 LoCoMo Benchmark — [locomo.github.io](https://snap-research.github.io/locomo/)

**Identity**: Companion benchmark to LongMemEval, different shape. 300-turn / 9K-token conversations over up to 35 sessions. 5 question categories:
- Single-hop (one-session)
- Multi-hop (cross-session composition)
- Temporal (date arithmetic, event order)
- Open-domain (persona/world)
- Adversarial (unanswerable distractors)

**Metrics**: BLEU, F1, ROUGE-1/2/L, exact match, LLM-as-judge, multimodal VQA EM.

**Leaderboard snapshot**:

| System | LoCoMo |
|---|---|
| Hindsight OSS-120B | 85.67% |
| EverMemOS | 93% |
| Mem0 v3 | 91.6% |
| TiMem | 75.30% |
| MemPalace manipulated R@10 | 100% (not defensible) |

**WOTANN should run LoCoMo as a second eval alongside LongMemEval-S**. Different distributional failure modes (adversarial category especially).

---

## PART 3 — Top-20 Techniques WOTANN Must Ship in src/memory/

Ranked by (expected pp gain × implementation effort)⁻¹, clustered by file.

### Tier 1 — Do in next sprint (P0, 7-14 days)

| # | Technique | Source | File | Expected pp gain |
|---|---|---|---|---|
| 1 | **Stable-prefix Observational Memory (Observer + Reflector dyad)** | Mastra 94.87% | NEW `src/memory/observational.ts` + refactor `session-ingestion.ts` | +5-10pp + 4-10× cache savings |
| 2 | **Single-pass ADD-only extraction, agent-facts=user-facts priority** | Mem0 v3 93.4% | refactor `src/memory/conversation-miner.ts`, `src/memory/observation-extractor.ts` | +10-15pp on assistant category |
| 3 | **4-channel retrieval (semantic + BM25 + graph BFS + temporal) + RRF + cross-encoder rerank** | Hindsight TEMPR 91.4%, Zep | extend `src/memory/hybrid-retrieval-v2.ts`, `src/memory/graph-rag.ts` | +5-8pp |
| 4 | **Bi-temporal edges (t_valid, t_invalid, t'_created, t'_expired)** | Zep Graphiti | refactor `src/memory/dual-timestamp.ts` → quad timestamps | +5-10pp on temporal + knowledge-update |
| 5 | **Entity-lookup layer separate from vector index** | Mem0 v3 | extend `src/memory/entity-types.ts` | +3-5pp multi-hop |
| 6 | **Type-weighted scoring (decisions/lessons × 2)** | OMEGA 95.4% | extend `src/memory/retrieval-quality.ts` | +1-2pp |
| 7 | **Supersedes + contradicts typed edges** | OMEGA + Zep | extend `src/memory/relationship-types.ts`, `src/memory/contradiction-detector.ts` | +3-5pp knowledge-update |
| 8 | **Verb-form normalization on BM25** | Mem0 v3 | small edit to whatever BM25 impl lives in `hybrid-retrieval-v2.ts` | +1-2pp |

### Tier 2 — Do in 30-day horizon (P1)

| # | Technique | Source | File | Expected pp gain |
|---|---|---|---|---|
| 9 | **3-layer subgraph (episode / semantic / community)** | Zep | new `src/memory/three-layer-graph.ts`, extend `unified-knowledge.ts` | +2-4pp |
| 10 | **Turn-by-turn extraction with 3-turn sliding window** | RetainDB | refactor `src/memory/observation-extractor.ts` | +5pp preference |
| 11 | **Narrative chunking (2-5 facts per conversation)** | Hindsight | extend `src/memory/conversation-miner.ts` | +2-3pp multi-session |
| 12 | **4-network fact classification (world / experience / opinion / observation)** | Hindsight | extend `src/memory/entity-types.ts` | +2pp |
| 13 | **Exponential time-decay on temporal edges (weight = exp(-λ·Δt))** | Hindsight + OMEGA | extend `src/memory/freshness-decay.ts` | +2pp temporal |
| 14 | **Text-not-JSON observations with emoji priority markers (🔴🟡🟢)** | Mastra | part of observational.ts refactor | +1-2pp |
| 15 | **Agent-callable memory tools (`core_append`, `archival_search`)** | Letta/MemGPT | extend `src/memory/memory-tools.ts` | +2-3pp self-directed recall |
| 16 | **Auto-routing `recall()` by query type** | Cognee | new `src/memory/recall-router.ts` | +1-2pp |
| 17 | **System 1 / System 2 split (concepts vs reasoning steps)** | ByteRover | extend `src/memory/context-tree.ts`, `active-memory.ts` | +1-2pp |

### Tier 3 — Later / experimental (P2)

| # | Technique | Source | File | Expected pp gain |
|---|---|---|---|---|
| 18 | **3-reader agent swarm (Gemini Flash-speed extraction)** | Supermemory ASMR | new `src/memory/reader-swarm.ts` | +3-5pp (expensive per query) |
| 19 | **Answer ensembles (8-variant parallel + aggregator)** | Supermemory ASMR | part of `src/orchestration/` hook | +2-4pp (very expensive) |
| 20 | **Hypergraph hyperedges (N-ary relations)** | EverMemOS HyperMem | refactor `src/memory/graph-rag.ts` | +1-2pp |

---

## PART 4 — WOTANN Implementation Plan (Concrete)

### 4.1 Sprint structure — 14 days

**Day 1-3 — Observational Memory (Mastra)**:
- Create `src/memory/observational.ts` exporting `{ observe, reflect, getStablePrefix }`.
- Refactor `src/memory/session-ingestion.ts` to trigger `observe()` on msg-count threshold and `reflect()` on observation-count threshold.
- Add text serializer with 🔴🟡🟢 priority + 2-level bulleted list format.
- Contract: `getStablePrefix()` returns a string that only changes at reflection boundaries — wire into `src/prompt/` to expose as cached region.
- Benchmark: run `src/memory/evals/` on LongMemEval-S with gpt-4o, expect 82-86%.

**Day 4-6 — Mem0-style extraction (ADD-only + agent-facts + entity lookup)**:
- Refactor `src/memory/conversation-miner.ts` to single-pass ADD-only (guard UPDATE/DELETE paths behind a flag, off by default).
- In `src/memory/observation-extractor.ts`, remove user-vs-assistant role filter; extract both equally.
- Extend `src/memory/entity-types.ts` with an `entityIndex: Map<string, MemoryId[]>` for direct lookup.
- Add verb-form lemmatizer to whatever BM25 lives in `hybrid-retrieval-v2.ts`.
- Rerun benchmark: expect 88-92%.

**Day 7-10 — TEMPR-style 4-channel retrieval + bi-temporal edges (Hindsight + Zep)**:
- In `src/memory/hybrid-retrieval-v2.ts`:
  - Add `spread(seedNodes, hops, decayFn)` API as `graphChannel` signal.
  - Add `temporalFilter(interval)` channel for time-constrained queries.
  - Add RRF fusion: `1/(k+rᵢ)` with `k=60` default.
  - Add `ms-marco-MiniLM-L-6-v2` cross-encoder rerank stage (via ONNX).
- In `src/memory/dual-timestamp.ts`: extend to 4 timestamps `{ tValid, tInvalid, tCreated, tExpired }`.
- Update `src/memory/graph-rag.ts` edges to carry the 4-timestamp tuple.
- Benchmark: expect 90-94%.

**Day 11-14 — Validation + Writeup**:
- Run LongMemEval-S 500 questions with each model (gpt-4o, gpt-5-mini, gemini-3) via new pipeline.
- Run LoCoMo 50-conversation eval.
- Write results into `src/memory/evals/RESULTS.md` with per-category breakdown.
- Commit to repo; push after verification.

### 4.2 Files to create / modify

**Create**:
- `src/memory/observational.ts` — Observer + Reflector dyad
- `src/memory/recall-router.ts` — Cognee-style auto-routing (P1)
- `src/memory/reader-swarm.ts` — Supermemory ASMR 3-reader (P2)
- `src/memory/three-layer-graph.ts` — Zep episode/semantic/community (P1)

**Modify**:
- `src/memory/conversation-miner.ts` — ADD-only mode, agent-facts priority
- `src/memory/observation-extractor.ts` — 4-network classification
- `src/memory/entity-types.ts` — entity lookup layer
- `src/memory/hybrid-retrieval-v2.ts` — 4-channel + RRF + cross-encoder
- `src/memory/dual-timestamp.ts` → expand to quad timestamps
- `src/memory/graph-rag.ts` — add spreading activation, 4-timestamp edges
- `src/memory/relationship-types.ts` — add `supersedes` and `contradicts`
- `src/memory/contradiction-detector.ts` — wire to typed edges
- `src/memory/freshness-decay.ts` — exponential time-decay formula
- `src/memory/memory-tools.ts` — expose Letta-style tool calls for the agent
- `src/memory/retrieval-quality.ts` — type-weighted scoring
- `src/memory/session-ingestion.ts` — Observer/Reflector triggers
- `src/memory/context-tree.ts` + `src/memory/active-memory.ts` — System 1/2 split
- `src/prompt/` — mark the observation-prefix as cache-stable region

**Deprecate / label "organizational-only" (not retrieval path)**:
- `src/memory/mem-palace.ts`
- `src/memory/wings-rooms-halls.ts`

### 4.3 Benchmarks to ship

- `src/memory/evals/longmemeval.ts` — runs official `evaluate_qa.py` as subprocess + ingests `autoeval_label`.
- `src/memory/evals/locomo.ts` — runs LoCoMo eval with BLEU/F1/ROUGE/LLM-judge.
- `src/memory/evals/dmr.ts` — as a regression floor.
- `src/memory/evals/RESULTS.md` — per-category table, published with every tagged release.

### 4.4 Defensive target numbers (what to claim honestly)

| Metric | Conservative | Ambitious |
|---|---|---|
| LongMemEval-S with gpt-5-mini | **88-92%** | 94-95% |
| LongMemEval-S with gpt-4o | 80-84% | 86% |
| LoCoMo overall | 85-88% | 92% |
| DMR (sanity floor) | 94% | 98% |
| Tokens per retrieval call | 7-9k | 5k |
| Cache hit rate (prefix-stable) | 60-70% | 80%+ |

Publish held-out numbers only. Label each metric precisely (QA accuracy vs R@5 vs token F1). Don't cross-column different metrics. Run every number with 3 random seeds — min/mean/max visible. Cite MemPalace Issue #39 and #875 as the *anti-pattern* in the benchmark writeup.

---

## PART 5 — References

Every claim above traces to one of these:

- **LongMemEval paper**: [arXiv:2410.10813](https://arxiv.org/abs/2410.10813), [GitHub xiaowu0162/longmemeval](https://github.com/xiaowu0162/longmemeval), [project page](https://xiaowu0162.github.io/long-mem-eval/).
- **Mastra Observational Memory**: [mastra.ai/research/observational-memory](https://mastra.ai/research/observational-memory).
- **Mem0 v3 token-efficient blog**: [mem0.ai/blog/mem0-the-token-efficient-memory-algorithm](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm), [research](https://mem0.ai/research), [GitHub](https://github.com/mem0ai/mem0), [arXiv v2 paper 2504.19413](https://arxiv.org/html/2504.19413v1).
- **OMEGA**: [omegamax.co/benchmarks](https://omegamax.co/benchmarks), [omegamax.co](https://omegamax.co/), [GitHub omega-memory/omega-memory](https://github.com/omega-memory/omega-memory).
- **Hindsight / Vectorize**: [arXiv:2512.12818](https://arxiv.org/html/2512.12818v1), [GitHub vectorize-io/hindsight](https://github.com/vectorize-io/hindsight), [VentureBeat](https://venturebeat.com/data/with-91-accuracy-open-source-hindsight-agentic-memory-provides-20-20-vision), [TopAIProduct](https://topaiproduct.com/2026/03/14/hindsight-by-vectorize-hits-91-on-longmemeval-the-case-for-giving-ai-agents-human-like-memory/).
- **Supermemory ASMR**: [blog.supermemory.ai/we-broke-the-frontier-in-agent-memory-introducing-99-sota-memory-system/](https://blog.supermemory.ai/we-broke-the-frontier-in-agent-memory-introducing-99-sota-memory-system/), [research](https://supermemory.ai/research/), [aihola summary](https://aihola.com/article/supermemory-99-longmemeval-agentic-memory).
- **EverMemOS**: [GitHub EverMind-AI/EverOS](https://github.com/EverMind-AI/EverOS), [PR Newswire](https://www.prnewswire.com/news-releases/evermemos-redefines-efficiency-in-ai-memory-surpassing-llm-full-context-perfomances-with-far-fewer-tokens-in-open-evaluation-302645884.html), [AI Journal](https://aijourn.com/end-agentic-amnesia-evermind-launches-a-memory-platform-and-an-80000-global-competition-as-evermemos-sets-new-sota-results-across-multiple-benchmarks/), [TMTPost](https://en.tmtpost.com/post/7767347).
- **RetainDB**: [retaindb.com/benchmark](https://www.retaindb.com/benchmark), [retaindb.com](https://www.retaindb.com/).
- **TiMem**: [arXiv:2601.02845](https://arxiv.org/abs/2601.02845), [HTML](https://arxiv.org/html/2601.02845v1), [GitHub TiMEM-AI/timem](https://github.com/TiMEM-AI/timem).
- **Zep / Graphiti**: [arXiv:2501.13956 HTML](https://arxiv.org/html/2501.13956v1), [blog.getzep.com PDF](https://blog.getzep.com/content/files/2025/01/ZEP__USING_KNOWLEDGE_GRAPHS_TO_POWER_LLM_AGENT_MEMORY_2025011700.pdf), [GitHub getzep/graphiti](https://github.com/getzep/graphiti).
- **MemPalace**: [GitHub MemPalace/mempalace](https://github.com/MemPalace/mempalace), [benchmarks BENCHMARKS.md](https://github.com/milla-jovovich/mempalace/blob/main/benchmarks/BENCHMARKS.md), [Issue #214](https://github.com/milla-jovovich/mempalace/issues/214), [Issue #39](https://github.com/MemPalace/mempalace/issues/39), [Issue #875](https://github.com/MemPalace/mempalace/issues/875), [Issue #29](https://github.com/MemPalace/mempalace/issues/29), [danilchenko review](https://www.danilchenko.dev/posts/2026-04-10-mempalace-review-ai-memory-system-milla-jovovich/), [alexeyondata](https://alexeyondata.substack.com/p/an-unexpected-entry-into-ai-memory), [nicholasrhodes review](https://nicholasrhodes.substack.com/p/mempalace-ai-memory-review-benchmarks), [lhl/agentic-memory ANALYSIS](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md).
- **Letta / MemGPT**: [arXiv:2310.08560](https://arxiv.org/abs/2310.08560), [GitHub letta-ai/letta](https://github.com/letta-ai/letta), [docs.letta.com memory-blocks](https://docs.letta.com/guides/agents/memory-blocks/), [letta.com blog memory-blocks](https://www.letta.com/blog/memory-blocks).
- **Cognee**: [GitHub topoteretes/cognee](https://github.com/topoteretes/cognee).
- **ByteRover / Cipher**: [github.com/campfirein/byterover-cli](https://github.com/campfirein/byterover-cli), [docs.byterover.dev overview](https://docs.byterover.dev/cipher/overview), [byterover.dev](https://www.byterover.dev/), [Product Hunt](https://www.producthunt.com/products/byterover).
- **LoCoMo**: [snap-research.github.io/locomo/](https://snap-research.github.io/locomo/).
- **Anthropic Opus 4.6/4.7 1M**: [anthropic.com/claude/opus](https://www.anthropic.com/claude/opus), [AWS Bedrock intro](https://aws.amazon.com/blogs/aws/introducing-anthropics-claude-opus-4-7-model-in-amazon-bedrock/), [Caylent deep dive](https://caylent.com/blog/claude-opus-4-7-deep-dive-capabilities-migration-and-the-new-economics-of-long-running-agents).

---

*End of RESEARCH_LONGMEMEVAL_SYSTEMS_DEEP.md — ~6200 words.*
