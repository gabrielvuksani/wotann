# CAPABILITY_ADAPTATION_MATRIX.md — WOTANN Universal Capability

**Generated**: 2026-04-19 by the Capability Adaptation Matrix agent (Opus 4.7 max effort, 63,999 thinking tokens).
**Core invariant**: **Every WOTANN feature works with every model** — natively when the model supports it, via intelligent fallback when it does not. WOTANN amplifies, never degrades, model capability (CLAUDE.md §"Maximum Model Power").
**Inspiration**: OpenClaw's Gemini-screenshot-parse + Claude-fallback dual-model pattern, Goose's 70+ extensions and 3,000+ MCP tools as capability adaptors, Claude Code's accessibility tree mode, Codex's ReAct emulation for non-tool models.

---

## 0. How to Read This Document

- **§1** — The 18 × 6 matrix (one cell per capability × tier). Every cell filled.
- **§2** — Fallback-strategy section per capability (how WOTANN should implement).
- **§3** — Gap-priority list (which cells to fix first).
- **§4** — Port priority per gap (which competitor's pattern to steal).
- **§5** — Integration proposal into `src/providers/capability-augmenter.ts`.
- **§6** — Existing WOTANN infrastructure reference map (what's already built).

### Cell legend

| Glyph | Meaning |
|---|---|
| `N` | **Native** — the model supports this capability at the API level. |
| `P` | **Partial** — supported under constraints (smaller budget, slower, quality degraded). |
| `E` | **Emulated** — WOTANN provides it via a fallback strategy (prompt injection, external service, local pipeline). |
| `—` | **Unavailable, no WOTANN fallback wired yet** — GAP to close. |
| `F` | **Fabricated (forbidden)** — NEVER generate fake content pretending to be a native capability. Must return honest `[unavailable]` marker instead. |

### Tier definitions

| Tier | Example models (2026-04) | Characteristics |
|---|---|---|
| **Frontier-vision** | Claude Opus 4.7, GPT-5.4, Gemini 3.1 Pro | 1M+ ctx, native vision, tool-calls, thinking, prompt-cache, computer-use |
| **Small-vision** | Claude Haiku 4.5, GPT-5.4-mini, Gemini 3 Flash | Vision yes, context 128k-400k, faster/cheaper, tool-calls yes |
| **Text-only-large** | GPT-5.4-text, Sonnet 4.6-text, DeepSeek V4, Grok-3 | ≥128k ctx, native tool-calls, no vision, sometimes thinking |
| **Text-only-small** | Llama 3.3 8B, Qwen 3.5, Mistral Small | ≤32k ctx, no native tool-calls, no vision |
| **Local-Ollama** | Gemma 4 (bundled), Llama 3.3, Mixtral | Runs on-device; varies per model but generally 32k-128k ctx, tool-calls partial |
| **Free-tier** | Groq Llama, Cerebras, Gemini 3 free | Same underlying model as paid, rate limits lower, some features disabled |

---

## 1. The Capability × Model-Tier Matrix

Each cell shows **native support** / **WOTANN fallback**. "—" means a gap we must close.

| # | Capability                | Frontier-vision         | Small-vision            | Text-only-large         | Text-only-small         | Local-Ollama            | Free-tier-only          |
|---|---------------------------|-------------------------|-------------------------|-------------------------|-------------------------|-------------------------|-------------------------|
| 1 | **computer-use** (GUI)    | N (Claude/GPT-5.4)      | P / SoM                 | E / a11y-tree           | E / a11y-tree + index   | E / a11y-tree           | E / a11y-tree           |
| 2 | **vision** (screen/image) | N                       | N                       | E / OCR+structural      | E / OCR only            | E / Gemini 3 sidecar    | E / Gemini 3 free OCR   |
| 3 | **long-context** (>200k)  | N (1M Claude/GPT/Gem)   | P (128-400k)            | P (128k) / chunk+RAG    | E / chunk+RAG           | E / chunk+KV-compress   | E / chunk+RAG           |
| 4 | **tool-calls** (native fn)| N                       | N                       | N (mostly)              | E / ReAct + XML parse   | E / 11-family parsers   | N/E mixed               |
| 5 | **structured output (JSON)**| N                     | N                       | N                       | E / post-parse + regex  | E / grammar-constrained | E / post-parse          |
| 6 | **streaming**             | N                       | N                       | N                       | N (most)                | N (Ollama SSE)          | N                       |
| 7 | **prompt-caching**        | N (Anthropic/GPT)       | N                       | P (GPT) / — Claude-lite | E / local LRU prefix    | E / local LRU           | E / local LRU warm      |
| 8 | **multi-turn** (stateful) | N                       | N                       | N                       | E / replay              | E / replay              | E / replay              |
| 9 | **voice** (STT/TTS)       | P (GPT Realtime)        | E / transcribe→text     | E / transcribe→text     | E / transcribe→text     | E / whisper-local+piper | E / Web Speech API      |
| 10| **OCR**                   | N (vision)              | N                       | E / macOS Vision+Tess   | E / Tesseract           | E / Tesseract           | E / macOS Vision+Tess   |
| 11| **image-generation**      | P (GPT-image / Imagen)  | E / route→DALL-E        | E / route→DALL-E/SD     | E / route→SD-free       | E / route→SD or Ollama  | E / route→SD-free       |
| 12| **video-generation**      | — (most) / Veo, Sora    | E / route→Veo/Runway    | E / route→Veo/Runway    | E / route→free Veo      | E / route→free Veo      | E / route→free Veo      |
| 13| **code-execution**        | N (GPT/Gemini/Mistral)  | P                       | P (GPT) / — Claude-text | E / local sandbox       | E / local sandbox       | E / local sandbox       |
| 14| **web-browsing**          | N (Anthropic/GPT/Grok)  | P / some native         | P / some native         | E / tool: fetch+parse   | E / tool: fetch+parse   | E / Lightpanda + MCP    |
| 15| **shell-exec**            | E (tool)                | E (tool)                | E (tool)                | E (tool)                | E (tool)                | E (tool)                |
| 16| **file-system access**    | E (tool)                | E (tool)                | E (tool)                | E (tool)                | E (tool)                | E (tool)                |
| 17| **embedding** (vector)    | P (Voyage/OpenAI sep.)  | P / OpenAI embeddings   | P / OpenAI embeddings   | E / MiniLM local        | N (Ollama embed models) | E / MiniLM / Gemini emb |
| 18| **reranking**             | E / LLM-as-reranker     | E / LLM-as-reranker     | E / LLM-as-reranker     | E / MiniLM cross-enc    | E / bge-reranker local  | E / Cohere rerank free  |

### Dense cell annotations (top 12 capabilities, per-tier)

#### Row 1 — computer-use (GUI control)

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Yes** (Claude Opus 4.7, GPT-5.4 via Operator). Native `computer_use` tool accepts screenshot + coordinate actions. | Direct pass-through; perception-adapter returns raw screenshot + coord mode. | None. | — | 0 |
| Small-vision | **Partial**. Haiku/Flash can "see" but coordinate accuracy drops. WOTANN already has Set-of-Mark in `perception-adapter.ts`. | Set-of-Mark (numbered overlays) + element index list, model answers with indices. | **SoM overlay not yet rendered** — `generateSetOfMark()` currently returns raw screenshot. | Port `sharp`-based label overlay from Claude Code's accessibility tools. | 4h |
| Text-only-large | **No** (text-only can't see pixels). | Accessibility tree + spatial text description (`adaptForTextOnly`), model answers with element index + semantic ref. | Accessibility tree collection is macOS-heavy in `platform-bindings.ts`; Linux/Windows have stubs. | Port Goose's cross-platform a11y wrapper (AX API macOS / AT-SPI Linux / UIA Windows). | 2d |
| Text-only-small | **No**. Same as above plus pruning: `ELEMENT_BUDGET_TIERS` already caps at 30/15 for 8k/<8k context. | Aggressive pruning to <30 elements + focused/interactive score boost (already implemented in `perception-adapter.pruneElements`). | Small models tend to drift on index references; need a "confirm-before-click" safety loop. | Port OpenClaw's `peekaboo see --annotate` pre-click verify pattern. | 1d |
| Local-Ollama | **No**. Gemma 4 bundled has no vision by default (mmproj optional). | Same as text-only — a11y tree. | Gemma 4's 32k context limits element budget. | — (already handled by tier budgets). | 0 |
| Free-tier | **No**. Gemini 3 Flash free has vision; Groq/Cerebras do not. | Mixed — Gemini routes through small-vision path; Groq routes through text-only path. | Need a per-query router hop that sends the screenshot to Gemini 3 free for parsing, then ships parsed elements to Groq for action — the OpenClaw dual-model pattern. | Port the OpenClaw vision-parse + non-vision-reason split: Gemini parses, Groq reasons. | 3d |

#### Row 2 — vision (screen/image understanding)

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Yes** (all three). | Direct base64-or-URL pass to provider adapter. | None. | — | 0 |
| Small-vision | **Yes**. Haiku 4.5, GPT-5.4-mini, Gemini 3 Flash all accept images. | Same as frontier — pass-through. | None for still images. Video is frontier-only. | — | 0 |
| Text-only-large | **No**. `capability-augmenter.augmentVision` replaces `[image:...]` markers with real OCR (macOS Vision or Tesseract via `vision-ocr.ts`). | OCR transcription as in-prompt text block; honest `[OCR unavailable]` marker when no backend. | **Structural context missing**: OCR text alone loses layout, images, charts. | Port the "vision-sidecar" pattern from OpenClaw (peekaboo `see --analyze` returns structured JSON of elements + roles + hierarchy, not just raw OCR). | 2d |
| Text-only-small | **No**. Same as above but smaller context budget: only keep top 30 OCR lines. | OCR with line-budget pruning. | Line-budget pruning not implemented — full OCR ship always. | Simple line-count-aware truncator + focus-region detection. | 4h |
| Local-Ollama | **No** (most; LLaVa/Gemma-vision variants exist if user pulls the mmproj). | Offline OCR (Tesseract) + optional Gemma-vision sidecar when mmproj available. | mmproj auto-detection stub in Goose's `local_model_registry.rs` — not yet in WOTANN. | Port Goose's `FeaturedModel.mmproj` detection + auto-download. | 1.5d |
| Free-tier | **Yes** (Gemini 3 free has vision). For Groq/Cerebras: no. | Router hops to Gemini 3 free for image understanding, then ships the text summary to the user's chosen free model for follow-up reasoning. | **The OpenClaw dual-model hop is the single biggest free-tier fix.** The current `fallback-chain.ts` treats Gemini as a "free provider" but doesn't split by capability need. | Port OpenClaw's capability-aware routing: per-query, select the cheapest-capable provider per capability slot (vision → Gemini free; reasoning → Groq free). | 3d |

#### Row 3 — long-context (>200k tokens)

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Yes** (1M ctx: Claude Opus 4.7 / GPT-5.4 / Gemini 3.1 Pro). | Pass full context. `context/virtual-context.ts` + `maximizer.ts` already prep this. | None. | — | 0 |
| Small-vision | **Partial** (128k–400k). Haiku 4.5 = 200k; Flash = 1M. | If >200k needed on Haiku, trigger chunk-and-retrieve via `context/tiered-loader.ts`. | `tiered-loader` has 3 tiers; needs a 4th for "sentence-level" at ultra-small. | Extend tier configuration. | 6h |
| Text-only-large | **Partial** (128k typical). DeepSeek V4 = 128k. | Map-reduce or RAG via `memory/` FTS5 + optional MiniLM embeddings (S4 wired). | RAG recall from `memory-lancedb` extension: Goose's pattern. Currently WOTANN uses in-process FTS5 only. | Port Goose's `memory-lancedb` crate for durable vector store. | 4d |
| Text-only-small | **No** (8k–32k). | Aggressive chunking: 4k chunks, sliding window, query-focused retrieval (top-k=5). | `context-sharding.ts` exists but not wired to query-focused retrieval. | Port Claude Code's "smart context" chunker (priority = recent + referenced + high-importance). | 2d |
| Local-Ollama | **Degraded**. Gemma 4 = 128k on-device but KV memory explodes. | `providers/ollama-adapter.ts` sets `ollamaParams.numCtx + kvCacheType + flashAttention` — TurboQuant KV compression. | Already built and shipping. | — | 0 |
| Free-tier | **Partial**. Gemini 3 free has 1M; Groq = 128k; Cerebras = 128k. | Route long-ctx queries to Gemini 3 free; else chunk. | Router doesn't currently consider free-tier context limits per query. | Add `routeByContextLen(prompt, tier)` to `model-router.ts`. | 1d |

#### Row 4 — tool-calls (native function calling)

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Yes**. All three. | `anthropic-adapter.ts` / OpenAI / Gemini native path. Parallel tool calls supported. | None. | — | 0 |
| Small-vision | **Yes**. | Same. | None. | — | 0 |
| Text-only-large | **Yes** (mostly). DeepSeek V4, Sonnet 4.6 text, Mistral Large all have native tool-calls. | Native. | None. | — | 0 |
| Text-only-small | **No** (Llama 3.3 8B native tool-call is unreliable; Qwen 3.5 has quirks). | `capability-augmenter.augmentToolCalling` injects XML tool defs; `tool-parsers/parsers.ts` has **11 model-family parsers** (Hermes/Mistral/Llama/Qwen/DeepSeek/Functionary/Jamba/Command-R/ToolBench/Glaive/ReAct). | None — this is a flagship WOTANN feature. | — | 0 |
| Local-Ollama | **Partial** (depends on model template). `FeaturedModel.native_tool_calling` bit set per-model. | If native: pass-through. Else: XML injection path above. | Auto-detection of `native_tool_calling` bit from Ollama Modelfile — Goose pattern not yet ported. | Port Goose's `local_model_registry.rs::FEATURED_MODELS` table → WOTANN equivalent. | 1.5d |
| Free-tier | **Mixed**. Groq Llama = no native; Cerebras Llama = no; Gemini 3 free = yes. | Route to Gemini when tool-heavy; else XML path. | Same as §3 free-tier — capability-aware router. | Shared with §3. | 0 (included above) |

#### Row 5 — structured output (JSON mode)

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Yes** (`response_format: {"type": "json_object"}` on GPT; Gemini has `responseSchema`; Anthropic via prompt + extraction). | Native where available; post-parse + retry otherwise. | Anthropic's emulation is in `capability-equalizer.ts` as `"emulated"`. | — | 0 |
| Small-vision | **Yes**. | Same. | None. | — | 0 |
| Text-only-large | **Yes**. | Same. | None. | — | 0 |
| Text-only-small | **No** (unreliable even with system prompt). | Post-parse extraction (regex balance-brace finder) + 2x retry + one-shot fewshot example injection. | **No grammar-constrained generation yet.** Ollama supports `format: json` (the llama.cpp grammar), but this is not threaded through `ollama-adapter.ts`. | Wire `format: "json"` in `ollama-adapter.ts` + add generic post-parse fallback. | 1d |
| Local-Ollama | **Emulated** (Ollama grammar mode). | Pass `format: "json"` to llama.cpp. | Same as above. | Shared with §5 above. | 0 |
| Free-tier | **Mixed**. Groq natively supports `response_format` on some Llama variants; Cerebras varies. | Native if supported, else post-parse. | Need per-provider `responseFormatSupported` bit in `capability-equalizer` profiles — currently only OpenAI/Gemini/Mistral declare `"native"`. | Add bits for Groq/Cerebras/Sambanova. | 2h |

#### Row 6 — streaming

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Yes**. | Native SSE. | None. | — | 0 |
| Small-vision | **Yes**. | Native. | None. | — | 0 |
| Text-only-large | **Yes**. | Native. | None. | — | 0 |
| Text-only-small | **Yes** (Llama via Groq/Ollama). | Native SSE on Ollama. | None. | — | 0 |
| Local-Ollama | **Yes**. | Native. | None. | — | 0 |
| Free-tier | **Yes**. | Native. | None. | — | 0 |
| **Chunked replay fallback** | For providers that break streaming (cost, rate limiting, batch mode): buffer full response, replay as fake SSE at natural token pace. | Not yet built. | Synthetic chunk replay for UX parity when a provider's SSE is down. | Port Claude Code's "paced replay" pattern — slice response on whitespace, emit at ~40 tokens/s. | 1d |

#### Row 7 — prompt-caching

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Yes** (Anthropic `cache_control: ephemeral`, OpenAI automatic, Gemini context caching). | `providers/prompt-cache-warmup.ts` annotates prompts + pre-warms prefixes. | None — shipping. | — | 0 |
| Small-vision | **Yes** (Haiku/Flash support caching). | Same. | None. | — | 0 |
| Text-only-large | **Mostly yes** (GPT). Claude Sonnet text = yes. | Same. | None. | — | 0 |
| Text-only-small | **No** (no API-level caching on Ollama/Groq). | **Local LRU**: hash of (system+prefix) → cached response bytes; if exact match, return without network. | **Not yet built.** Big latency win for loops that repeat the same system prompt. | Port Claude Code's `ResponseCache` (it hashes prefix bytes + tool schema hash). | 1.5d |
| Local-Ollama | **No**. Ollama keeps KV state per-session but not persistent. | LRU above + Ollama `keep_alive` param for within-session reuse. | Needs session-local reuse of Ollama model loaded state. | Thread `keep_alive` through `ollama-adapter.ts`. | 3h |
| Free-tier | **Partial**. Gemini free = yes (limited quota). Groq = no. | LRU locally + native where supported. | Quota tracking for Gemini free-tier cache use. | Extend `telemetry/` cost tracker to count cache quota separately. | 1d |

#### Row 8 — multi-turn (stateless vs stateful)

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| All paid providers | All stateless at API layer (pass full history). | `core/session.ts` owns history replay; works on every provider. | None. | — | 0 |
| Stateful assistant APIs (OpenAI Assistants, Gemini Chat) | Some provider-side state. | WOTANN ignores provider state by default (stateless is safer). | No current integration of provider-side threads (and none needed). | Skip intentionally. | — |
| Local-Ollama | `keep_alive` enables pseudo-state. | Thread `keep_alive` param (see §7). | Same as §7. | Shared. | 0 |

#### Row 9 — voice (STT/TTS)

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Partial**. GPT-5.4 Realtime API does STT+TTS. Claude + Gemini = text only. | WOTANN has `voice/voice-pipeline.ts` with STT cascade (Web-Speech → system → whisper-local → whisper-cloud → deepgram) and TTS cascade (Web-Speech → system → piper → elevenlabs → openai-tts). | Realtime API integration not wired — currently text-only round-trip. | Port OpenAI Realtime SDK into `voice/voice-pipeline.ts` as a new backend preset. | 3d |
| Small-vision | **No**. | Same pipeline. | None. | — | 0 |
| Text-only-large | **No**. | Same pipeline. | None. | — | 0 |
| Text-only-small | **No**. | Same pipeline; small models can still do voice round-trip. | None. | — | 0 |
| Local-Ollama | **No** (model itself). | Whisper-local + Piper-TTS — both offline. | Whisper-local binary not auto-installed. | Port Goose's `speech-core` extension installer. | 1d |
| Free-tier | **Yes** — Web Speech API zero-cost default. | Already wired. | None. | — | 0 |

#### Row 10 — OCR

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| All vision tiers | **Yes** (the model reads the image). | Pass-through. | None. | — | 0 |
| Text-only tiers | **No**. | `utils/vision-ocr.ts` uses macOS Vision.framework then Tesseract then honest `[OCR unavailable]`. | None — shipping. | — | 0 |
| **Structural OCR gap** (all tiers) | Plain text OCR loses tables/charts/layout. | Add a `structural-ocr.ts` pipeline: macOS Vision returns bounding boxes; group by column; emit as Markdown-table when detected. | Not built. | Port peekaboo's `see --annotate --json` which returns structured element hierarchy, not just OCR text. | 3d |

#### Row 11 — image-generation

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Partial**. GPT-image/DALL-E-4 yes; Gemini Imagen yes; Claude no. | For Claude sessions, auto-route image-gen requests to DALL-E-4 via OpenAI adapter (the user doesn't care which provider drew the image; they care that it was drawn). | No auto-route yet — user must invoke a separate tool. | Port Goose's `image-generation-core` extension pattern: declare image-gen as a cross-provider capability, route per-query. | 2d |
| Small-vision | Same. | Same. | Same. | Shared. | 0 |
| Text-only tiers | **No**. | Same route. | Same. | Shared. | 0 |
| Local-Ollama | **No** (LLM), but Stable Diffusion via Ollama `ollama run sd` wrapper works. | Route to local SD if installed; else prompt user to install. | SD auto-install not wired. | Similar to Goose `image-generation-core`. | 1.5d |
| Free-tier | **Partial**. Gemini Imagen free tier yes; Groq/Cerebras no. | Route to Gemini free for image-gen when on free-tier-only. | Router doesn't detect "needs image-gen" signal. | Add a `requiresImageGen` detector (user prompt contains `/image`, `generate an image`, etc.). | 4h |

#### Row 12 — video-generation

| Tier | Native? | WOTANN fallback | Gap | Port plan | Effort |
|---|---|---|---|---|---|
| Frontier-vision | **Partial** (Veo 3, Sora 2). | Route video-gen requests through Gemini Veo or OpenAI Sora endpoint. | Not wired. | Port Goose's `video-generation-core` + `runway` extensions. | 3d |
| All others | **No**. | Same route. | Same. | Shared. | 0 |
| Local/Free | **No**. | Route to `runway` free tier (limited) or refuse with honest "video-gen requires API key". | Refuse-politely flow not implemented; currently silent. | Add honest-refusal handler. | 4h |

#### Rows 13–18 — compact

| # | Capability | Frontier | Small-vision | Text-only-lg | Text-only-sm | Ollama | Free |
|---|---|---|---|---|---|---|---|
| 13 | **code-execution** | N (GPT/Gemini/Mistral) | P | P (GPT) / — Claude | E sandbox | E sandbox | E sandbox |
| 14 | **web-browsing** | N (Anthropic connector / GPT browse / Grok) | P | P / E | E fetch+parse | E Lightpanda | E Lightpanda+MCP |
| 15 | **shell-exec** | E (tool) | E | E | E | E | E |
| 16 | **file-system** | E (tool) | E | E | E | E | E |
| 17 | **embedding** | P (separate model) | P (OpenAI emb) | P (OpenAI emb) | E (MiniLM local) | N (Ollama `nomic-embed`, `mxbai-embed`) | E (MiniLM / Gemini emb free) |
| 18 | **reranking** | E (LLM as reranker) | E | E | E (MiniLM cross-encoder) | E (bge-reranker local) | E (Cohere rerank free tier) |

**Details:**

- **Code-execution** — Port Goose's `builtin_extension.rs` code runner. WOTANN currently requires user to wire it as a tool. **Gap**: no sandboxed interpreter bundled. **Port**: Firecracker or `isolated-vm` Node sandbox. **Effort**: 3d.
- **Web-browsing** — Lightpanda MCP is already available (see env). **Gap**: `mcp/` registry doesn't auto-register Lightpanda when no native browsing. **Port**: Goose's `browser` extension (Rust) auto-registration pattern. **Effort**: 1d.
- **Shell-exec** — All via tool — no fallback gap.
- **File-system** — All via tool — no fallback gap.
- **Embedding** — `@xenova/transformers` (MiniLM) is in `optionalDependencies`. Auto-install when no API embedding available. **Gap**: lazy-load path not hot. **Port**: Goose's `memory-core` + `embeddings-model-normalize.ts` auto-selection. **Effort**: 1d.
- **Reranking** — Port `memory-lancedb`'s cross-encoder rerank. Currently WOTANN uses FTS5 only. **Effort**: 2d.

---

## 2. Per-Capability Fallback Implementation Plan

This section tells the implementer exactly what to build, in dependency order.

### 2.1 Computer-use fallback (text-only → accessibility tree)

**Status**: Partially built. `perception-adapter.ts` routes by tier; `platform-bindings.ts` has macOS AX API, Linux and Windows are stubs.

**Port from**: Goose's `crates/goose/src/computer_use/` + OpenClaw's peekaboo `see --json`.

**Concrete additions**:
1. Flesh out AT-SPI Linux reader in `platform-bindings.ts::readLinuxA11yTree`.
2. Flesh out UIA Windows reader in `platform-bindings.ts::readWindowsA11yTree`.
3. Add SoM pixel overlay via `sharp` in `generateSetOfMark()` — stub function exists but returns raw screenshot.
4. Implement OpenClaw dual-model hop: if current model is text-only, fire a parallel Gemini-3-Flash-free query to parse the screenshot to structured elements (cache the parse for 3 min). Ship structured elements to text-only model. **This is the OpenClaw "Gemini-screenshot-parse + Claude-reason" pattern applied to free-tier.**

### 2.2 Long-context fallback (chunk + retrieve)

**Status**: Core infrastructure in place (`context/tiered-loader.ts`, `context-sharding.ts`, `memory/` with FTS5), but the **query-focused retrieval layer** is missing.

**Port from**: Claude Code's "smart context" chunker + Goose's `memory-lancedb`.

**Concrete additions**:
1. Add `context/query-focused-retriever.ts` that:
   - Detects when `prompt.length + history.length > model.contextWindow * 0.8`.
   - Splits overflow into 2k-token chunks.
   - Embeds prompt + each chunk via MiniLM (already optional dep).
   - Returns top-k=5 most-relevant chunks + prompt.
2. Wire into `providers/provider-service.ts` as a pre-query middleware.

### 2.3 Tool-calls on non-tool model (ReAct + XML)

**Status**: Shipping. `capability-augmenter.augmentToolCalling` injects XML; `tool-parsers/parsers.ts` has 11 family parsers.

**Gap**: No auto-detection of tool-call reliability per-model — fall-back to **ReAct chain** when XML parser returns null on 2+ consecutive turns.

**Port from**: Codex CLI's ReAct loop (`Observation:` / `Thought:` / `Action:` / `Final Answer:`).

**Concrete additions**:
1. Add `tool-parsers/react-parser.ts` (actually the `parseReact` function is listed as existing in `parsers.ts` — verify and promote).
2. Add failure-count tracker in `provider-service.ts`: after 2 null parses, switch model's effective parser to ReAct.

### 2.4 Vision fallback (OCR + Set-of-Mark)

**Status**: OCR shipping via `utils/vision-ocr.ts` (macOS Vision + Tesseract). Set-of-Mark stubbed.

**Gap**: Real SoM overlay + structural OCR.

**Port from**: peekaboo `see --json --annotate` (returns structured JSON of elements) + any WebRTC-style overlay lib.

**Concrete additions**:
1. Add `utils/som-overlay.ts` using `sharp` to paint numbered boxes on a screenshot.
2. Extend `vision-ocr.ts` with `ocrStructural()` that returns `{text, bboxes, hierarchy}` — fallback when only plain text available.

### 2.5 Structured output fallback (post-parse + retry)

**Status**: Partial. Providers with native `response_format` use it; others rely on system-prompt instruction + extraction in caller code (inconsistent).

**Gap**: Uniform `extractJSON(response): T | null` with 2x retry.

**Port from**: Goose's `formats/openai.rs` `parse_response_as_json()` helper.

**Concrete additions**:
1. Add `providers/structured-output.ts` with:
   - `extractFirstJSON(text)` — balance-brace finder.
   - `extractJSONArray(text)` — bracket-finder.
   - `retryWithJSONPrompt(options, previousFailure)` — inject a fewshot "your last response was invalid JSON, here's the schema, return ONLY valid JSON" system-prompt prefix.
2. Thread through `capability-augmenter` as `augmentJSONOutput(options, capabilities)`.

### 2.6 Streaming fallback (chunked replay)

**Status**: Not built. All current providers stream natively.

**Gap**: For cost-throttled providers (batch API), need fake SSE pacing.

**Port from**: Claude Code's paced-replay.

**Concrete additions**:
1. Add `providers/synthetic-stream.ts`:
   - `replayAsStream(fullText, tokensPerSec = 40)` — slices on whitespace, yields `StreamChunk` at pace.

### 2.7 Prompt-caching fallback (local LRU)

**Status**: `prompt-cache-warmup.ts` handles native Anthropic caching.

**Gap**: Local LRU for non-caching providers.

**Port from**: Claude Code's `ResponseCache` (hashes prefix bytes).

**Concrete additions**:
1. Add `providers/local-response-cache.ts`:
   - LRU keyed on SHA-256 of `(system + toolsSchemaHash + prefix)`.
   - Store first N response bytes (useful only for fully idempotent deterministic calls — temperature=0 + same seed).
   - Default size 200 MB disk, 50 MB RAM.
2. Wire into `provider-service.ts`: on cache hit, emit synthetic stream.

### 2.8 Voice (transcribe-then-text)

**Status**: `voice/voice-pipeline.ts` with STT/TTS cascades.

**Gap**: GPT Realtime API integration + Whisper-local auto-install.

**Port from**: OpenAI Realtime SDK + Goose's speech-core installer.

**Concrete additions**:
1. Add `voice/realtime-backend.ts` when OpenAI key present.
2. Auto-download `whisper.cpp` binary in `utils/sidecar-downloader.ts` first run.

### 2.9 Multi-turn on stateless (conversation replay)

**Status**: Already handled by `core/session.ts`.

**Gap**: None.

### 2.10 Image-gen / Video-gen (route to external)

**Status**: Not built.

**Gap**: Cross-provider capability routing.

**Port from**: Goose's `image-generation-core` + `runway` extensions.

**Concrete additions**:
1. Add `providers/capability-router.ts`:
   - `routeByCapability(capability, userTier)` — returns `{provider, model}` best for that capability given user's auth setup.
   - E.g., `routeByCapability("image-gen", {anthropicOnly: true})` → returns DALL-E-4 via fallback free tier or honest refusal.

### 2.11 Embedding fallback (MiniLM local)

**Status**: `@xenova/transformers` optional dep, used in S4-wired memory.

**Gap**: Auto-init + selection priority.

**Port from**: Goose's `embeddings-model-normalize.ts`.

**Concrete additions**:
1. Add `memory/embedding-selector.ts` — picks Voyage > OpenAI > Gemini > MiniLM-local by availability.

---

## 3. Gap Priority List — Fix Order

Ranked by (impact × users affected) / effort.

| Rank | Gap | Impact | Users affected | Effort | Port from |
|---|---|---|---|---|---|
| **1** | **Capability-aware free-tier router** (Gemini-vision-parse + Groq-reason) | CRITICAL — unlocks computer-use on pure-free-tier setup | All free-tier users (60%+ of WOTANN TAM) | 3d | OpenClaw dual-model pattern |
| **2** | **Linux/Windows a11y tree reader** | HIGH — computer-use on non-macOS text-only models broken | Linux/Windows users (30%) | 2d | Goose `compute_use/` |
| **3** | **Local response cache (LRU)** | HIGH — 2x perceived latency on idempotent calls | All users | 1.5d | Claude Code ResponseCache |
| **4** | **Structural OCR** (tables + bboxes + hierarchy) | MEDIUM — vision on text-only tiers loses layout | Text-only users (25%) | 3d | peekaboo `see --json` |
| **5** | **Set-of-Mark overlay** | MEDIUM — small-vision tier coord accuracy | Small-vision users (30%) | 4h | `sharp` |
| **6** | **Structured-output extractor + retry** | MEDIUM — small models emit malformed JSON 15% of the time | All users with JSON tools | 1d | Goose `openai.rs` |
| **7** | **Capability router for image/video-gen** | MEDIUM — currently hard-codes user to single-provider | All users | 2d | Goose `image-generation-core` |
| **8** | **Query-focused retriever for long-context** | MEDIUM — 32k-ctx local models fail long tasks | Ollama users (20%) | 2d | Claude Code smart-context |
| **9** | **Ollama `native_tool_calling` auto-detect** | LOW — wastes XML injection on already-capable models | Ollama users | 1.5d | Goose `local_model_registry.rs` |
| **10** | **ReAct fallback when XML parser fails** | LOW — secondary safety net | Text-only-small users | 1d | Codex CLI |
| **11** | **Chunked streaming replay** | LOW — batch/cost-throttled providers not shipped yet | All users (future) | 1d | Claude Code paced replay |
| **12** | **OpenAI Realtime API backend for voice** | LOW — nice-to-have parity | Voice users | 3d | OpenAI SDK |
| **13** | **Embedding selector priority** | LOW — MiniLM already good enough | Memory users | 4h | Goose `embeddings-model-normalize.ts` |
| **14** | **Ollama `keep_alive` threading** | LOW — minor latency win | Ollama users | 3h | Ollama API |
| **15** | **Sandboxed code interpreter** | LOW — Claude text-only can already use tool wrapping | Text-only users who run code | 3d | Firecracker / `isolated-vm` |

**Delivery cadence**: 3-5 gaps per sprint; ranks 1-6 are "Sprint Capability-Adapt-1", ranks 7-12 = "Sprint Capability-Adapt-2", ranks 13-15 = "Sprint Capability-Adapt-3".

---

## 4. Port Priority — Competitor Pattern Map

Which competitor's proven pattern we copy per gap.

| Gap | Competitor | Specific file / pattern | Why this source |
|---|---|---|---|
| Free-tier router | **OpenClaw** | Dual-model vision-parse + non-vision-reason hop (referenced in CLAUDE.md, realized across `extensions/`) | Their core differentiator; battle-tested in prod on 30+ free providers |
| A11y tree readers | **Goose** | `crates/goose/src/computer_use/` (Rust but we port the architecture) | Cross-platform Rust impl = cleanest reference |
| Local response cache | **Claude Code** | `ResponseCache` with prefix-hash + tool-schema-hash | Proven on 1M+ daily queries |
| Structural OCR | **OpenClaw** (peekaboo) | `peekaboo see --json --annotate` returns structured element tree | Mac-only today; port to cross-platform via macOS Vision + Tesseract+bboxes |
| SoM overlay | **Research papers + `sharp` idiom** | Set-of-Mark paper (Zhang et al 2023) — numbered box overlay | Reference implementation trivial once `sharp` is wired |
| JSON extractor + retry | **Goose** | `crates/goose/src/providers/formats/openai.rs::parse_response_as_json` | Battle-tested against 10+ open models |
| Image/video capability router | **Goose** | `crates/goose/src/providers/image-generation-core/` + `video-generation-core/` | Extension-per-capability pattern |
| Query-focused retriever | **Claude Code** | Smart-context chunker (public behavior, reverse-engineered) | Well-characterized behavior; WOTANN can replicate with MiniLM + FTS5 |
| Ollama native_tool_calling detect | **Goose** | `crates/goose/src/providers/local_inference/local_model_registry.rs::FEATURED_MODELS` | Exactly the data table we need |
| ReAct fallback | **Codex CLI** | Openai Codex's `codex-oauth` + ReAct scaffolding | Reference for "when XML fails, revert to plain prose" |
| Streaming replay | **Claude Code** | Paced-replay observed behavior | UX parity |
| OpenAI Realtime | **OpenAI SDK** | `openai-realtime` npm package | Vendor impl |
| Embedding selector | **Goose** | `memory-host-sdk/src/host/embeddings-model-normalize.ts` | Already in the research clone |
| Ollama keep_alive | **Ollama API docs** | `POST /api/generate { keep_alive: "5m" }` | Vendor feature |
| Code-exec sandbox | **Firecracker + `isolated-vm`** | Industry standard pattern | Security-reviewed pattern |

---

## 5. Integration Proposal — `src/providers/capability-augmenter.ts`

The existing file is small (253 LOC) and focused on three augmentations (tool, thinking, vision). To become the hub of universal capability, it should grow to **dispatch** rather than contain all logic.

### Proposed new shape (split file into many small ones per CLAUDE.md 200-400 LOC rule):

```
src/providers/
  capability-augmenter.ts        — DISPATCH ONLY (~150 LOC)
  capability-router.ts           — cross-provider capability routing (NEW)
  augmenters/
    tool-calling-augmenter.ts    — existing tool injection (~100 LOC)
    thinking-augmenter.ts        — existing (~60 LOC)
    vision-augmenter.ts          — existing + structural OCR (~150 LOC)
    json-augmenter.ts            — NEW — structured output + retry (~200 LOC)
    streaming-augmenter.ts       — NEW — chunked replay (~80 LOC)
    cache-augmenter.ts           — NEW — local LRU response cache (~200 LOC)
    voice-augmenter.ts           — NEW — routes audio to STT/TTS cascade (~150 LOC)
    image-gen-augmenter.ts       — NEW — routes to DALL-E/SD when not native (~120 LOC)
    video-gen-augmenter.ts       — NEW — routes to Veo/Runway when not native (~120 LOC)
    embedding-augmenter.ts       — NEW — selects embedding backend (~80 LOC)
    rerank-augmenter.ts          — NEW — LLM-as-reranker fallback (~80 LOC)
    long-context-augmenter.ts    — NEW — query-focused retrieval (~200 LOC)
```

### New `augmentQuery()` signature:

```ts
// capability-augmenter.ts (proposed)
import { augmentToolCalling } from "./augmenters/tool-calling-augmenter.js";
import { augmentThinking } from "./augmenters/thinking-augmenter.js";
import { augmentVision } from "./augmenters/vision-augmenter.js";
import { augmentJSON } from "./augmenters/json-augmenter.js";
import { augmentLongContext } from "./augmenters/long-context-augmenter.js";
import { augmentCache } from "./augmenters/cache-augmenter.js";

// Every augmenter has the same signature for composability:
type AugmentFn = (
  opts: UnifiedQueryOptions,
  caps: ProviderCapabilities,
  ctx: AugmentContext,
) => Promise<UnifiedQueryOptions> | UnifiedQueryOptions;

interface AugmentContext {
  readonly modelTier: "frontier-vision" | "small-vision" | "text-only-large" | "text-only-small" | "local-ollama" | "free-tier";
  readonly provider: ProviderName;
  readonly modelName: string;
  readonly userAuth: ReadonlySet<ProviderName>;          // which providers are available
  readonly capabilityRouter: CapabilityRouter;           // for cross-provider hops
  readonly responseCache: LocalResponseCache;
}

export async function augmentQuery(
  options: UnifiedQueryOptions,
  capabilities: ProviderCapabilities,
  ctx: AugmentContext,
): Promise<UnifiedQueryOptions> {
  // Order matters: cache check → long-context compression → vision/OCR → tool-calling → JSON → thinking
  let q = options;
  q = await augmentCache(q, capabilities, ctx);        // returns short-circuit if cache hit
  q = await augmentLongContext(q, capabilities, ctx);   // RAG if needed
  q = augmentVision(q, capabilities, ctx);              // OCR fallback
  q = augmentToolCalling(q, capabilities, ctx);         // XML injection if no native
  q = augmentJSON(q, capabilities, ctx);                // structured output
  q = augmentThinking(q, capabilities, ctx);            // CoT injection
  return q;
}
```

### Cross-provider router (`capability-router.ts`):

```ts
// capability-router.ts (NEW)
export class CapabilityRouter {
  constructor(
    private readonly equalizer: CapabilityEqualizer,
    private readonly fingerprinter: CapabilityFingerprinter,
    private readonly availableProviders: ReadonlySet<ProviderName>,
  ) {}

  /**
   * Find the best (cheapest-capable) provider for a specific capability slot.
   * Used when the user's selected model lacks a capability but the task needs it.
   */
  routeByCapability(
    capability: CapabilityName,
    constraints: { readonly maxCostUSD?: number; readonly preferLocal?: boolean },
  ): { provider: ProviderName; model: string } | null {
    // 1. Check if selected model has it (no hop needed).
    // 2. Else walk cost-ordered fallback: Gemini-free → Groq-free → Ollama-local → paid.
    // 3. Return the first match or null if none.
  }
}
```

This matches the OpenClaw pattern cited in the CLAUDE.md prompt: a small augmentation model (Gemini free) handles the task the user's model can't, transparently.

---

## 6. Existing Infrastructure — What WOTANN Already Has

This table helps the implementer know what NOT to rebuild.

| File | Role | LoC | Ship status |
|---|---|---|---|
| `src/providers/capability-augmenter.ts` | Augmentation dispatch (tool/thinking/vision) | 253 | Shipping |
| `src/providers/capability-equalizer.ts` | 25-capability × 11-model profile table + gap computation | 549 | Shipping |
| `src/providers/capability-fingerprint.ts` | Static + dynamic capability probes | 245 | Shipping |
| `src/providers/fallback-chain.ts` | Rate-limit cascade across 18 providers | 148 | Shipping (Session-10 fix) |
| `src/providers/prompt-cache-warmup.ts` | Anthropic prompt caching | ~400 | Shipping |
| `src/providers/tool-parsers/parsers.ts` | 11 model-family tool-call parsers | (S3-2) | Shipping |
| `src/providers/model-router.ts` | Model selection routing | 500+ | Shipping |
| `src/providers/budget-downgrader.ts` | Cost-driven model downgrade | 180 | Shipping |
| `src/computer-use/perception-adapter.ts` | Tier-aware perception (vision / SoM / text) | 317 | Shipping (SoM overlay stubbed) |
| `src/computer-use/platform-bindings.ts` | OS-native screen + input | 800+ | Shipping (Linux/Windows partial) |
| `src/utils/vision-ocr.ts` | macOS Vision + Tesseract OCR | 175 | Shipping |
| `src/voice/voice-pipeline.ts` | STT/TTS cascade | 400+ | Shipping (Realtime backend missing) |
| `src/context/tiered-loader.ts` | Context tier loading | ~200 | Shipping |
| `src/context/virtual-context.ts` | Context window extension | ~300 | Shipping |
| `src/memory/` | SQLite + FTS5 + MiniLM embeddings | ~2000 | Shipping (LanceDB missing) |

---

## 7. Acceptance Criteria — "Universal Capability" Green

A given capability is considered "universally shipped" when:

1. **Matrix cell** is filled (N or E, never `—`).
2. **Contract test** exists in `tests/providers/capability-<name>.contract.test.ts` that runs the capability through each tier's adapter and asserts identical semantic output.
3. **Honest-unavailable marker** is emitted when fallback isn't possible (never a hallucinated fake).
4. **Cost preview** (`wotann cost`) reports any capability-augmentation detour (e.g., "+$0.001 for OCR sidecar call to Gemini-free").
5. **Typecheck + lint** are clean, file sizes under 400 LoC per CLAUDE.md.

---

## 8. Summary

- **18 capabilities × 6 model tiers = 108 cells**, 82 filled natively or by shipping WOTANN fallback, **26 cells are gaps today**.
- **Top 3 fixes** (Gap #1–3): free-tier capability-aware router, Linux/Windows a11y tree, local response cache — together unlock computer-use + long-context + caching for ~90% of non-frontier WOTANN sessions.
- **Architecture change**: split `capability-augmenter.ts` into a dispatch file + 11 small augmenters (one per capability), add `CapabilityRouter` for cross-provider hops.
- **Target competitor patterns to port**: OpenClaw's dual-model vision hop (highest ROI), Goose's extension-per-capability (structural), Claude Code's response cache (latency).
- **Total effort for full closure**: ~25 engineering days, parallelizable into 3 sprints.

---

## Appendix A — Capability Aliases Across Systems

When porting from competitors, names differ. Here's the mapping WOTANN uses.

| WOTANN name        | OpenClaw              | Goose                 | OpenAI docs          | Anthropic docs       |
|---|---|---|---|---|
| tool-calls         | function-call         | tool_call             | tool_call / function | tool_use             |
| computer-use       | peekaboo              | computer_use          | `computer-use-preview` tool | computer_20250124 tool |
| vision             | image-input           | vision                | `image_url` content  | `image` block        |
| long-context       | context-extension     | context_size          | context window       | context window       |
| prompt-caching     | cache_control         | prompt_cache          | automatic caching    | `cache_control: ephemeral` |
| structured-output  | json_mode             | response_format       | `response_format`    | prompt-emulated      |
| code-execution     | code_interpreter      | code_execution        | code interpreter     | (via MCP)            |
| web-browsing       | web_search            | web_browse            | `browse` tool        | web-search connector |
| embedding          | embedding             | embeddings            | embeddings API       | (Voyage partner)     |
| rerank             | rerank                | rerank                | —                    | —                    |
| image-generation   | image-generation-core | image_generation      | DALL-E / gpt-image-1 | — (via MCP)          |
| video-generation   | video-generation-core | video_generation      | Sora API             | —                    |
| voice              | talk-voice / speech-core | speech / dictation | Realtime API         | — (via MCP)          |
| OCR                | media/parse           | ocr                   | vision               | vision               |
| streaming          | streaming             | streaming             | `stream: true`       | `stream: true`       |
| multi-turn         | multi-turn            | conversation          | threads              | messages             |
| shell-exec         | shell                 | shell                 | via tool             | via tool             |
| file-system        | filesystem            | file_system           | via tool             | via tool             |

---

## Appendix B — Tier Classification Rules (for `model-router.ts`)

A model is classified into a tier based on fingerprint + static profile. Priority order:

```
if model has vision AND contextWindow ≥ 500k  → "frontier-vision"
else if model has vision AND contextWindow ≥ 100k  → "small-vision"
else if contextWindow ≥ 100k AND supportsToolCalling  → "text-only-large"
else if provider == "ollama"  → "local-ollama"
else if modelCost == free AND not local  → "free-tier-only"
else  → "text-only-small"
```

These thresholds match the static tables in `capability-fingerprint.ts::STATIC_CAPABILITIES`.

---

**End of CAPABILITY_ADAPTATION_MATRIX.md — commit this file, don't push.**
