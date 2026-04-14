# WOTANN — Complete Deep Audit and Master Plan
> Generated: April 13, 2026
> Method: 11 Opus-class agents, 235,360 lines of code read, 223 spec features checked, 38 competitor features cross-referenced, 2 industry articles analyzed
> Status: Final synthesis — all gaps identified, all items prioritized

---

## Table of Contents

1. [The Product in Numbers](#i-the-product-in-numbers)
2. [The Identity and Soul System](#ii-the-identity-and-soul-system)
3. [What's Actually Broken](#iii-whats-actually-broken)
4. [Dead Code: The Hidden Feature Surface](#iv-dead-code-the-hidden-feature-surface)
5. [Security Assessment](#v-security-assessment)
6. [Quality and Architecture](#vi-quality-and-architecture)
7. [Competitor Landscape](#vii-competitor-landscape)
8. [The Moat](#viii-the-moat)
9. [The 76-Item Master Plan](#ix-the-76-item-master-plan)
10. [Feature Merges](#x-feature-merges)
11. [What NOT to Build](#xi-what-not-to-build)
12. [Verification Gaps](#xii-verification-gaps)
13. [Execution Order](#xiii-execution-order)

---

## I. The Product in Numbers

| Layer | Files | Lines | Status |
|-------|------:|------:|--------|
| Daemon (TypeScript) | 408 | 132,557 | 99% complete by file — 404 COMPLETE, 2 partial, 2 dead |
| iOS App (Swift) | 111 | 25,245 | All views reachable except 1 (MorningBriefing) |
| Desktop App (Tauri + React) | ~160 | 33,421 | 96 Rust commands, ~40 React components |
| Tests (TypeScript) | 229 | 44,137 | 3,723 test cases, 0 Swift/Rust/React tests |
| Skills (Markdown) | 151 | 3,658 | 25% substantive, 75% minimal |
| **Total** | **~891** | **~235,360** | |

### Spec vs Reality

| Metric | V4 Spec | Actual |
|--------|---------|--------|
| Features specified | 223 | ~195 have files (~87%) |
| Features deeply implemented | — | ~165 (~74%) |
| Build phases (0-15) | 16 | All 16 have code |
| Providers | 9 paths | 11 adapters (+ 7 unbuilt) |
| Channels | 24 | ~15 implemented |
| Skills | 65+ | 151 files (but 75% minimal) |
| Middleware layers | 16 | 21 files (exceeds spec) |
| Memory layers | 8 | 8 (+ vector + graph-rag + episodic + temporal) |
| Intelligence modules | 7 overrides | 42 files (6x spec) |
| TerminalBench target | 80%+ | Techniques implemented, no scoring runner |

### Beyond Spec (Built but Never Specified)

The iOS app is the most dramatic example. The spec allocates **2 sentences** to the phone companion. The actual implementation is:

| Feature | Lines | Spec Reference |
|---------|------:|---------------|
| Full 5-tab SwiftUI iOS app | 25,245 | "Pair phone, send tasks" (2 sentences) |
| Apple Watch companion | 594 | Not mentioned |
| CarPlay integration | 349 | Not mentioned |
| Siri App Intents (3) | 165 | Not mentioned |
| iOS Widgets (2) | 331 | Not mentioned |
| Share Extension | 350 | Not mentioned |
| Live Activities / Dynamic Island | 97 | Not mentioned |
| NFC tap-to-pair | 388 | Not mentioned |
| HealthKit integration | 338 | Not mentioned |
| Biometric auth | 98 | Not mentioned |
| ECDH E2E encryption | 192 | Not mentioned |
| Voice pipeline (5 files) | 3,035 | "Push-to-talk with STT/TTS" (1 sentence) |
| Obsidian Precision design system | 40+ files | "Glass UI" never appears in spec |
| Full Tauri desktop app | 33,421 | Mentioned in passing, Phase 15 |
| LocalSend P2P file sharing | 472 | Not mentioned |
| Supabase realtime relay | 697 | Not mentioned |
| Norse mythology identity | 1 line SOUL.md | Spec uses "Nexus" throughout |

---

## II. The Identity and Soul System

The agent identity is a layered system, fully wired:

```
Layer 1: Bootstrap Files (.wotann/)
├── AGENTS.md (97 lines — runtime system prompt, capabilities, rules)
├── SOUL.md (1 line — "Germanic All-Father" identity)
├── IDENTITY.md (4 lines — name, role)
├── TOOLS.md (30 lines — 4 tool tiers)
├── MEMORY.md (17 lines — 8-layer index)
├── USER.md (4 lines — learning description)
├── HEARTBEAT.md (5 lines — KAIROS schedule)
└── BOOTSTRAP.md (29 lines — session template)

Layer 2: Prompt Engine (src/prompt/)
├── engine.ts (398 lines — assembles all parts, token budgets)
├── model-formatter.ts (268 lines — XML/JSON/markdown/minimal per model)
└── modules/ (18 files, ~850 lines total)
    ├── identity.ts (priority 100 — loads SOUL.md, builds core identity)
    ├── capabilities.ts (95 — provider-specific native vs emulated)
    ├── tools.ts (92 — dynamic 14-tool loading, mode-aware)
    ├── project.ts (90 — working dir, git branch, domain detection)
    ├── mode.ts (88 — 11 mode instruction sets)
    ├── surfaces.ts (85 — connected device capabilities)
    ├── phone.ts (82 — iOS node capabilities)
    ├── cost.ts (80 — budget awareness, warns at 60%/80%)
    ├── user.ts (75 — user profile injection)
    ├── llms-txt.ts (72 — reads project llms.txt)
    ├── memory.ts (70 — retrieved memories)
    ├── skills.ts (65 — available skill names)
    ├── safety.ts (60 — verification/security rules)
    ├── security.ts (58 — exploit mode only, MITRE ATT&CK)
    ├── conventions.ts (55 — .editorconfig + CLAUDE.md rules)
    ├── channels.ts (50 — active messaging channels)
    └── history.ts (45 — session summary, instinct hints)

Layer 3: Identity System (src/identity/)
├── persona.ts (330 lines — YAML persona loader, bootstrap assembly)
├── reasoning-engine.ts (327 lines — deductive/inductive/abductive)
└── user-model.ts (475 lines — corrections, preferences, expertise)

Layer 4: Adaptive Intelligence (src/intelligence/)
├── adaptive-prompts.ts (328 lines — 5-tier model adaptation)
├── user-model.ts (231 lines — DUPLICATE of identity version)
└── 40 more intelligence modules
```

**All 18 prompt modules: COMPLETE and WIRED. Zero gaps.**

### Issues

1. **Duplicate user models** — `identity/user-model.ts` (UserModel, 475 lines, stores to `context-tree/user/profile.json`) AND `intelligence/user-model.ts` (UserModelManager, 231 lines, stores to `user-model.json`). Different classes, different storage, both wired.
2. **SOUL.md is anemic** — Runtime version is 1 line. The `.nexus/SOUL.md` has a rich 42-line personality definition that was lost in the rename.
3. **DESIGN.md is out of sync** — Still references old violet theme (#8b5cf6), not the Obsidian Precision Apple blue (#0A84FF) from the Apr 12 redesign.
4. **Dual config directories** — `.nexus/` (dead, design-time spec) and `.wotann/` (active, runtime loads from here).

---

## III. What's Actually Broken

### Still Broken (Not Fixed in Apr 12)

| # | Issue | Impact | Severity |
|---|-------|--------|----------|
| 1 | **iOS streaming broken** — `chat.send` is synchronous, doesn't emit stream events | iOS users see no streaming | CRITICAL |
| 2 | **21 iOS RPC methods missing on daemon** — git.*, screen.*, execute, briefing.daily, meet.summarize, autonomous.cancel, config.sync, security.keyExchange, continuity.*, node.*, clipboard.inject, quickAction | Git panel, Remote Desktop, Morning Briefing, Meet, Watch, CarPlay all broken | CRITICAL |
| 3 | **Weekly cost = totalCost * 7** — multiplies today's total by 7 instead of summing actual 7 days | Cost dashboard wrong | HIGH |
| 4 | **NotificationService never triggered** — methods exist but never called | Push notifications don't fire | HIGH |
| 5 | **On-device AI deps missing from Package.swift** | On-device AI toggle does nothing | HIGH |
| 6 | **config.ts copy-paste bug (line 74-80)** — checks .wotann twice instead of .nexus | Upgrading users lose workspace | MEDIUM |
| 7 | **Companion server EADDRINUSE silently swallowed** | iOS pairing silently fails | MEDIUM |
| 8 | **5 frontend commands call non-existent Rust functions** | Silent desktop failures | MEDIUM |
| 9 | **15 "Nexus" strings in source code** (5 user-facing) | Brand inconsistency | LOW |

### Fixed in Apr 12 (Verified via Engram)

- Companion server 8 stubs → proper parameter extraction
- IDE Bridge 4 handlers → wired to runtime
- Path traversal in sandbox → realpathSync + normalize
- SSRF in web-fetch → isPrivateHost() blocklist
- SQL injection in memory → parameterized queries
- Provider routing → direct per-request params
- iOS KVS crash → optional iCloudStore
- WebSocket 16MB limit → increased
- Anthropic prompt caching → added to adapter

---

## IV. Dead Code: The Hidden Feature Surface

### Desktop: 40 of 96 Tauri Commands (42%) Are Dead

| Category | Commands | What They Do | What's Missing |
|----------|---------|-------------|---------------|
| Computer Use | 12 | Screenshots, mouse, keyboard, app approval | Zero UI — component directory empty |
| Native Input (CoreGraphics) | 9 | Zero-subprocess mouse/keyboard | No UI |
| Remote Control | 5 | Session management, git worktree isolation | No UI |
| Audio Capture | 5 | Meeting detection, recording | No UI |
| Agent Cursor Overlay | 4 | Transparent cursor window | No UI |
| LocalSend Receive | 2 | Accept incoming transfers | No UI |
| Other | 3 | Daemon connection, window toggle, IP | Unused |

### Daemon: 30+ RPC Methods Never Called

Entire LSP surface (lsp.*), training pipeline (train.*), self-evolution (evolution.pending, feedback.record, patterns.list), memory quality/fence/mine, benchmark harness, prompt adaptation, context pressure, terminal suggestions.

### The Learning Stack Is Entirely Inert

```
Normal conversation happens
  → conversations do NOT auto-persist to memory store
    → memory store has no observations
      → dream pipeline has nothing to consolidate (0/5 runs produced output)
        → instinct system has nothing to learn from
          → self-evolution has nothing to improve
            → skill forge has nothing to extract skills from

12 files in src/learning/ are COMPLETE implementations producing ZERO output.
```

---

## V. Security Assessment

| # | Issue | Severity |
|---|-------|----------|
| 1 | No authentication on daemon RPC (any local process can execute 100+ methods) | CRITICAL |
| 2 | Gemini API key in URL query param | HIGH |
| 3 | Codex JWT signature never verified | HIGH |
| 4 | Tauri CSP allows `unsafe-eval` | HIGH |
| 5 | No input sanitization on shell commands from iOS/desktop | HIGH |
| 6 | No atomic writes or file locks for concurrent agents | MEDIUM |
| 7 | Predictable temp file names | MEDIUM |
| 8 | OAuth tokens as plaintext JSON | MEDIUM |
| 9 | No rate limiting on companion WebSocket | MEDIUM |
| 10 | `config.set` writes arbitrary keys (no whitelist) | MEDIUM |

---

## VI. Quality and Architecture

### God Objects (Violate 800-Line Max)

| File | Lines | Over By |
|------|------:|--------:|
| runtime.ts | 3,639 | 4.5x |
| index.ts | 2,856 | 3.6x |
| App.tsx (TUI) | 2,367 | 3.0x |
| kairos-rpc.ts | 2,329 | 2.9x |
| companion-server.ts | 1,764 | 2.2x |
| kairos.ts | 1,610 | 2.0x |
| store.ts (memory) | 1,541 | 1.9x |

### Error Handling

**643 empty `catch {}` blocks** across 176 files. Top: kairos-rpc.ts (48), platform-bindings.ts (30), kairos.ts (28), index.ts (22), companion-server.ts (18), runtime.ts (16).

### Performance

- 158 static imports in runtime.ts, 50+ in kairos.ts
- Estimated cold start: 2-5 seconds
- Synchronous file I/O pervasive in startup
- dist/ = 12MB, 1,624 files
- Thin-client TUI is a TODO — CLI loads full 408-module runtime

### Skill Quality

- 151 files: 86 in `skills/`, 65 in `.nexus/skills/`
- 17 duplicate files with incompatible frontmatter schemas
- 75% minimal (~19 lines), 25% substantive (30+ lines)

### Infrastructure Gaps

| Item | Status |
|------|--------|
| .gitignore at root | MISSING |
| README.md | MISSING |
| CI/CD pipeline | MISSING |
| Linting/formatting | MISSING |
| .env.example | MISSING |
| LICENSE file | MISSING |
| Sidecar binaries | PLACEHOLDERS |
| npm publish | NOT DONE |
| GitHub Releases | NOT DONE |

---

## VII. Competitor Landscape

### Where WOTANN Is Ahead

| Feature | WOTANN | Best Competitor |
|---------|--------|----------------|
| Sandbox | 3-tier (Seatbelt/Docker/K8s) | Codex exec-server (1 tier) |
| Agent identity | 8-file persona + 18 prompt modules | Codex single AGENTS.md |
| Circuit breaker | 4-layer (breaker + hook + retry + pool) | deer-flow lightweight breaker |
| Provider count | 11 adapters | crush 75+ (no unified harness) |
| Memory | 8-layer + FTS5 + vector + graph-rag + episodic | MemPalace (deeper retrieval, no graph) |
| Intelligence | 42 modules, 14K lines | deepagents ~8 modules |
| Orchestration | 29 files, 6 patterns, 8 autonomous strategies | GSD wave execution (1 pattern) |
| Phone companion | Full iOS + Watch + CarPlay + Widgets + Intents | GitHub Copilot Mobile (basic) |
| Security | 15 files + sandbox + PII + anti-distillation | Codex sandboxing only |

### Where Competitors Are Ahead

| Feature | Competitor | What WOTANN Lacks |
|---------|-----------|------------------|
| Hash-anchored editing | oh-my-pi | 10x edit accuracy on weak models |
| Oracle/Worker pattern | Amp (Sourcegraph) | Interactive escalation to stronger model |
| CI feedback for background agents | Amp | Push → CI → parse → fix → repeat |
| Visual verification in agent loop | Amp (Playwright MCP) | visual-verifier.ts exists but is dead code |
| Domain-partitioned memory | MemPalace | +34% retrieval with domain/topic fields |
| Provider embeddings | Multiple | Zero providers implement embed() |
| 7 missing providers | Market parity | Mistral, DeepSeek, Perplexity, xAI, Together, Fireworks, SambaNova |
| Telemetry opt-out | serena | No DO_NOT_TRACK env var |
| Session corruption guard | crush | No image payload validation |

---

## VIII. The Moat

> "The moat is not one killer feature. The moat is a unified harness that makes every model more useful."
>
> "The provider is just the LLM call. Everything else is ours."

| # | Moat Element | Depth |
|---|-------------|-------|
| 1 | True multi-provider (no vendor lock-in) | DEEP |
| 2 | Free-tier first-class | DEEP |
| 3 | Unified intelligence layer | DEEP (42 modules) |
| 4 | Context virtualization | DEEP |
| 5 | Memory provenance | DEEP (but observation pipeline disconnected) |
| 6 | Capability equalization | DEEP |
| 7 | Proof-oriented autonomy | MODERATE (proof bundles exist, not surfaced) |
| 8 | Provider-agnostic dispatch | DEEP |
| 9 | Harness-boosted benchmarks | MODERATE (techniques wired, no scoring runner) |

---

## IX. The 76-Item Master Plan

### Organizing Principle

**Stop building new backend capabilities. Start connecting what exists to users.** The daemon is the asset. The surface layers are the bottleneck.

---

### Phase A: Fix What's Broken — Week 1

| # | Item | Effort |
|---|------|--------|
| A1 | Fix iOS streaming — route through `query` streaming, not synchronous `chat.send` | Low |
| A2 | Add ~13 missing daemon RPC methods for iOS | Medium |
| A3 | Fix weekly cost calculation — per-day persistence, sum actual 7 days | Low |
| A4 | Wire NotificationService triggers to agent state changes | Low |
| A5 | Add MLX/FoundationModels to Package.swift (or remove dead code paths) | Low |
| A6 | Create root .gitignore | Trivial |
| A7 | Fix config.ts copy-paste bug (line 74-80) | Trivial |
| A8 | Fix companion server silent port conflict | Low |
| A9 | Add session corruption guard for image payloads | Low |
| A10 | Add telemetry opt-out env var | Trivial |

### Phase B: Security — Week 1

| # | Item | Effort |
|---|------|--------|
| B1 | Daemon RPC authentication (socket perms + session token) | Medium |
| B2 | Gemini API key → header | Trivial |
| B3 | Verify Codex JWT signature | Low |
| B4 | Remove `unsafe-eval` from Tauri CSP | Low |
| B5 | Sanitize shell command input from iOS/desktop | Medium |
| B6 | Atomic writes + file locks for concurrent agents | Low |
| B7 | Route-scoped filesystem permissions | Medium |

### Phase C: Consolidate and Clean — Week 2

| # | Item | Effort |
|---|------|--------|
| C1 | Merge duplicate user models (identity/ + intelligence/) | Medium |
| C2 | Update DESIGN.md to Obsidian Precision | Low |
| C3 | Remove `.nexus/` directory | Trivial |
| C4 | Enrich `.wotann/SOUL.md` (port 42-line version) | Trivial |
| C5 | Remove deprecated code (NeverStopExecutor, send_message, session.create dup) | Low |
| C6 | Fix 5 frontend → non-existent Rust commands | Low |
| C7 | Seed dream pipeline — wire observation extraction into session lifecycle | Low |
| C8 | Fix 15 "Nexus" → "WOTANN" naming references | Low |
| C9 | Resolve 17 duplicate skill files | Low |
| C10 | Enrich top 20 minimal skills to 40+ lines | Medium |

### Phase D: Wire Dead Features — Weeks 2-3

| # | Item | What Unlocks | Effort |
|---|------|-------------|--------|
| D1 | Build Computer Use UI for desktop | 21 Rust + 9 CG commands | Medium |
| D2 | Build Council UI | Multi-model deliberation | Low |
| D3 | Wire Meet Mode activation | Audio capture accessible | Low |
| D4 | Wire MorningBriefing navigation on iOS | View reachable | Trivial |
| D5 | Wire NFC pairing button | Tap-to-pair accessible | Trivial |
| D6 | Wire Audio Capture to frontend | Meeting recording | Low |
| D7 | Wire LocalSend receive | File receiving | Low |
| D8 | Wire LSP to Symbol Outline panel | Code intelligence visible | Medium |
| D9 | Wire Training/Self-Evolution review UI | Self-improvement visible | Low |
| D10 | Wire Connectors config forms | 6 knowledge connectors | Medium |
| D11 | Wire knowledge graph into planning | Smarter plans | Low |
| D12 | Implement thin-client TUI mode | CLI → daemon IPC | Medium |
| D13 | Oracle/Worker escalation in autonomous mode | Strategic model guidance | Medium |
| D14 | CI feedback loop for background agents | Push → CI → fix → repeat | Medium |
| D15 | Wire visual-verifier into verification cascade | Visual feedback on UI edits | Low |

### Phase E: Competitive Parity — Weeks 3-4

| # | Item | Source | Effort |
|---|------|--------|--------|
| E1 | Hash-anchored editing | oh-my-pi | Medium |
| E2 | Domain-partitioned memory search | MemPalace (+34%) | Low |
| E3 | Temporal validity on graph edges | MemPalace | Low |
| E4 | Observation extraction pipeline | LoCoMo | Medium |
| E5 | 7 missing providers via openai-compat | Parity | Low |
| E6 | Tool timing in model context | Codex | Trivial |
| E7 | Debug share command | hermes-agent | Low |
| E8 | Instruction provenance tracing | Codex | Medium |
| E9 | Missing channels (IRC, Google Chat, LINE) | V4 spec | Low each |
| E10 | Named harness profiles | deepagents | Low |
| E11 | Edge TTS backend | hermes-agent | Low |
| E12 | /debug slash command across all channels | hermes-agent | Trivial |
| E13 | required_reading in agent specs | GSD | Trivial |
| E14 | POST callback for tool results | lobe-chat | Low |

### Phase F: Upgrade Existing — Week 4

| # | Item | Effort |
|---|------|--------|
| F1 | Enrich Exploit tab (security scanning UI, MITRE mapping) | Medium |
| F2 | Enrich Workshop tab (agent config, skill browser) | Medium |
| F3 | WhatsApp formatting + streaming indicators | Low |
| F4 | Ollama thinking token support | Low |
| F5 | Empty catch blocks — top 5 files (146 catches) | Medium |
| F6 | IPC connection pooling | Low |
| F7 | Per-subagent model override via YAML | Low |
| F8 | Shorter tool descriptions in test mode | Trivial |
| F9 | O(1) message lookups | Low |

### Phase G: Infrastructure — Week 5

| # | Item | Effort |
|---|------|--------|
| G1 | README.md | Low |
| G2 | GitHub Actions CI | Medium |
| G3 | ESLint + Prettier config | Low |
| G4 | .env.example | Low |
| G5 | LICENSE file (MIT) | Trivial |
| G6 | Real sidecar binaries (download-on-first-run) | Medium |
| G7 | Complete NEXUS → WOTANN rename in docs | Low |
| G8 | npm publish | Low |
| G9 | GitHub Releases with Tauri DMG | Medium |
| G10 | One-line install script | Low |
| G11 | Auth bypass convention documentation | Trivial |

---

## X. Feature Merges

### Merge 1: Identity Unification
C3 + C4 + C8 + C9 + C2 → One pass: remove .nexus/, enrich SOUL.md, fix naming, resolve skills, update DESIGN.md.

### Merge 2: Memory Intelligence
C7 + E4 + E2 + E3 → Wire observations → add domain fields → add temporal validity → activates 12 learning modules.

### Merge 3: Desktop Control
D1 + D3 + D6 → One "Desktop Control" panel: Screen Control | Meeting | Audio tabs.

### Merge 4: Background Intelligence
D13 + D14 + D15 → Oracle/Worker + CI feedback + visual verification → smart background agents.

### Merge 5: Distribution Package
G6 + G8 + G9 + G10 → Real sidecars + npm + DMG + install script → installable by anyone.

### Merge 6: Provider Expansion
E5 + E10 → 7 providers + named profiles → "fast-cheap" and "max-quality" presets.

---

## XI. What NOT to Build

| Item | Why Not |
|------|---------|
| More providers as the moat | Harness intelligence is the moat, not provider count |
| Marketplace without eval/trust | Quality gate needed first |
| More autonomy before proof bundles surfaced | Users need to SEE proof |
| FUSE-overlay isolation | Docker + Seatbelt + worktrees sufficient |
| Chrome Extension | Desktop CU handles browsers already |
| Full runtime.ts rewrite | Incremental extraction, not big-bang |
| WeChat channel | Not relevant for Toronto market |
| DiskANN vector search | TF-IDF adequate at current scale |
| Native LLM serving | Ollama covers local models |
| Cloud IDEs for agents | Pragmatic feedback > perfect environments |

---

## XII. Verification Gaps

These can only be confirmed by running the product:

| Gap | How to Verify |
|------|--------------|
| Do 3,723 tests pass? | `npm test` |
| Does iOS compile? | `xcodegen generate && xcodebuild` |
| Does Tauri build? | `cd desktop-app && npm run tauri build` |
| Does iOS pairing work? | Run daemon + desktop + iOS simulator |
| Does autonomous mode complete? | `wotann autopilot "add hello world"` |
| Is Obsidian Precision visually correct? | Launch desktop, take screenshots |
| Does voice push-to-talk work? | Enable mic, test in TUI |
| Does Arena blind mode work? | `wotann compare` with 2+ providers |

---

## XIII. Execution Order

```
Week 1:  A (fix broken) + B (security)     → Demo-ready + Release-ready
Week 2:  C (consolidate) + D1-D5 (wire)    → Clean foundation + 50+ features unlocked
Week 3:  D6-D15 (wire more) + E1-E4        → Full surface + competitive memory upgrades
Week 4:  E5-E14 (providers+) + F (polish)   → 18 providers + polished features
Week 5:  G (infrastructure)                  → Installable + team-ready
```

**Total: 76 items across 7 phases. All AI-buildable at zero developer cost.**

---

## Core Thesis

WOTANN has a 132,557-line daemon that is genuinely one of the most complete agent harness engines ever built — 42 intelligence modules, 8-layer memory, 29 orchestration strategies, 15 security systems, 15 channel adapters — but 42% of its desktop commands are dead, its learning stack is entirely inert, its iOS app calls 21 methods that don't exist, and there is no way for anyone to install it.

This plan has one job: close the gap between what the daemon can do and what a human can reach.

> "The provider is just the LLM call. Everything else is ours."
