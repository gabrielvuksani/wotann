# Competitor Research: Perplexity Computer, MemPalace, and LoCoMo
> Generated: 2026-04-09 | Sources: GitHub repos, web research, WOTANN codebase analysis

---

## 1. MemPalace -- Memory System Analysis

### What It Is
MemPalace is an open-source AI memory system (33,679 stars, Python) by Milla Jovovich and Ben Sigman. It achieves **96.6% R@5 on LongMemEval** in raw mode -- the highest published score on that benchmark. It runs entirely local with zero API calls, using ChromaDB for vector storage and SQLite for a temporal knowledge graph.

### Architecture: The Palace Metaphor

MemPalace organizes memories using an ancient memory palace structure with five levels:

| Level | Name | Purpose |
|-------|------|---------|
| **Wings** | People or projects | Top-level domain partitions (e.g., `wing_orion`, `wing_kai`) |
| **Rooms** | Named ideas/topics | Subdivisions within a wing (e.g., `auth-migration`, `ci-pipeline`) |
| **Halls** | Memory type corridors | Five typed corridors in each wing: `facts`, `events`, `discoveries`, `preferences`, `advice` |
| **Closets** | Summary pointers | Condensed summaries that reference verbatim content |
| **Drawers** | Verbatim originals | The exact original text, never summarized |

Cross-references are implemented through:
- **Halls**: Connect related rooms *within* a wing
- **Tunnels**: Connect rooms with the same name *across* wings (e.g., `auth-migration` appearing in both `wing_kai` and `wing_driftwood`)

### Memory Techniques

**1. Raw Verbatim Storage (96.6% recall)**
The key insight: store everything without LLM summarization. No AI decides what is "worth remembering." ChromaDB indexes the raw text, and semantic search retrieves it. This is the source of the benchmark-leading number.

**2. Hierarchical Metadata Filtering**
Tested on 22,000+ real conversation memories:
- Unfiltered search: 60.9% R@10
- Wing-only filter: 73.1% (+12%)
- Wing + hall: 84.8% (+24%)
- Wing + room: 94.8% (+34%)

The palace structure is not cosmetic -- it is a 34% retrieval improvement through metadata partitioning alone.

**3. 4-Layer Context Loading (L0-L3)**

| Layer | What | Size | When Loaded |
|-------|------|------|-------------|
| L0 | Identity | ~50 tokens | Always |
| L1 | Critical facts (team, projects) | ~120 tokens (AAAK) | Always |
| L2 | Room recall | On demand | When topic arises |
| L3 | Deep search (full ChromaDB) | Unlimited | When explicitly queried |

Wake-up cost: ~170 tokens (L0+L1). 95%+ of context window left free.

**4. Temporal Knowledge Graph (SQLite)**
Entity-relationship triples with time validity windows, modeled after Zep's Graphiti but using SQLite instead of Neo4j:
- Entities table with properties (type, created_at)
- Triples table (subject, predicate, object) with `valid_from` / `valid_to`
- Bi-temporal queries: "What was true about Maya in January?"
- Invalidation: `kg.invalidate("Kai", "works_on", "Orion", ended="2026-03-01")`

**5. Contradiction Detection (Experimental)**
`fact_checker.py` checks assertions against the knowledge graph:
- Attribution conflicts ("Soren finished auth" vs "Maya was assigned")
- Temporal errors (wrong tenure, stale dates)
- Not yet wired into the main pipeline -- acknowledged as a gap

**6. AAAK Compression (Experimental)**
A lossy abbreviation dialect using entity codes and sentence truncation. Readable by any LLM without a decoder. Current status:
- Regresses recall (84.2% vs 96.6% raw mode)
- Does not save tokens at small scale
- May help at scale with many repeated entities
- Not the storage format -- applied only at context-loading time

**7. Three Mining Modes**
- `projects`: Code and docs
- `convos`: Conversation exports (Claude, ChatGPT, Slack)
- `general`: Auto-classifies into decisions, preferences, milestones, problems, emotional context

### What WOTANN Should Adopt from MemPalace

| Technique | WOTANN Status | Recommendation | Priority |
|-----------|--------------|----------------|----------|
| **Verbatim storage with separate summaries** | WOTANN stores structured KV pairs | Add a "drawer" layer that stores raw conversation chunks alongside the existing structured blocks. Search summaries, return originals. | HIGH |
| **Hierarchical metadata filtering** | FTS5 + vector + graph but flat namespace | Implement wing/room-style domain partitioning on the existing MemoryEntry. Add `domain` and `topic` fields. Filter before search to reduce noise. 34% retrieval gain for free. | HIGH |
| **4-layer progressive context loading** | All 8 layers are conceptual, not progressive | Build an L0/L1 wake-up payload (<200 tokens) that summarizes identity + critical facts. Load deeper layers only on demand. Reduces cold-start token burn. | MEDIUM |
| **Temporal knowledge graph with validity windows** | graph-rag.ts has entities and relationships but NO time validity | Add `valid_from` / `valid_to` to the Relationship type in graph-rag.ts. Enable "what was true at time T" queries. MemPalace's implementation is only ~200 lines of SQLite. | HIGH |
| **Conversation mining** | No conversation import pipeline | Build a `mine` command that ingests past conversation exports (Claude sessions, Slack, etc.) into the memory store. This is how MemPalace populates its palace. | MEDIUM |
| **Tunnel cross-references** | Graph-RAG has relationships but no cross-domain linking | Implement automatic tunnel detection: when the same topic appears in multiple domains, create a cross-reference. Enables "what did everyone say about auth?" | LOW |

---

## 2. LoCoMo -- Long-Term Conversational Memory Benchmark

### What It Is
LoCoMo (ACL 2024, Snap Research, 741 stars) is a benchmark for evaluating very long-term conversational memory of LLM agents. It provides 10 conversations spanning up to 35 sessions, 300 turns, and 9K tokens per conversation, with human annotations for QA, event summarization, and multi-modal dialogue.

### Evaluation Categories

Five question types, each testing a different memory capability:

| Category | What It Tests | Example |
|----------|--------------|---------|
| **Single-hop** | Simple recall within one session | "What is Angela's job?" |
| **Multi-hop** | Cross-session reasoning | "What event led Angela to change her painting style?" |
| **Temporal** | Date/order/interval inference | "When did they first discuss the gallery?" |
| **Open-domain** | World knowledge + conversation context | Combining external facts with remembered context |
| **Adversarial** | Unanswerable detection | Questions about things never discussed |

### Key Findings

1. **RAG with observations outperforms RAG with raw dialogues.** When conversations are pre-processed into structured observations (assertions about each speaker's life and persona), retrieval quality improves significantly.

2. **Long-context LLMs + RAG improve memory by 22-66%** over base models, but remain **56% behind human performance**.

3. **Temporal reasoning is the weakest category** -- 73% gap to human performance. Models struggle with "when", "how long ago", and "in what order" questions.

4. **Long-context models hallucinate on adversarial questions.** Having more context actually hurts: models confidently answer unanswerable questions because they find spurious pattern matches in the large context.

5. **RAG offers the best compromise** -- combining the accuracy of short-context LLMs with the comprehension of wide-context models. Observation-based databases work best as the RAG source.

### RAG Database Comparison

| Database Type | Approach | Effectiveness |
|---------------|----------|---------------|
| **Raw dialogues** | Store and retrieve conversation turns | Baseline |
| **Session summaries** | GPT-3.5-turbo generates per-session summaries | Better than raw for single-hop |
| **Observations** | Structured assertions about each speaker | Best overall, especially for multi-hop |

### What WOTANN Should Adopt from LoCoMo

| Technique | WOTANN Status | Recommendation | Priority |
|-----------|--------------|----------------|----------|
| **Observation extraction** | Auto-capture stores raw tool calls but does not extract structured observations | Add a post-conversation observation extraction pass (during autoDream or heartbeat) that generates assertions like "user prefers Postgres for projects >10GB" from raw session data. | HIGH |
| **Temporal reasoning primitives** | temporal-memory.ts has time queries but no temporal QA capabilities | Build temporal reasoning into search: "before/after X", "how long since Y", "in what order did Z happen". LoCoMo proves this is the weakest area for all systems. | HIGH |
| **Adversarial detection** | No unanswerable detection | Add a confidence threshold that detects when a memory search returns results that are semantically similar but not actually relevant. Prevents hallucination from spurious matches. | MEDIUM |
| **Multi-hop reasoning over episodes** | episodic-memory.ts stores full episodes but does not chain them | Build cross-episode reasoning: "Last time we touched auth, what went wrong? And before that?" Requires episode linking, which is absent today. | MEDIUM |
| **Evaluation harness** | No memory quality benchmarks | Implement a subset of LoCoMo's question types as regression tests for the memory system. Run after changes to verify recall quality. | LOW |

---

## 3. Perplexity Computer -- Competitive Analysis

### What It Is
Perplexity Computer is a cloud-based autonomous AI agent launched February 25, 2026. It coordinates 19 AI models to complete complex, multi-step workflows entirely in the background. Available to Perplexity Max subscribers at $200/month (10,000 credits). Enterprise tier at $325/seat/month.

On March 11, 2026, Perplexity announced **Personal Computer** -- a Mac Mini-based variant that gives the agent persistent access to local files, apps, and sessions via always-on hardware.

### Architecture

**Cloud Computer:**
- Tasks execute in an **isolated cloud environment** with a real filesystem, browser, and 400+ app integrations
- Tasks are split across **two VMs** for security isolation
- Five-stage execution flow: Goal Input -> Task Decomposition -> Model Selection -> Parallel Execution -> Continuous Optimization
- Sub-agents run simultaneously, not sequentially
- Seven search types run in parallel: web, academic, people, image, video, shopping, social

**Personal Computer (Mac Mini):**
- Always-on Mac Mini running Perplexity's software
- Hybrid architecture: local file/app access + cloud AI processing
- `confirm_action` tool: mandatory approval step before emails, purchases, deletions
- Full audit trail per session
- Kill switch for emergency stop
- Controllable from any device

### The 19 Models

| Model | Role |
|-------|------|
| Claude Opus 4.6 | Core reasoning engine, software engineering |
| Gemini | Deep research, visual analysis |
| GPT-5.2 | Long-context document processing |
| Grok | Lightweight, fast operations |
| Nano Banana | Image generation |
| Veo 3.1 | Video production |
| 13 others | Undisclosed; task-specific routing |

### Skills System
- **Format**: Markdown-based instruction sets (SKILLS.MD)
- **Trigger**: Auto-loaded based on task type detection
- **Types**: Personal custom skills + Perplexity-provided generic skills
- **Behavior**: Reusable workflow specifications that tell Computer how to handle specific task types
- **Combination**: Multiple skills can be combined for complex projects

### App Integrations
400+ connectors including:
- Productivity: Slack, Gmail, Notion, Google Docs
- Developer: GitHub (code push, repo management)
- Data: Snowflake, Salesforce, HubSpot
- Finance: 40+ live tools from SEC filings, FactSet, Coinbase, Quartr
- Media: Image generation, video production

### Real-World Performance

**Strengths:**
- Multi-model orchestration routes subtasks to best-suited model
- Long-running tasks execute asynchronously without user babysitting
- Research-heavy workflows completed in 1-2 hours of automated work
- In one internal test, enterprise version "completed 3.25 years of work in four weeks"

**Weaknesses:**
- Connector stability varies; some integrations behave inconsistently
- Output quality uneven for tasks requiring precise numerical accuracy
- "Confident-sounding errors in detailed factual content" require verification
- Workflows that work one day can produce degraded results the next
- Vague goals produce vague results -- requires structured input
- $200/month requires 3+ complex workflows weekly to justify

### Pricing

| Tier | Price | Credits | Key Features |
|------|-------|---------|--------------|
| Max | $200/mo | 10,000/mo | Full Computer access, 19 models |
| Enterprise | $325/seat/mo | Higher limits | Audit logs, security controls, SSO |

---

## 4. Feature Comparison: Perplexity Computer vs. WOTANN

| Capability | Perplexity Computer | WOTANN | WOTANN Advantage |
|------------|-------------------|--------|------------------|
| **Architecture** | Cloud-only (+ Mac Mini local option) | Local-first with provider routing | Privacy, offline capability, no cloud dependency |
| **Model Support** | 19 proprietary models, no user choice | 11 providers, user-configurable, free-tier via Ollama | User control, cost flexibility, no vendor lock-in |
| **Computer Use** | Cloud VM with browser + filesystem | 4-layer local desktop control (API, accessibility, text-mediated, vision) | Full local desktop access, not sandboxed |
| **Agent System** | Sub-agents for task decomposition | PWR + Ralph + graph DSL + self-healing | Deeper autonomy with checkpoint/retry/degrade |
| **Memory** | None explicitly documented | 8-layer architecture: SQLite+FTS5, vector store, graph RAG, contradiction detection, temporal decay | WOTANN's memory system is far more sophisticated |
| **Skills** | Markdown-based, auto-loaded | 65+ skills, progressive disclosure, hook-triggered | Larger library, more granular triggers |
| **Search** | 7 types in parallel (web, academic, etc.) | Grep + glob + web search + provider search | Perplexity's parallel multi-type search is stronger |
| **Pricing** | $200-325/mo | Free with own API keys (or free-tier via Ollama) | WOTANN is free-tier first-class |
| **Security** | Dual VM isolation, confirm_action, audit trail | Sandbox with risk classification, permission resolution, anti-distillation | Comparable, different threat models |
| **App Integration** | 400+ connectors | MCP registry + channel adapters (Telegram, Discord, Slack, WhatsApp) | Perplexity has more breadth; WOTANN has MCP extensibility |
| **Voice** | Not documented | Push-to-talk, STT/TTS detection | WOTANN has voice; Perplexity does not |
| **Mobile** | Not documented | iOS companion (Dispatch), Apple Watch, Live Activities | Unique WOTANN differentiator |
| **Always-on** | Mac Mini + cloud (Personal Computer) | Engine daemon with heartbeat and cron | Comparable always-on capability |
| **Cost Tracking** | Credit-based (opaque) | Cost preview before execution, per-request tracking | WOTANN is transparent about costs |
| **Verification** | Self-corrects during execution | TTSR + forced verification + frustration detection | WOTANN verifies proactively, not just reactively |
| **Middleware** | Model routing only | 16-layer pipeline (thread isolation, @file injection, guardrails, etc.) | WOTANN processes every request through a richer pipeline |

---

## 5. Memory Technique Comparison: MemPalace/LoCoMo vs. WOTANN

| Technique | MemPalace | LoCoMo (Research) | WOTANN (Current) | Gap |
|-----------|-----------|-------------------|-------------------|-----|
| **Storage** | Raw verbatim in ChromaDB | Raw dialogues + observations + summaries tested | Structured KV pairs in SQLite + FTS5 | WOTANN lacks verbatim storage mode |
| **Vector Search** | ChromaDB semantic search | Tested various embeddings | TF-IDF bag-of-words + cosine similarity | WOTANN uses lightweight TF-IDF; could upgrade to real embeddings |
| **Knowledge Graph** | SQLite temporal triples (valid_from/valid_to) | Not tested | In-memory graph with entities + relationships (no time validity) | WOTANN lacks temporal validity on graph edges |
| **Metadata Filtering** | Wing/room/hall hierarchy (+34% retrieval) | Not tested | Flat namespace with layer/block type | WOTANN should add domain/topic partitioning |
| **Contradiction Detection** | fact_checker.py (not wired in) | Not tested | contradiction-detector.ts (wired into memory-tools) | WOTANN is ahead here |
| **Temporal Decay** | Not implemented | Temporal reasoning is weakest category | freshness-decay.ts with 30/90-day half-life | WOTANN is ahead here |
| **Observation Extraction** | Mining pipeline (convos, projects, general) | GPT-3.5 generates observations; best RAG database | Auto-capture of tool calls (raw, not structured) | WOTANN should add structured observation extraction |
| **Progressive Loading** | L0-L3 (170 tokens wake-up) | Not tested | 8 conceptual layers, all loaded equally | WOTANN should implement progressive loading |
| **Episodic Memory** | Not implemented | Event summarization tested | episodic-memory.ts with full task narratives | WOTANN is ahead here |
| **Proactive Memory** | Not implemented | Not tested | proactive-memory.ts with trigger-based hints | WOTANN is ahead here |
| **Cross-Domain Linking** | Tunnels between wings | Not tested | Graph relationships (no automatic cross-domain) | WOTANN should add automatic tunnel detection |
| **Hybrid Search** | ChromaDB only | Tested RAG with different databases | RRF fusion: FTS5 + vector + temporal + frequency | WOTANN is ahead with 4-signal fusion |
| **Provenance Tracking** | Source file metadata on drawers | Not tested | Full provenance (source type, session, verification) | WOTANN is ahead here |
| **Skeptical Recall** | Not implemented | Adversarial category shows hallucination risk | Verification status on entries (verified/stale/unverified/conflicting) | WOTANN is ahead here |

---

## 6. Specific Implementation Recommendations

### HIGH PRIORITY (Adopt Now)

**R1. Domain-Partitioned Search (from MemPalace)**
Add `domain` (wing equivalent) and `topic` (room equivalent) fields to `MemoryEntry` in `store.ts`. When searching, filter by domain/topic before running FTS5/vector search. MemPalace demonstrated a 34% retrieval improvement from this alone.
- Files to modify: `src/memory/store.ts`, `src/memory/memory-tools.ts`
- Effort: ~100 lines

**R2. Temporal Validity on Knowledge Graph Edges (from MemPalace)**
Add `valid_from` and `valid_to` fields to the `Relationship` interface in `graph-rag.ts`. Enable queries like "what relationships were active on date X?" and invalidation of outdated facts. MemPalace's implementation is roughly 200 lines of SQLite.
- Files to modify: `src/memory/graph-rag.ts`
- Effort: ~150 lines

**R3. Observation Extraction Pipeline (from LoCoMo)**
After each session or during autoDream, extract structured observations from raw auto-capture data. LoCoMo proved that observation-based RAG outperforms raw dialogue RAG. Generate assertions like "user prefers X for Y" and "decided Z because of W".
- Files to modify: `src/memory/proactive-memory.ts` or new `src/memory/observation-extractor.ts`
- Effort: ~200 lines + LLM call for extraction

**R4. Temporal QA Primitives (from LoCoMo)**
LoCoMo identifies temporal reasoning as the weakest category across all systems (73% gap to humans). Extend `temporal-memory.ts` with:
- "Before/after event X" queries
- "How long since Y" calculations
- "In what order did events Z happen" ordering
- Duration and interval inference
- Files to modify: `src/memory/temporal-memory.ts`
- Effort: ~150 lines

### MEDIUM PRIORITY (Next Sprint)

**R5. Progressive Context Loading (from MemPalace)**
Build an L0/L1 wake-up payload (<200 tokens) that loads on session start. L0 is identity (from persona/soul system). L1 is the top 10-15 critical facts from the memory store. Deeper layers load on demand. MemPalace's context cost is $10/year vs $507/year for full-context approaches.
- New file: `src/memory/context-loader.ts`
- Effort: ~200 lines

**R6. Verbatim Storage Layer (from MemPalace)**
Add a "drawer" storage mode that keeps raw conversation chunks alongside the existing structured blocks. Search against summaries/observations but return verbatim originals. This is how MemPalace achieves 96.6% recall.
- Files to modify: `src/memory/store.ts`
- Effort: ~100 lines

**R7. Adversarial Detection / Confidence Gating (from LoCoMo)**
Add a confidence threshold to memory search that detects when results are semantically similar but topically irrelevant. Prevents the "hallucination from large context" problem that LoCoMo documents. Flag low-confidence results as "uncertain" rather than presenting them as authoritative.
- Files to modify: `src/memory/memory-tools.ts`, `src/memory/vector-store.ts`
- Effort: ~80 lines

**R8. Cross-Episode Reasoning (from LoCoMo)**
Enable multi-hop queries across episodes: "What patterns repeat in auth-related tasks?" Requires linking episodes by topic and enabling traversal across the episode graph.
- Files to modify: `src/memory/episodic-memory.ts`
- Effort: ~150 lines

### LOW PRIORITY (Backlog)

**R9. Conversation Mining Command**
Build a `wotann mine` command that ingests past conversation exports (Claude sessions, Slack, etc.) into the memory store, similar to MemPalace's mining pipeline.

**R10. Automatic Tunnel Detection**
When the same topic appears in multiple domains, automatically create cross-references (MemPalace's "tunnels"). This enables "what did everyone say about X?" queries.

**R11. Memory Quality Benchmark**
Implement a subset of LoCoMo's question types (single-hop, multi-hop, temporal, adversarial) as regression tests for the memory system.

---

## 7. What Perplexity Computer Does That WOTANN Should Consider

| Perplexity Feature | WOTANN Consideration | Verdict |
|--------------------|---------------------|---------|
| **Parallel multi-type search** (web, academic, image, video, social, shopping all at once) | WOTANN searches sequentially | Consider parallel search dispatch; fits naturally into the orchestration layer |
| **400+ app connectors** | WOTANN has MCP + channel adapters | MCP extensibility is the right model; don't build 400 connectors, enable the ecosystem |
| **Dual VM security isolation** | WOTANN uses single-process sandbox | Not needed for local-first architecture where the user owns the machine |
| **Credit-based metering** | WOTANN has cost preview + tracking | WOTANN's approach (predict before execute) is superior to opaque credit systems |
| **Mac Mini always-on device** | WOTANN has daemon + heartbeat | Similar concept already in the architecture |

### What WOTANN Does That Perplexity Cannot

1. **Local-first privacy**: All data stays on the user's machine
2. **Free-tier via Ollama**: No $200/month minimum
3. **Provider choice**: User picks any model, not locked to 19 predetermined ones
4. **Full desktop control**: 4-layer CU controls the actual desktop, not a sandboxed VM
5. **Verification pipeline**: TTSR + forced verification catches errors before they propagate
6. **Mobile companion**: iOS + Watch + Live Activities for remote triage
7. **8-layer memory**: Perplexity has no documented memory system at all
8. **Self-healing**: Checkpoint + retry + model degradation on failure

---

## Sources

- [MemPalace GitHub](https://github.com/milla-jovovich/mempalace) -- 33,679 stars, Python, ChromaDB + SQLite
- [LoCoMo GitHub](https://github.com/snap-research/LoCoMo) -- 741 stars, ACL 2024
- [LoCoMo Paper (ACL 2024)](https://aclanthology.org/2024.acl-long.747/) -- Maharana et al.
- [LoCoMo Project Page](https://snap-research.github.io/locomo/)
- [Introducing Perplexity Computer](https://www.perplexity.ai/hub/blog/introducing-perplexity-computer) -- Official blog
- [Perplexity Computer: The 2026 AI Agent Explained](https://www.buildfastwithai.com/blogs/what-is-perplexity-computer)
- [Perplexity Computer Review: Should You Pay $200/month?](https://www.lowcode.agency/blog/perplexity-computer-review)
- [Perplexity Computer Review and Examples](https://karozieminski.substack.com/p/perplexity-computer-review-examples-guide)
- [Perplexity Skills.MD Support](https://www.testingcatalog.com/perplexity-rolling-out-skills-support-for-perplexity-computer/)
- [Perplexity Personal Computer (9to5Mac)](https://9to5mac.com/2026/03/11/perplexitys-personal-computer-is-a-cloud-based-ai-agent-running-on-mac-mini/)
- [Perplexity Computer (TechCrunch)](https://techcrunch.com/2026/02/27/perplexitys-new-computer-is-another-bet-that-users-need-many-ai-models/)
- [Perplexity Computer Enterprise Results (PYMNTS)](https://www.pymnts.com/news/artificial-intelligence/2026/perplexity-computer-enterprise-completed-3-years-work-4-weeks/)
- WOTANN source: `src/memory/` (17 files, ~210KB)
