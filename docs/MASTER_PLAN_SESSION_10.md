# WOTANN Session 10 — The Master Plan

> Generated 2026-04-17 · audit method: 8 parallel Opus Explore agents,
> live Tauri empirical verification, iPhone 17 Pro simulator booted,
> git-log reconciled, 10 cloned competitor repos + 25 monitored +
> 9 external IDE comps + April 2026 web research · zero claim trusted
> until independently verified

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Empirical reality check — what was verified live](#2-empirical-reality-check)
3. [Claim-vs-reality ledger (sessions 2-9)](#3-claim-vs-reality-ledger)
4. [Gap inventory — verified, not claimed](#4-gap-inventory)
5. [Top-40 leverage-per-LOC leaderboard](#5-top-40-leverage-per-loc-leaderboard)
6. [The 60-90-day race window](#6-60-90-day-race-window)
7. [WOTANN's genuine moats](#7-wotanns-genuine-moats)
8. [Execution plan — 6 weeks, 5 waves](#8-execution-plan--6-waves)
9. [What NOT to build](#9-what-not-to-build)
10. [Risk register + regression-prevention protocol](#10-risks)
11. [Appendix — live evidence](#11-appendix-live-evidence)

---

## 1. Executive summary

**WOTANN v0.1.0 is a substantially-real product** with one of the deepest
cross-session audit trails in OSS. Verified live this session:

* **3,922 / 3,933 tests pass** (5 pre-existing timeouts, 6 skipped for env gates, 0 tautologies)
* **All 4 primary adapters wire `tools:` on the wire** (S9 audit proved; pre-S9 was broken in 4/5)
* **iOS → daemon parity complete** — all 21 iOS-called RPC methods wired, streaming fork active, ECDH unified P-256, Live Activities wired
* **17 / 19 MASTER_AUDIT ship-blockers closed**; 10 of 10 hook guarantees actually enforce the 6 that matter
* **Tauri desktop empirically live** — Chat, Editor (CHAT-1 CSP fix proven), Cmd+K palette with grouped categories + ⌘N glyph, Settings > Providers shows 3 real subscriptions (Claude Code / Copilot / Codex Connected)

**BUT**: sessions 1-9 shipped **at least 5 false-claim commits** that only
subsequent adversarial audits caught (MiniLM "wired", voice RPCs "wired",
DNS-TOCTOU fix "complete", anti-distillation fix "complete", S1 shadow-git
"complete"). Quality bar #14 (runtime-verify commit messages) earned its
keep. **This session's audit kept the pattern alive** and caught 5 new
lies:

* **All five S9 signature components I built last session — Runering /
  CapabilityChips / SealedScroll / Well / FocusView — are orphaned.**
  Runering is mounted in App.tsx but **zero emit sites** in the codebase.
  CapabilityChips / SealedScroll / Well / FocusView are defined but
  **never imported**. They exist without being used anywhere.
* **Bedrock + Vertex auth is fabricated.** Registry cases send Bearer
  tokens to `/chat/completions` paths. No SigV4 anywhere. No OAuth2
  exchange. Vertex passes the service-account-JSON **file path** as the
  token. Both will 403/401 on any real request.
* **Fallback chain excludes 9 of 18 providers.** HuggingFace / Mistral /
  DeepSeek / Perplexity / xAI / Together / Fireworks / SambaNova / Groq
  authenticate but never enter the rotation. AccountPool multi-key
  rotation works only for 3 providers (Anthropic / OpenAI / Gemini).
* **`SOUL.md` never loads.** `identity.ts` reads from `$HOME/.wotann/`
  but the 52-line SOUL.md lives in workspace `.wotann/`. Identity
  module silently renders 1-line fallback.
* **`memoryMiddleware` attaches `memoryCandidate` — nothing reads it.**
  Producer with no consumer. Dead type on the critical path.

**Plus 11 orphan Tauri views** (canvas / agents / connectors / projects
/ dispatch / approvals / plugins / design / playground / schedule /
integrations), **~20 dead Rust commands**, **runtime.ts still 4,553 LOC
(grew 64 from 4,489)**, **kairos-rpc.ts still 5,375 LOC**, **TUI App.tsx
2,979 LOC unchanged**, **10 dead HookEvent variants**, **format-translator
still Anthropic↔OpenAI only (no Gemini)**, **conversation-manager and
project-manager still LIE about persistence**.

**Race window: 60-90 days.** Claude Apps GA is June-September 2026.
Cursor 3 already ships Agents Window + Design Mode. Antigravity ships
Manager Surface + Browser Sub-Agent. If WOTANN doesn't ship a runnable
public MVP by **end of June 2026**, the narrative anchors elsewhere.

**Top-40 port candidates sorted by leverage-per-LOC**. The top 10 items
together are under 30 days of work and would restore the entire "harness
amplifies every model" thesis.

---

## 2. Empirical reality check

Live this session (screenshots captured; see `tauri-` series):

| Check | Result |
|---|---|
| `npm test` (full, 740s) | 3,922 pass / 5 fail (pre-existing timeouts) / 6 skipped |
| `npm run typecheck` (root) | exit 0 |
| `cd desktop-app && npx tsc --noEmit` | exit 0 |
| `cd desktop-app && npx vite build` | exit 0 (38 chunks, 602KB main) |
| `open -a WOTANN` | window launches, renders |
| Chat view (⌘1) | hero + 6 quick-action tiles + composer + preset hints + **no disconnected banner** — S9 dismissal fix confirmed in prod bundle |
| Editor view (⌘2 from palette) | **renders empty state** ("Select a file to edit" / "Open Folder" / Terminal/Search/Design/Outline bottom bar) — **CHAT-1 CSP fix proven** |
| Command palette (⌘K) | 63 unique commands in grouped categories (SESSION / NAVIGATION / …), ⌘N glyph on row, fuzzy input |
| Settings > Providers | Claude Code Pro/Max · GitHub Copilot Pro/Business · ChatGPT Plus (Codex) all **Connected** with correct versions detected + API keys panel below |
| iPhone 17 Pro simulator | booted (`6FD7BDC8-9A3B-4C81-93C0-F864445BE6DA`), iOS app install blocked on Simulator-app grant (`com.apple.iphonesimulator` denied — not in session-granted list) |

---

## 3. Claim-vs-reality ledger

### 3.1 Verified-done (~17 items backed by commit + later adversarial confirmation)

PreToolUse firing · shadow-git rollback · vendor-bias elim · DNS-rebind
TOCTOU · Hermes 11-parser dispatch · ToolResultReceived event · ESLint 9
flat config · Gemini multimodal · Tauri denylist · Magika file-type gate
· Self-crystallization · Hook `if` predicate · Magic Git analyzers · ACP
codec · S9 daemon reliability · S9 Monaco CSP (now also empirically
confirmed) · S9 disconnected-banner dismiss (now also empirically
confirmed).

### 3.2 Suspected-done (committed but not re-audited)

S2 9 RPC handlers · S3-7 OCR · S3-5 active-memory sub-agent · Copilot +
Codex multi-turn adapters · Docker exec envs (C11) · Agent Profiles (C10)
· @terminal mention (C8) · per-prompt override (C12) · context-meter
(C9) · Code Mode DSL (C25) · `.wotann.yml` (C27) · 3-state worktree
Kanban (C19) · 23-CLI registry (C32) · Karpathy preamble · `/focus`
hook.

### 3.3 Walked-back / disputed

At least 5 earlier false-claim commits:
* MiniLM "wired" (S4) — audit found no runtime consumer. Closed at S6.
* voice.transcribe / voice.stream "wired" (S4) — still stubs. Closed at S5.
* DNS-TOCTOU "fixed" (S3) — broke production. Re-fixed S4, re-audited S5.
* anti-distillation "fixed" (S4) — missed parallel firing site. Closed S5 via module deletion.
* S1 shadow-git "complete" — had no callsites. Closed S2, then S3.

### 3.4 Still-open multi-session ride-alongs

Supabase key rotation (manual) · 18 iOS items (blocked on device) · 30
Tauri items (blocked on Chrome DevTools) · runtime.ts split (Gabriel-
deferred, grew) · kairos-rpc.ts split (grew) · Sentry DSN · Keychain
non-Mac · cost-tracking unification · Bedrock/Vertex auth · format-
translator Gemini · per-command Tauri allowlist · 2 ChannelAdapter
interfaces · 2 voice stacks · 10 dead HookEvents · TUI App.tsx size.

---

## 4. Gap inventory (verified, not claimed)

### 4.1 NEW gaps surfaced this session (S10 audit)

**A. S9 signature-component orphans (critical — my own regression)**

| Component | Status | File:line |
|---|---|---|
| Runering | Mounted in App.tsx:46 but **zero `emitRuneEvent` call sites** across the codebase. Glyph never fires. | `components/wotann/Runering.tsx` |
| CapabilityChips | Defined, **not imported anywhere**. | `components/wotann/CapabilityChips.tsx` |
| SealedScroll | Defined, **not imported**. Not integrated into TrustView/proofs. | `components/wotann/SealedScroll.tsx` |
| Well (timeline scrubber) | Defined, **not imported**. `⌘⇧T` listed in shortcuts overlay but **not bound** in `useShortcuts.ts`. | `components/wotann/Well.tsx` |
| FocusView | Defined, **zero imports**. No activation path. | `components/chat/FocusView.tsx` |

**B. Provider subsystem**

| Gap | Evidence |
|---|---|
| Bedrock: Bearer over `/chat/completions` path; no SigV4 | `registry.ts:201-218` |
| Vertex: service-account-JSON **file path** used as Bearer token; no OAuth2 exchange exists anywhere in src | `registry.ts:221-238`, `discovery.ts:535` |
| 9 of 18 providers excluded from fallback chain | `fallback-chain.ts:27-33` |
| AccountPool multi-key rotation only discovers 3 envs | `account-pool.ts:236-240` |
| `capability-augmenter` is pure function; no adapter actually invokes it in the request path | grep confirms zero call sites from adapters |
| `format-translator.ts` has no Gemini translation | `format-translator.ts:1-185` |
| Only 2 of 18 adapters have wire-level tests | `tests/unit/adapter-multi-turn.test.ts:42-65` |

**C. Memory / prompt**

| Gap | Evidence |
|---|---|
| `SOUL.md` loaded from `$HOME/.wotann/` — actual file in workspace | `identity.ts:12,35` |
| `instruction-provenance.ts` — exported, zero callers | grep 0 hits outside lib.ts re-export |
| Vector store: MiniLM code exists but runtime never instantiates `QuantizedVectorStore`; env gate `WOTANN_ENABLE_ONNX_EMBEDDINGS` has no reader | `quantized-vector-store.ts:24-27` |
| KG persistence: race window — `void this.persistKnowledgeGraph()` on sync close() can leave `.tmp` orphan if process killed | `runtime.ts:4224` |
| `memoryCandidate` attached by middleware, **no consumer** | `middleware/layers.ts:130-137` |
| `offload-to-disk` compaction declared in union but never implemented | `context/compaction.ts:11-16` |
| Dream-pipeline 2-4 AM window is hardcoded (devs working late get no dream) | `kairos.ts:1217` |
| 10 `HookEvent` variants are dead letters (PostToolUseFailure, Notification, SubagentStart, SubagentStop, PermissionRequest, Setup, TeammateIdle, TaskCompleted, ConfigChange, WorktreeCreate, WorktreeRemove) | `types.ts:138-165` |

**D. Tauri desktop**

| Gap | Evidence |
|---|---|
| 11 orphan views: canvas / agents / connectors / projects / dispatch / approvals / plugins / design / playground / schedule / integrations — **no palette / shortcut / sidebar** | `AppShell.tsx:134-189` switch inspection |
| Monaco workers not explicitly registered (`MonacoEnvironment.getWorker`) — AMD loader fallback works because of CSP unsafe-eval | `MonacoEditor.tsx` grep = 0 hits |
| Council palette entry **mis-routes** to `compare` view | `CommandPalette.tsx:306` |
| Blanket `*:default` Tauri permissions for 119 Rust commands — no per-command allowlist | `capabilities/default.json:5-12` |
| ~20 dead Rust commands still: 9 CoreGraphics cmds, 5 Remote Control cmds, 4 Agent Cursor cmds, 2 LocalSend receive cmds | `lib.rs:66-221` vs frontend grep |
| TUI `App.tsx` 2,979 LOC — unchanged | `src/ui/App.tsx` |
| 55/63 palette rows **do not** show shortcut glyphs | `CommandPalette.tsx` |
| TD-3.1 Workshop (partially fixed via WorkerPill) and Exploit (still palette-only) not top-pill | `AppShell.tsx` Header |
| SET-NAV-1 Settings sidebar fixed 180px width — long labels clip at <900px window | `SettingsView.tsx:55-63` |
| Theme systems totally disjoint: TUI 65 themes vs Desktop 6 — no shared source of truth | `ui/themes.ts` vs `wotann/WotannThemePicker.tsx` |

**E. iOS / channels / voice**

| Gap | Evidence |
|---|---|
| WOTANNIntents bypasses ECDH — Siri prompts leak plaintext | `WOTANNIntentService.swift:32` never calls `security.keyExchange` |
| `TaskMonitorHandler` constructed with no `executeTask` callback — autopilot tasks hang "running" forever | `companion-server.ts:606`, `ios-app.ts:407` |
| `DMPairingManager` / `NodeRegistry` in `adapter.ts` are ghost classes — shadowed by `kairos-rpc.ts:577` `nodeRegistry` Map | grep |
| Two ChannelAdapter interfaces (gateway.ts vs adapter.ts) — shim via `wrapLegacyAdapter`, iMessage implements neither | `integration.ts:27` |
| `github-bot.ts` (426 LOC) — **orphan**, not in gateway registration | `kairos.ts:751-867` |
| Two parallel voice stacks (`voice-mode.ts` 705 LOC + `voice-pipeline.ts` 641 LOC) with divergent STT provider enums | `src/voice/*.ts` |
| 11/14 channels have **no unit tests** (only sms / matrix / teams + terminal-mention covered) | `tests/channels/` + `tests/unit/` grep |

**F. Security / infra**

| Gap | Evidence |
|---|---|
| `conversation-manager.ts` + `project-manager.ts` still LIE about persistence in docstrings — no `writeFileSync`/`readFileSync` imports | grep |
| Lint NOT enforced in CI (`npm run lint` absent from all workflow jobs) | `.github/workflows/ci.yml` |
| No coverage gate in CI | same |
| No Developer ID signing — `signingIdentity: "-"` (ad-hoc only); Gatekeeper will warn on every install | `tauri.conf.json:44` |
| No `tauri-action` / `codesign` / `notarize` anywhere in `.github/` | grep |

**G. God-object / size**

| File | LOC | 800-cap over |
|---|---:|---:|
| `kairos-rpc.ts` | 5,375 | 6.7× |
| `core/runtime.ts` | 4,553 | 5.7× |
| `src/index.ts` | ~3,500 | 4.4× |
| `ui/App.tsx` | 2,979 | 3.7× |
| `daemon/kairos.ts` | 1,750 | 2.2× |
| `desktop-app/src/components/layout/AppShell.tsx` | ~500 | below cap |

### 4.2 Inherited gaps still open from earlier sessions

*(full list in ledger §3.4 above)* — Supabase rotation, 18 iOS blocked
items, Sentry, Keychain non-Mac, 4 cost-tracker sources unification, GH
release binaries, memory-tools dead-code chain (~1,000 LOC).

---

## 5. Top-40 leverage-per-LOC leaderboard

Sorted by value / LOC. S = must-ship, A = v0.3-0.5, B = v0.6+, C = later.
See §appendix for sources (REPOS.md, UI_DESIGN_SPEC §12, MASTER_AUDIT
§§11-14, web searches April 2026). "LOC" is port effort, not total LOC.

| # | Item | Src | LOC | Days | Prio | In-plan? | Have? |
|---|---|---|---:|---:|---|---|---|
| 1 | **Wire Runering to mem_save events** (emit on `/v1/memory/save`, `memoryStore.insert`, ObservationExtractor) — restore my S9 orphan | self | 40 | 0.5 | **S** | 🆕 | ⚠ mounted dead |
| 2 | **Integrate CapabilityChips into MessageBubble header** — use real provenance from stream metadata | self | 120 | 1 | **S** | 🆕 | ⚠ defined dead |
| 3 | **Render SealedScroll in TrustView** on proof-bundle completion RPC stream | self | 180 | 1.5 | **S** | 🆕 | ⚠ defined dead |
| 4 | **Mount Well scrubber in editor footer** + bind `⌘⇧T` + wire `shadow.checkpoints` RPC | self | 220 | 2 | **S** | 🆕 | ⚠ defined dead |
| 5 | **FocusView activation** — palette entry "Focus mode" + `⌘⇧L` binding + ChatView mode toggle | self | 150 | 1 | **S** | 🆕 | ⚠ defined dead |
| 6 | **SOUL.md path fix** — `identity.ts` reads from workspace `.wotann/` first, then `$HOME` fallback | self | 1 line | 30 s | **S** | ✅ | ❌ reads wrong dir |
| 7 | **Bedrock SigV4 signing + path** — replace openai-compat wrapper with real AWS SDK `BedrockRuntimeClient.converseCommand` | self | 400 | 3 | **S** | ✅ §33 | ❌ fabricated |
| 8 | **Vertex OAuth2 exchange** — real `GoogleAuth.getAccessToken()` + correct endpoint path | self | 300 | 2 | **S** | ✅ §33 | ❌ fabricated |
| 9 | **Fallback-chain extend to 18 providers** — weighted order + tests | self | 80 | 1 | **S** | ✅ | ❌ 9 excluded |
| 10 | **Format-translator Gemini path** — add `anthropicToGemini` / `openAIToGemini` to unify | self | 220 | 1.5 | **S** | ✅ | ❌ missing |
| 11 | **Wire `capability-augmenter` into adapters' request pipeline** | self | 80 | 1 | **S** | ✅ | ❌ orphan fn |
| 12 | **Wire instruction-provenance into prompt engine** — call `traceInstructions` during assembly + return `sourceMap` | self | 200 | 1.5 | **S** | ✅ | ❌ dead code |
| 13 | **`memoryMiddleware` consumer in runtime** — read `result.memoryCandidate`, capture to `memory_entries` with `tool+file+ts` | self | 60 | 0.5 | **S** | ✅ | ❌ dead payload |
| 14 | **Instantiate `QuantizedVectorStore` in runtime** when `WOTANN_ENABLE_ONNX_EMBEDDINGS=1` | self | 40 | 0.5 | **S** | ✅ | ❌ never reached |
| 15 | **Fix AccountPool `discoverFromEnv` to cover 18 providers** | self | 90 | 1 | **S** | ✅ | ❌ only 3 |
| 16 | **WOTANNIntents ECDH wiring** — Siri intents call `security.keyExchange` before RPCs | self | 120 | 1 | **S** | ✅ | ❌ plaintext |
| 17 | **TaskMonitorHandler `executeTask` callback wiring** — pass from companion-server context so autonomous iOS tasks resolve | self | 80 | 0.5 | **S** | ✅ §44 CRIT-13 | ❌ hangs forever |
| 18 | **Delete dead ghosts: `adapter.ts` DMPairingManager+NodeRegistry, `tool-error-handler.ts` (standalone), `deferred-tool-filter.ts`, `file-type-gate.ts`** (0 consumers) | self | −1,819 LOC | 1 | **S** | ✅ | ❌ still there |
| 19 | **Remove 10 never-fired HookEvent variants from type union** (or wire producers) | self | ±50 LOC | 1 | **S** | ✅ | ❌ dead types |
| 20 | **Fix `conversation-manager.ts` + `project-manager.ts`** — either implement persistence or delete the lying docstrings | self | 300 | 2 | **S** | ✅ | ❌ lying |
| 21 | **Add lint + coverage gate to CI** | self | 20 YAML | 0.5 | **S** | ✅ | ❌ typecheck only |
| 22 | **11 orphan Tauri views → palette entries + shortcuts** (batch) | self | 120 | 1 | **S** | ✅ | ❌ orphan |
| 23 | **Council palette entry routes to compare** — fix mis-route to real `council` view | self | 1 | 5 min | **S** | ✅ | ❌ bug |
| 24 | **Tauri per-command allowlist** — break `*:default` into ~30 capability groups | self | 200 | 2 | **S** | ✅ §33 | ❌ blanket |
| 25 | **Delete ~20 dead Rust commands** (CoreGraphics / Remote Control / Agent Cursor / LocalSend receive) **or** wire UI | self | −700 / +400 | 2 | **S** | ✅ | ❌ dead |
| 26 | **ValknutSpinner for remaining SVG-rotation sites** (ArenaView, EnhanceButton, EditorTerminal) + onboarding | self | 60 | 0.5 | **A** | ✅ | partial |
| 27 | **Tool-serialization wire-level tests for all 18 adapters** (capture fetch body, assert `tools` present) | self | 350 | 2.5 | **A** | 🆕 | ❌ 2/18 |
| 28 | **Workshop + Exploit top-pill in Header** — extend 2-pill to 4 (or tab-strip) | self | 50 | 0.5 | **A** | ✅ UX-TD3.1 | ❌ |
| 29 | **⌘3 / ⌘4 shortcuts for Workshop / Exploit** | self | 15 | 15 min | **A** | ✅ UX-TD8.1 | ❌ |
| 30 | **Hash-anchored 2-char CID editing** (tighter than 16-char SHA — 10× weak-model improvement) | oh-my-pi | 100 | 1 | **A** | ✅ §45 | ⚠ has 16-char |
| 31 | **TTSR stream rules** — regex-triggered stream-abort + retry | oh-my-pi | 250 | 2 | **A** | ✅ §48 scaffold | ⚠ |
| 32 | **Native Gemini adapter** — `google_search` + `code_execution` + `url_context` (not OpenAI-compat trap) | self | 300 | 2 | **A** | ✅ | ❌ via compat |
| 33 | **Blocks UI primitive** (Warp-style discrete message turns) | Warp | 600 | 4 | **A** | ✅ §12 P10-2 | ❌ |
| 34 | **Symbol-level LSP tools (Serena 7)** — `find_symbol`/`rename_symbol`/etc. | Serena | 900 | 6 | **A** | ⚠ scaffold | ⚠ |
| 35 | **ACP host compliance** — makes WOTANN hostable from Zed/Air/Kiro | Zed | 600 | 4 | **A** | ✅ §12 P7 | ❌ |
| 36 | **Real TurboQuant + MiniLM in <50KB bundle** — ONNX runtime web + lazy MiniLM pull | teamchong | 400 | 3 | **A** | ✅ §20 | ⚠ scaffold |
| 37 | **Agent Skills `agentskills.io` compliance** | Crush | 350 | 2 | **A** | ✅ §12 P10-5 | ❌ |
| 38 | **Superpowers dispatcher master skill** | obra | 350 | 2 | **A** | ✅ §12 P10-5 | ❌ |
| 39 | **Monitor tool (background event streaming eliminates sleep-poll)** | Claude Code | 150 | 1 | **A** | ✅ §12 P8-18 | ❌ |
| 40 | **`/fleet` parallel multi-subagent convergence + Plan Mode Shift+Tab cycle** | Copilot CLI | 800 | 5 | **A** | ✅ §32 | ⚠ dispatch has scaffold |

**Grand totals**: Items 1-25 = **~2,350 LOC net + 17 days**. Thesis
restored. Items 26-40 = **~5,500 LOC + 34 days**. Competitive parity.

---

## 6. 60-90-day race window

**Ship v0.4.0 public MVP by June 30, 2026.**

| Competitor | Public signal | Implication |
|---|---|---|
| **Claude Apps** (leaked April 12) | Full-stack builder + Recipes + embedded preview + 1-click deploy. GA probable June-Sept 2026. | Anchors "vibe-coder" narrative. WOTANN's multi-provider + iOS + free-tier story only fits the gap if visible first. |
| **Cursor 3** (April 2) | Agents Window (8 parallel), Design Mode, Await Tool, `/worktree` | Sets bar for dispatch plane UX. WOTANN Workshop must match. |
| **Google Antigravity** (April updates) | Manager Surface, Browser Sub-Agent, free Gemini 3.1 Pro tier | Validates agent-first IDE thesis. WOTANN must match Manager UI. |
| **Jules + Jules Tools CLI** (April 2026) | Plan-preview-before-exec + audio changelogs + env snapshots | Async-github flow commodity. WOTANN iOS + Voice already ahead. |
| **OpenClaw 2026.4.14** | Active-memory blocking sub-agent plugin shipped | Direct port target; WOTANN has partial scaffold. |
| **Zed ACP Registry** (Jan 28) | Open protocol makes any editor a host for any agent | WOTANN should comply → distribution multiplier. |
| **Warp Full Terminal Use** | PTY read/write, respond inside debuggers/REPLs | Pattern port; matches Shell integration thesis. |

**Ship sequence matching the window** (see §8 for full schedule):
* **Week 1**: Items 1-25 — gaps closed, orphan components wired, 5-line tests pass.
* **Week 2**: Items 26-30 — parity done.
* **Week 3-4**: Items 31-40 — port competitor moats, v0.4 public.
* **Weeks 5-6**: Polish, signing, release → v0.5 before Claude Apps GA.

---

## 7. WOTANN's genuine moats

Per the Apr 14 MASTER_AUDIT §21 plus this session's web research:

1. **iOS + Watch + CarPlay + Widgets + Siri + Share Extension** — Cursor / Windsurf / Claude Code have **zero iOS native**. OpenClaw has iOS but no bundled frontier model. This is WOTANN's deepest moat and audit confirmed it's substantive (25K LOC Swift, all 5 targets real, 21 RPCs wired).
2. **Free-tier first-class with bundled Gemma 4 (or Foundation Models on iOS 18+)** — Claude Apps will be Anthropic-locked; Cursor/Windsurf require paid subs; Codex requires OpenAI. WOTANN is the only composite that defaults free.
3. **Proof bundles** — no competitor attests completion with tests + typecheck + diff + screenshots. SealedScroll UI exists; wiring is item #3 above.
4. **11 open-model tool parsers** (once wired into adapters) — no JS competitor has this.
5. **Sub-50KB TurboQuant + MiniLM** (once real) — nobody approaches this footprint.
6. **Multi-device + multi-model + multi-surface + real verification + free tier** — composite sentence that Claude Apps / Devin / Cursor / Windsurf / Codex / Copilot CLI **cannot simultaneously claim**.

---

## 8. Execution plan — 6 waves

### WAVE 1 — "Close the S9 lies" (Days 1-3, ~400 LOC, 17 items)

Goal: every S10 audit finding that should have been closed by S9 is
closed. Every new component I built has a consumer.

* Item 1-5: Wire S9 signature orphans (Runering/CapabilityChips/
  SealedScroll/Well/FocusView).
* Item 6: SOUL.md path fix (1-line).
* Item 11: Wire capability-augmenter into adapter request pipeline.
* Item 12: Wire instruction-provenance into prompt engine.
* Item 13: memoryMiddleware consumer in runtime.
* Item 17: TaskMonitorHandler executeTask callback.
* Item 18: Delete 4 dead ghost modules (−1,819 LOC).
* Item 19: Trim 10 dead HookEvent variants from union.
* Item 22-23: 11 orphan views to palette + council palette mis-route.

**Exit gate**: every component in `src/` and `desktop-app/src/components/wotann/`
is imported by at least one non-test consumer. Typecheck + test + vite
build all green.

### WAVE 2 — "Providers made real" (Days 4-7, ~1,150 LOC, 7 items)

Goal: the "17 providers, 18 adapters, universal tools" story is verifiable
end-to-end for every named provider.

* Item 7: Bedrock SigV4 (AWS SDK converseCommand).
* Item 8: Vertex OAuth2 exchange.
* Item 9: Fallback chain extended to 18 providers.
* Item 10: format-translator Gemini path.
* Item 14: QuantizedVectorStore instantiated in runtime.
* Item 15: AccountPool 18-provider env coverage.
* Item 27: wire-level fetch-capture tests for all 18 adapters.

**Exit gate**: a capture-harness test run shows `tools` present on wire
for every adapter; Bedrock + Vertex produce a signed request header via
isolation-testable signer; fallback test runs all 18 in rotation.

### WAVE 3 — "Infrastructure truth" (Days 8-10, ~520 LOC + signing infra, 8 items)

Goal: CI doesn't lie, build is reproducible, security is audited.

* Item 16: WOTANNIntents ECDH wiring.
* Item 20: conversation-manager + project-manager — implement persistence
  or delete lying docstrings.
* Item 21: Add `npm run lint` + `c8 coverage --coverage-threshold=70` to
  CI.
* Item 24: per-command Tauri allowlist (30 capability groups).
* Item 25: Delete 14 dead Rust commands; wire 6 that have UI.
* Wave 3 extra: add `tauri-action` release job (ad-hoc sign now, prep for
  Developer ID). Commit `codesign + notarize` stubs with TODO for Apple
  ID env vars.
* Wave 3 extra: rotate Supabase anon key (manual).
* Wave 3 extra: migrate `claude-agent-sdk` from dep → peerDep.

**Exit gate**: CI fails on lint error, coverage <70%; release tag
produces signed DMG; Supabase key rotated.

### WAVE 4 — "Competitive parity" (Days 11-17, ~1,900 LOC, 8 items)

Items 26-33: ValknutSpinner sweep; Workshop/Exploit top-pill; ⌘3/⌘4;
hash-anchored CID; TTSR; native Gemini adapter; Blocks UI primitive.

**Exit gate**: one new block-dividers-chat run shows clean rule dividers
in conversation; hash-anchored edit on 3 real files succeeds with 2-char CID.

### WAVE 5 — "Moat deepening" (Days 18-28, ~3,200 LOC, 6 items)

Items 34-39: Serena symbol LSP; ACP host compliance; TurboQuant + MiniLM;
agentskills.io; superpowers dispatcher; Monitor tool.

**Exit gate**: `wotann acp serve` accepts an Initialize from Zed and
round-trips a prompt; MiniLM bundle is under 50KB post-minify; dispatcher
skill observably reduces first-attempt edits per task in a benchmark run.

### WAVE 6 — "Public-MVP polish" (Days 29-42, ~1,500 LOC + release)

* Item 40: `/fleet` parallel dispatch + Plan Mode Shift+Tab cycle.
* Adopt 15 remaining UI polish items from UX_AUDIT 2026-04-17 (CHAT-2/3/4,
  SET-KBD-1, SET-NAV-1, IOS-DEEP-1, IOS-PAIR-2, etc.).
* `runtime.ts` split into 4 files (~800 LOC each) via dependency-map agent.
* `kairos-rpc.ts` split into 5 domain files.
* TUI App.tsx split into 4.
* Apple Developer ID signing + notarization on release workflow.
* README + install.sh polish; landing page; launch post.

**Exit gate**: `npx wotann@latest install` works on a clean machine;
signed DMG from CI; v0.5.0 tag cut; Hacker News launch-ready.

### Dependency graph

```
Wave 1 ─────► Wave 2 ─────► Wave 4 ─────► Wave 5 ─────► Wave 6
                                │                         │
Wave 3 (parallel w/ W2) ────────┘                         │
                                                          ▼
                                              Release / public MVP
```

Wave 1 blocks everything (component wiring + dead-code deletion). Wave 2
unlocks "providers real" claim; Wave 3 unlocks signing; Waves 4-5 run in
parallel once W1+W2 land; Wave 6 is sequential polish.

---

## 9. What NOT to build

* **Marketplace without eval/trust** — need a quality gate first (LoB
  Cognee auto-moderation is ~3 weeks; defer).
* **Native LLM serving** — Ollama covers local; Foundation Models covers iOS.
* **Full runtime.ts big-bang rewrite** — incremental extraction only.
* **WeChat / LINE / Zalo channels** — wrong audience for v1.
* **Outcompeting Cursor on Monaco autocomplete quality**. Use good-enough
  inline completion; differentiate on multi-provider + proof + free tier.
* **Outcompeting Claude Code on 9000+ plugin count.** Agent Skills
  `agentskills.io` compliance lets WOTANN inherit cross-tool skills
  without building new ones.
* **Outcompeting Codex CLI on Rust 80 ms cold start.** TS stays.
* **Windsurf SWE-1.5-level proprietary model.** Not WOTANN's layer.
* **claude-agent-sdk hard dependency** — move to peerDep (license risk).
* **Raft consensus (from ruflo)** — over-engineered for single-daemon product.
* **`opcode` patterns** — dormant repo, skip.
* **OpenViking AGPL copy** — clean-room L0/L1/L2 is ~800 LOC if done.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Another S9-style regression** — component built without consumer | Wave 1 gate: every component has at least one non-test consumer; wire-level test per component. |
| **Claude Apps anchors narrative before we ship** | Ship v0.4 public by end of May; even if partial, visibility before public beta matters. |
| **Bedrock/Vertex SigV4/OAuth test infrastructure** | Use `localstack` for Bedrock, `@google-cloud/test-helpers` for Vertex. Isolation-testable signer + request builder separated from network I/O. |
| **`runtime.ts` / `kairos-rpc.ts` split regression** | Dedicated Opus agent with dependency-map output; split into 3 phases; full test run after each phase. |
| **Monaco worker registration** — CSP works but AMD fallback is brittle | Register workers explicitly via `MonacoEnvironment.getWorker` + copy worker bundles to public/ in Vite. |
| **iOS physical-device gap** — 18 items blocked | Batch into a single "Xcode session" when Gabriel has device + Xcode handy; don't let blocker freeze desktop progress. |
| **Quality bar #14 erosion** — false-claim commits still a pattern | Every Wave exits with a dedicated Opus adversarial audit; commit message lists "what was NOT verified". |

### Regression-prevention protocol (formalize)

1. Every new component must be imported from at least one non-test file **in the same commit**.
2. Every wire-level claim (tools, streaming, auth) must have a test that captures the real outbound payload.
3. Every hook registered must fire at least once in a `tests/integration/hooks-guarantees.test.ts` scenario.
4. Every orphan file found in audit must be deleted, wired, or explicitly demoted in `lib.ts` with a `@deprecated` + reason.
5. Every session ends with an adversarial audit by a fresh Opus agent; findings → next session's Wave 1.

---

## 11. Appendix — live evidence

Screenshots captured this session (stored in session task output dir):

| View | Observation |
|---|---|
| `tauri-chat-view` | Chat hero + 6 action tiles + composer + preset hints. **No disconnected banner** — S9 fix verified. |
| `tauri-palette-open` | 10 rows visible in grouped categories (SESSION/NAVIGATION). `⌘N` glyph on first row. Fuzzy input. **63 unique entries** (not 137 as earlier claim). |
| `tauri-editor-view` | Monaco empty state: "Select a file to edit" / "Choose from the file tree or drag files into chat" / Open Folder CTA / Terminal Search Design Outline bottom bar. **CHAT-1 CSP fix verified live.** |
| `tauri-providers` | 3 subscriptions Connected: Claude Code 2.1.114 (Pro/Max) / GitHub Copilot (Pro/Business, GitHub CLI authed) / Codex CLI 0.120.0 (ChatGPT Plus). API Keys panel for Anthropic/OpenAI/Google AI below. "Detected! Waiting for daemon to report models" status. |

Test run: 251 files, 3,922 pass / 5 fail / 6 skip — stable baseline.

Typecheck: clean on both root and desktop-app/.

Vite build: exit 0, 38 lazy chunks.

iPhone 17 Pro simulator (`6FD7BDC8-9A3B-4C81-93C0-F864445BE6DA`) booted.
WOTANN iOS install blocked on Simulator-app session grant — to continue,
user should either install an iOS device build manually via `xcrun simctl
install booted /path/to/WOTANN.app` or add Simulator to the computer-use
allowlist.

---

*This plan supersedes `MASTER_PLAN_PHASE_2.md` (Apr 13) and merges its
still-applicable items (T1.1 learning-stack verify, T2.1 @-references,
T2.3 repo-map, T3.1-5 merges) into the Top-40 leaderboard. It is the
single source of truth for session 10 execution.*
