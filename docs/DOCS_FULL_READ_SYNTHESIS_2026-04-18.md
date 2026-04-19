# Docs Full Read Synthesis — 2026-04-18

Every doc in `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/` listed in the task was read end-to-end. Findings below are the delta: what remains open or is unique vs. `MASTER_AUDIT_2026-04-18.md`, `BENCHMARK_BEAT_STRATEGY_2026-04-18.md`, `_DOCS_AUDIT_2026-04-18.md`, and `AUTONOMOUS_EXECUTION_PLAN_2026-04-18.md`.

---

## Per-Doc Summary

### AUTH.md (121 lines)
Content: Defines the WOTANN RPC authentication convention. 256-bit session token stored at `~/.wotann/session-token.json` (mode 0600), sent over WebSocket as first `auth` message. Desktop reads directly. iOS receives one-time pairing code → keychain. CLI reads token automatically. `WOTANN_AUTH_BYPASS=1` dev flag is clearly walled off with warnings. Rotation = delete file + restart engine.
Conflicts: None with newer audits. `_DOCS_AUDIT_2026-04-18` marked this "ACCURATE — KEEP."
Unique action items:
- Token file permissioning is documented but no doc verifies the `0600` mode actually applied on first creation; audit/automated test is implied but not cataloged anywhere.
- Bypass-logged-warning behavior ("daemon logs a prominent warning on every startup where bypass is enabled") is not tracked as a test in `AUTONOMOUS_EXECUTION_PLAN`.
- Cross-reference to `src/identity/` and `src/security/` implied but the ECDH wiring for WOTANNIntents (Session 10 item #16) is NOT mentioned here — AUTH.md predates that gap.

### UI_DESIGN_SPEC_2026-04-16.md (481 lines) — IMPORTANT
Content: Canonical design spec. Defines 5 named themes (Mimir's Well default, Yggdrasil light, Runestone hero, Bifrost celebration, Valkyrie exploit), 7 signature interactions (Runering, Huginn & Muninn split pane, Sealed Scroll, Capability Chips, Raven's Flight sync, Sigil Stamp, Council Mode), 3 layout innovations (Mead-Hall palette, Conversation Braids, The Well scrubber), 10 micro-interactions with exact params, 5 onboarding hooks, sound design, mobile/Watch/Widget/CarPlay specs, accessibility floor (7:1 contrast, `prefers-reduced-motion`), anti-patterns (no purple, no sparkle icon, no chat bubbles, no emoji in UI chrome), and 22 competitor patterns to port.
Conflicts with newer docs:
- Status of signature components: `MASTER_PLAN_SESSION_10` (Apr 17) flagged all 5 as orphaned; `_DOCS_AUDIT_2026-04-18` says FocusView/CapabilityChips/SealedScroll are now imported but doesn't confirm Runering or Well. `SESSION_10_STATE` says SealedScroll landed in TrustView and Well in EditorPanel — UI_DESIGN_SPEC still presents them as unbuilt targets.
- Doc self-labels via ADDENDUM as "NOT Definitive" but is nonetheless the most concrete UI handoff.
Unique action items NOT in `AUTONOMOUS_EXECUTION_PLAN_2026-04-18.md`:
1. **Huginn & Muninn split pane (§4.2)** — `⌘⇧2` dual-provider critique pane; zero mention in any subsequent audit or execution plan.
2. **Raven's Flight iOS↔desktop sync animation (§4.5)** — parabolic arc across full-screen canvas on session transfer.
3. **Sigil Stamp (§4.6)** — 4x4px gold sigil on tab + persistent 1px gold underline with hover-reveal scrub prompt.
4. **Council Mode (§4.7 `⌘⇧C`)** — structured fan-out to 3-4 providers with voting bar; KEY WORDS palette mis-routes to `compare`, but the full spec here goes beyond just "fix the mis-route."
5. **The Mead-Hall palette tiered-depth morphing (§5.1)** — three tab-key keystroke rhythm that morphs palette → plan canvas → full-canvas Miro-like surface. Execution plan has "group palette by category with MRU" but nothing on tiered-depth morphing.
6. **Conversation Braids (§5.2 `⌘⇧B`)** — 2-4 parallel threads on one canvas with per-braid cost tracking and `twist into main` merge provenance. Zero downstream mention.
7. **Five-onboarding-hooks system (§7)**: The Well of Mimir, The Summoning (4 patrons: Thor/Odin/Loki/Freya), Rune Revealed keyboard tutor, Cost Glint (paid key specular sheen), First Quest card. Execution plan mentions "3-screen first-run tour" but the Patron choice and Cost Glint hooks are unique here.
8. **In-house sound design (§8)** — 4 cues (Rune-tap, Well-hum, Wax-seal press, Wood-knock) produced at 48kHz/24-bit. Not in any execution plan.
9. **Apple Watch / Complication / CarPlay templates (§9.2-9.5)** — specific rune-state mapping (Fehu=idle, Raidho=running, Ansuz=awaiting, Tiwaz=proof-complete); CarPlay `CPListTemplate` per-patron voice; "forge rests while you drive" safety pattern.
10. **Home-screen Widgets Small/Medium/Large (§9.3)** — specific rune pulse + braid ribbon behaviors.
11. **Live Activities Dynamic Island copy-by-tool** — `reading/searching/forging/sealing` verbs.
12. **Tokens delivered as CSS + Tauri OS-native NSAppearance equivalents (§13)** — unified tokens build across platforms; `packages/motion/` for curve names. `_DOCS_AUDIT` mentions "3 separate schemes" but doesn't demand the unified build as an action.
13. **Yggdrasil light theme** — present in SettingsView "Signature palette" (per SESSION_8_HANDOFF) but contrast/paper-texture SVG noise (2% opacity, 220Hz) implementation specifics are unverified.

### UX_AUDIT_2026-04-17.md (148 lines)
Content: Live Tauri + iOS 17 Pro simulator audit. Two major bug fixes landed during audit: (1) engine disconnection — 3 compounding bugs (5s→30s socket wait; watchdog only armed on success; stale socket ghost), (2) provider picker lied — `model: "auto"` hardcoded in Rust; Ollama-only fallback when KAIROS down; no reconciliation on init; setProvider accepted invalid pairs. Findings inventory: 4 CHAT-#, 5 SET-*, 2 PAL-*, 1 QA-*, 3 IOS-PAIR-*. Top 5 for Session 9: CHAT-1 Editor ErrorBoundary, IOS-DEEP-1 pair-gated deep-link, SET-NAV-1 sidebar overflow, SET-PROV-1 empty state, Valknut codemod on 40+ animate-spin sites.
Conflicts: CHAT-1 was fixed in SESSION_9_SUMMARY (Monaco CSP); the other 4 top items remain open per `MASTER_PLAN_SESSION_10` Wave 6.
Unique action items:
- **SET-KBD-1**: Keyboard Shortcuts rebind UX should become 3-column table (Action/Current/Shortcut target). Not called out in execution plan.
- **PAL-1 MRU ordering**: execution plan item T1.1 says "group + MRU" but the UX audit specifies MRU for recent-commands float-to-top, which is different from category grouping.
- **IOS "Continue without pairing" / Explore path (IOS-DEEP-1 extension)**: `OnDeviceAI / Settings / Diagnostics / Voice / PromptLibrary` are standalone-capable; execution plan only mentions `IOS-PAIR-2` label fix.
- **Reconcile on init** + validated `setProvider` pattern — now landed but no regression test documented.

### SESSION_8_UX_AUDIT.md (546 lines)
Content: Full E2E audit of 12 AppViews + 14 legacy remaps + 14-section Settings panel + palette + 27 iOS views + cross-platform findings. Produces 52 labeled findings across TD-1 through TD-11 (Tauri), iOS-1 through iOS-3, and CP-1 through CP-5.
Conflicts: Many TD items were closed in subsequent sessions (see SESSION_9 and SESSION_10) but not marked resolved here.
Unique action items NOT in `AUTONOMOUS_EXECUTION_PLAN_2026-04-18.md`:
1. **TD-1.2 action tiles dimmed when engine down** — several tiles (Research/Compare/Check costs) work cloud-only. Needs conditional dim-logic.
2. **TD-1.3 Placeholder text should change on disconnect** — "Engine disconnected — reconnect to send."
3. **TD-1.5 Incognito pill toggle state** (outline when off, filled when on) + proximity to composer.
4. **TD-2.1 Ghost-grey send button when composer empty** — discoverability.
5. **TD-2.2 Voice button radial pulse on press-and-hold** (wire to RuneForgeIndicator).
6. **TD-2.3 @-reference composer placeholder rotation hint** or inline `@` chip.
7. **TD-3.2 Cmd+K hint repositioned into composer placeholder** (currently competes with model picker).
8. **TD-3.3 Notification bell badge wired to `toasts.length`** from `App.tsx:23`.
9. **TD-4.1 Empty-state sidebar CTA** ("Start a new chat" button inside empty state).
10. **TD-4.2 Hide search box until conversations exist.**
11. **TD-5.0 Settings modal scrim needs `backdrop-filter: blur(8px)`.** Called out in execution plan tier 5.44 (Liquid Glass HUD) but scoped differently.
12. **TD-5.0.1 Settings cross-section search bar** (macOS System Settings-style).
13. **TD-5.0.2 "Back to Chat" link in settings sidebar.**
14. **TD-5.3.1 Theme × Signature palette matrix preview** — user confusion noted.
15. **TD-5.3.2 Live font-size preview window** with "Aa" block reacting to settings.
16. **TD-6.1 Diagnostic info inline in disconnected banner** after second failed Reconnect.
17. **TD-6.2 "Run Doctor" secondary link** next to Reconnect — `runDoctor` from `store/engine.ts`.
18. **TD-7.2 Keyboard-glyph hints in every palette row** (execution plan has this partially; SET-KBD-1 in UX_AUDIT extends it to settings).
19. **TD-8.3 `?` cheatsheet overlay** — landed as `KeyboardShortcutsOverlay` per SESSION_9.
20. **TD-9.2 Cross-view breadcrumb / window title per active view.**
21. **TD-9.3 Cost Dashboard split into two IA** (Overview vs Provider Comparison) — should split views.
22. **TD-9.4 Exploit chrome should be neutral** (keep red to finding badges only).
23. **TD-10.1 Preset `sidebarEmphasis` wired** — currently "reserved for future use."
24. **iOS-1.2 AES-256-GCM footer → trust-signal chip at top** ("🔒 Encrypted end-to-end").
25. **iOS-1.3 "Or connect manually" repositioned directly under Scan Network with divider.**
26. **iOS-1.4 "Explore without pairing" path** for demo mode (OnDeviceAI + Skills browser).
27. **iOS-1.5 Step-3 "Connected" chip visual distinction** pre-connect.
28. **iOS-2.1 Deep-link post-approval landing toast** ("Need to pair first…").
29. **iOS-3.1 Consolidate 27 iOS views into 4 tabs** (Home/Work/Memory/Settings) with nested dispatch.
30. **iOS-3.2 Hardcoded font sizes → Dynamic Type** (243 sites identified; accessibility gap).
31. **iOS-3.3 Dedicated `Onboarding` view wired or removed** (currently Pairing is de-facto onboarding).
32. **CP-1 iOS brand parity** — port Valknut + RuneForge + WOTANN themes to iOS.
33. **CP-2 3-state connection indicator on both surfaces** (connected/reconnecting/offline) with unified color+copy.
34. **CP-3 3-screen first-run tour on both platforms.**
35. **CP-4 Keyboard shortcuts surfaced in UI** (discoverable cheatsheet not per-row editor).
36. **CP-5 Session-8 features promoted in Welcome rotation** (ACP/Raven/5 themes).

### SESSION_9_SUMMARY.md (165 lines)
Content: Deep-audit-driven upgrade; 6 parallel Opus audits (A1-A6). 3 commits landed: `518e38e` UI polish (9 ValknutSpinner sites, dismissible disconnect banner, empty providers CTA, Monaco CSP fix, Runering/CapabilityChips/KeyboardShortcutsOverlay components, Groq explicit registry, Perplexity tools-API, CI honesty, 3 tautological tests fixed); `c295b1d` KnowledgeGraph persistence + FocusView + SealedScroll; `a11debe` Azure URL fix + The Well timeline scrubber. Lists 14 gaps still open.
Conflicts: S9 commits declared the signature components landed; S10 MASTER_PLAN flagged them as ORPHANED (mounted/defined but no emit sites / consumers) — then S10 STATE + _DOCS_AUDIT confirm they were subsequently wired into ChatView/MessageBubble/ProofBundleDetail.
Unique action items:
- **Gap #2 Format translator Gemini path** — still open per both S9 and S10.
- **Gap #3 `memoryCandidate` consumer OR deletion** — attached by middleware, nothing reads it.
- **Gap #4 Deprecation notes in `lib.ts` for 6 dead modules** (code-mode, red-blue-testing, spec-to-ship, auto-archive, rate-limit-resume, file-type-gate) OR wire them.
- **Gap #10 12 never-fired HookEvent variants** → remove from type OR wire. (S10 says 10, not 12 — drift.)
- **Gap #11-13 iOS Live Activity `Activity.request()`, WOTANNIntents ECDH, `@Observable` migration 215 call sites** — blocked on physical device.

### SESSION_10_STATE.md (105 lines)
Content: Pre-compaction breadcrumb. Lists 24 commits delivered this session. Gives Wave 5/6 still-open work: Serena LSP wiring into `WotannRuntime.ToolDispatchDeps`, ACP host compliance (~600 LOC), superpowers dispatcher skill (~350 LOC), agentskills.io compliance (~350 LOC), Monitor tool (~150 LOC), TTSR stream rules (~250 LOC), MiniLM runtime wiring audit, native Gemini per-query enablement for google_search/code_execution/url_context. Wave 6: per-command Tauri allowlist, runtime.ts/kairos-rpc.ts/App.tsx splits, WOTANNIntents ECDH. Saved to Engram as topic_key `wotann/session-10`.
Conflicts: None material with newer audits. Confirms runtime.ts at 4,553 LOC; `_DOCS_AUDIT_2026-04-18` now says 4,724 — drift in 1 day.
Unique action items:
- **Native Gemini per-query enablement** — `UnifiedQueryOptions passthrough` for `google_search`/`code_execution`/`url_context` flags already in adapter options; needs plumbing. Execution plan item 32 mentions this but not at per-query granularity.
- **Cargo cold-start / fingerprint::calculate recursion** noted in SESSION_8_HANDOFF — impact on release build process; possible regression watchlist.

### SESSION_8_HANDOFF.md (89 lines)
Content: 11 new commits + 7 competitor ports. Lists node-side modules (C12 per-prompt override, C9 context meter, C10 Agent Profiles, C11 execution environments, C8 @terminal mention, C16 ACP stdio) + 2 Tauri adoptions (U1 theme picker, U2 ValknutSpinner). Test drift: 3903 pass / 6 skipped pre-commit → 9 flaky failures post-session (monitor-polling / stream-ordering timing).
Conflicts: Tauri vite HMR issue ("WotannThemePicker row did not render despite committed code; bundle compiled before edit landed") — unique, not tracked elsewhere.
Unique action items:
- **Tauri vite HMR investigation** — `vite.config.ts` resolver aliases, `node_modules/.vite/` stale cache, cargo-watch hopping over frontend rebuild. Could be a latent production-build gotcha.
- **Codemod matching `w-4 h-4 border-2 rounded-full animate-spin` idiom** — one-pass ValknutSpinner replacement for remaining 39 sites.
- **iOS 18 item gated on physical device + Xcode project build config** — batch-xcode-session pattern suggestion.
- **Ad-hoc signing / Magnet-phantom / osascript AX click bypass** — test environment gotcha, not in any execution plan.

### MASTER_PLAN_PHASE_2.md (97 lines)
Content: Dated 2026-04-13. Impact-per-hour priorities. Tier 1 (Verify & wire): T1.1 learning stack verify, T1.2 ambient health panel, T1.3 Proof Bundles UI, T1.4 hook system fire verification, T1.5 autopilot oracle/worker round-trip, T1.6 observation pipeline. Tier 2 (Competitive parity): T2.1 @-references, T2.2 multi-file edit preview, T2.3 repo map (Aider-style), T2.4 Plan mode, T2.5 ghost-text tab autocomplete, T2.6 Perplexity citations, T2.7 Workflows, T2.8 shadow workspace. Tier 3 (Merges): Trust UI, Integrations, Live Codebase, Smart Autopilot, Learning. Tier 4 (Refactors): runtime.ts split (then 3,639 → now 4,724), kairos-rpc.ts split (then 3,800+ → now 5,375), duplicate user-model.ts, empty catch-blocks (146 in top 5 files), dead tool files. Tier 5 (UI/UX polish): iOS Phase C/D/E, Arc-soul polish, token enforcement in CSS vars, motion system. Tier 6 (Infrastructure): codesign, GitHub Releases automation, changelog automation, TerminalBench runner, benchmark dashboard.
Conflicts with newer docs: `_DOCS_AUDIT_2026-04-18` classifies this as STALE ("runtime.ts 3,639 → NOW 4,724; kairos-rpc.ts 3,800+ → NOW 5,375"); MASTER_AUDIT_2026-04-18 LOC figure is consistent with _DOCS_AUDIT. Several items (T1.3/T2.1/T3.1/T5.6) land or partial-land in sessions 7-10 but are not marked done.
Unique action items NOT in execution plan:
1. **T1.2 Ambient health panel** — merge `ambient-awareness.ts` + file watch + codebase health + memory quality into single live desktop panel. Three subsystems exist separately.
2. **T2.2 Multi-file edit preview with accept/reject per hunk** — `MultiFileDiff.tsx` + `runtime.editBatch()` API. Execution plan has single-file Monaco/diff items; multi-file batch hunks unique.
3. **T2.5 Ghost-text tab autocomplete** — Monaco inline-completion provider in `EditorPanel`.
4. **T2.6 Perplexity citations UI chips** — adapter exists; citation chips not wired.
5. **T2.7 Workflows panel** — `workflow.list` RPC exists; `WorkflowsPanel.tsx` missing.
6. **T2.8 Shadow workspace** — isolated background agent using git worktree + `agents.spawn`.
7. **T3.1 Unified Trust UI** — proof bundle + instruction provenance + verification cascade into one panel (the three modules are wired in MASTER_PLAN_SESSION_10 Wave 1 but the unified panel concept is Phase 2-unique).
8. **T3.2 Integrations nav** — single nav for 15 channels + 6 knowledge connectors + MCP registry + skill registry.
9. **T3.3 Live Codebase merged panel** — 4 files already exist, no shared panel.
10. **T3.4 Smart Autopilot** — oracle/worker + CI feedback + visual verifier + completion oracle wired together.
11. **T3.5 Learning pipeline observable** — observation-extractor + dream + instinct + skill-forge + pattern-crystallizer visible.
12. **T4.3 Duplicate user-model consolidation** — 2 classes (identity/ + intelligence/); execution plan doesn't catalog this.
13. **T4.4 Empty catch-block cleanup** — 146 in top 5 files; execution plan mentions "643 empty catches across 176 files" in DEEP_AUDIT but not as an action.
14. **T5.5 Consistent empty/loading/error tokens** — iOS `Shimmer/Skeleton/EmptyState` pattern applied to desktop.
15. **T6.4-6.5 TerminalBench scoring runner + live leaderboard dashboard** — "validates '15-30%' claim" which `_DOCS_AUDIT_2026-04-18` flags as currently unproven.

### MASTER_PLAN_SESSION_10.md (504 lines) — IMPORTANT
Content: Top-40 leverage-per-LOC roadmap. 6 execution waves (S9-lies closing; Providers real; Infra truth; Competitive parity; Moat deepening; Public-MVP polish). Item catalog includes all S9 orphan fixes, Bedrock/Vertex real auth, fallback-chain 18-provider, format-translator Gemini, 11 orphan Tauri views → palette, Council mis-route, per-command Tauri allowlist, 14 dead Rust commands deletion, WOTANNIntents ECDH, TaskMonitorHandler executeTask wiring, memoryCandidate consumer, instruction-provenance wiring, QuantizedVectorStore instantiation, AccountPool 18-env, Bedrock SigV4 signing, etc. Regression-prevention protocol (5 mandatory rules). References `MASTER_PLAN_PHASE_2.md` as superseded.
Conflicts with `_DOCS_AUDIT_2026-04-18`:
- Claim: "S9 signature components orphaned (Runering/CapabilityChips/SealedScroll/Well/FocusView)" — `_DOCS_AUDIT_2026-04-18` says NO LONGER TRUE: FocusView at `ChatView.tsx:15`, CapabilityChips at `MessageBubble.tsx:16`, SealedScroll at `ProofBundleDetail.tsx:20`. Audit does NOT confirm Runering or Well wiring.
- Claim: "Bedrock + Vertex auth fabricated" — `_DOCS_AUDIT_2026-04-18` says NO LONGER TRUE: `bedrock-signer.ts:50-94` has real SigV4; `vertex-oauth.ts:61-90` has real RS256 JWT + OAuth2. BUT `MASTER_AUDIT_2026-04-18` still lists 4 CRITICAL Bedrock/Vertex bugs (tools dropped from body, stream parser drops tool_use events, hardcoded 5-field Vertex body). So auth is fixed but the TOOL-CALLING plumbing on top is still broken. Master-plan-session-10 oversimplified this as "auth was fake; now real."
- Claim: "Fallback chain excludes 9 of 18 providers" — `_DOCS_AUDIT_2026-04-18` says NO LONGER TRUE: all 19 providers in chain.
- Claim: "SOUL.md never loads" — `_DOCS_AUDIT_2026-04-18` says NO LONGER TRUE: identity reads workspace first, homedir fallback.
- Claim: "runtime.ts 4,553 LOC" — now 4,724 (still growing, drift in 1 day).
- Claim: "63 palette entries not 137" — `_DOCS_AUDIT_2026-04-18` counts 85 commands in `src/index.ts`; different surfaces but warrants reconciliation.
- Claim: "3,922 pass / 5 fail / 6 skip stable baseline" — SESSION_10_STATE later says "3,942 pass / 0 fail / 6 skipped"; numbers diverge even intra-session.
Unique action items still OPEN (not confirmed fixed by `_DOCS_AUDIT`):
1. **Item 1 Runering wiring to `emitRuneEvent` from `/v1/memory/save`, `memoryStore.insert`, `ObservationExtractor`** — not confirmed.
2. **Item 4 Well scrubber mounted in editor footer + `⌘⇧T` binding + `shadow.checkpoints` RPC wiring** — SESSION_10_STATE says Well mounted in `EditorPanel.tsx`; `_DOCS_AUDIT` doesn't verify. Shortcut binding likely still absent per Session 8 finding TD-8.1/8.2.
3. **Item 11 `capability-augmenter` wired into adapter request pipeline** — pure function today; zero adapter call sites.
4. **Item 12 instruction-provenance wired into prompt engine** — exported, zero callers; Session 10 commit 85015cf says "wire instruction-provenance into engine" but _DOCS_AUDIT doesn't verify consumers.
5. **Item 13 `memoryCandidate` consumer in runtime** — still attached by middleware, nothing reads it per Session 9 gap list.
6. **Item 14 `QuantizedVectorStore` instantiated when `WOTANN_ENABLE_ONNX_EMBEDDINGS=1`** — SESSION_10_STATE says already instantiated at runtime.ts:601 and verified at line 2627, but the `.addDocument` path audit is still open.
7. **Item 15 AccountPool `discoverFromEnv` 18-provider coverage** — still only 3.
8. **Item 18 Delete dead ghosts (adapter.ts DMPairingManager+NodeRegistry, tool-error-handler standalone, deferred-tool-filter, file-type-gate)** — −1,819 LOC, still there.
9. **Item 19 Remove 10 never-fired HookEvent variants from type union** — marked "advisory" in SESSION_10_STATE commit 4d41702 but NOT fully removed.
10. **Item 20 conversation-manager.ts + project-manager.ts lying docstrings** — aae86b8 "persistence-lie docstrings" touched; whether fully fixed unclear.
11. **Item 23 Council palette entry mis-route to `compare`** — `CommandPalette.tsx:306`. Status unconfirmed by newer audits.
12. **Item 24 Per-command Tauri allowlist** — WAVE 6 status, deferred.
13. **Item 25 Delete ~20 dead Rust commands** (9 CoreGraphics / 5 Remote Control / 4 Agent Cursor / 2 LocalSend receive).
14. **Item 27 Wire-level fetch-capture tests for all 18 adapters** — SESSION_10_STATE commit 7848427 claims tests-every-adapter-family added; MASTER_AUDIT_2026-04-18 still lists "Only 2 of 18 adapters have wire-level tests" → contradicting claim.
15. **Item 33 Blocks UI primitive (Warp-style)** — LANDED per bk7ldftqh commit per SESSION_10_STATE; execution plan may supersede.
16. **Item 38 Superpowers dispatcher master skill (~350 LOC)** — wave 5.
17. **Item 40 `/fleet` parallel multi-subagent convergence + Plan Mode Shift+Tab cycle** — wave 6.

### MASTER_PLAN_SESSION_10_ADDENDUM.md (106 lines)
Content: After-triple-check addendum. Adds items 41-50 to Top-40 leaderboard: MemPalace drawer layer, domain/topic partitioning (+34% retrieval), L0/L1/L2/L3 progressive context loading, conversation mining (import past Claude/ChatGPT/Slack), better-harness TOML-driven pattern (deepagents), sub-250ms first paint, `/skill:name` dispatch, Monaco explicit worker registration, iOS IOS-PAIR-2 label truncation + IOS-DEEP-1 pair-gate, OpenClaw 560-skill library survey. Notes Hermes 100-commit delta needs fresh audit before Wave 5. Revised Wave 1 appends W1-18 (SOUL path), W1-19 (Monaco worker registration), W1-20 (council palette mis-route).
Conflicts: None direct. `_DOCS_AUDIT_2026-04-18` says SOUL.md path is fixed; Monaco CSP fix landed per SESSION_9 but explicit-worker-registration separate from CSP is still valid.
Unique action items NOT in `AUTONOMOUS_EXECUTION_PLAN_2026-04-18.md`:
1. **Item 41 MemPalace drawer raw verbatim storage** alongside structured blocks — 250 LOC, search-summaries-return-originals pattern.
2. **Item 42 Domain/topic metadata partitioning** on MemoryEntry (+34% retrieval pre-search filter). Execution plan Tier 3.7 mentions "project/task scope columns" but that's different from domain/topic hierarchy.
3. **Item 43 L0/L1/L2/L3 progressive context loading** (~170 tokens wake-up, deeper on-demand). Execution plan Tier 3.5 has "contextual embeddings step" but not the 4-level ladder.
4. **Item 44 Conversation mining import tool** — Claude/ChatGPT/Slack exports → memory store.
5. **Item 45 better-harness TOML-driven autonomous optimization** — train/holdout eval + proposer workspace pattern.
6. **Item 46 Sub-250ms first paint** — deferred imports, markdown prewarming, reduced health-poll intervals.
7. **Item 47 `/skill:name` slash dispatch + `--skill` startup flag.**
8. **Item 48 Monaco explicit worker registration** — `self.MonacoEnvironment.getWorker = ...` + copy worker bundles to `public/`. (CSP fix is different from explicit registration.)
9. **Item 50 OpenClaw 560-skill survey for 10-20 candidates.**

### DEEP_AUDIT_2026-04-13.md (515 lines)
Content: 11-agent audit of 235,360 LOC. Sections: product numbers (iOS spec allocates 2 sentences but implementation is 25,245 LOC with Watch/CarPlay/Widgets/Siri/Share/LocalSend/Supabase relay — wildly beyond spec); identity and SOUL system (18-module prompt engine complete); issues still broken (iOS streaming, 21 missing daemon RPCs, weekly cost=totalCost*7, NotificationService unwired, OnDevice AI deps missing from Package.swift, config.ts copy-paste bug, silent companion-server EADDRINUSE, 5 frontend→non-existent Rust commands, 15 Nexus strings); 40 of 96 Tauri commands dead; 30+ RPC methods never called; entire learning stack inert (12 files with zero output); security assessment (10 items CRIT→MED); god-objects table; empty catch blocks 643 across 176 files; 75% of 151 skills are minimal; infrastructure gaps (no .gitignore, README, CI, linting, .env.example, LICENSE); competitor landscape (hash-anchored editing, oracle/worker, CI feedback, visual verification, domain-memory partition, embeddings, 7 missing providers, telemetry opt-out, session corruption guard); 8-element moat; 76-item master plan across Phases A-G (fix broken, security, consolidate, wire dead features, competitive parity, upgrade existing, infrastructure); 6 feature merges; what-not-to-build list.
Conflicts with newer docs: Marked STALE by `_DOCS_AUDIT_2026-04-18` ("235,360 LOC / 11 adapters / 16 channels / 42 intel files / 3,723 tests stale"). Many Phase A items (A1-A8) were fixed per subsequent sessions. Phase B items mostly still open per MASTER_AUDIT_2026-04-18. Phase D (wire dead features) is the richest unmined source.
Unique action items NOT in `AUTONOMOUS_EXECUTION_PLAN_2026-04-18.md` or other newer docs:
1. **A3 Weekly cost = totalCost * 7 bug** — per-day persistence + sum actual 7 days. Specific bug; unique fix.
2. **A4 NotificationService triggers wired to agent state changes** — methods exist, never called.
3. **A5 MLX/FoundationModels in Package.swift** OR remove dead code paths.
4. **A6 Root `.gitignore`** — MISSING per MASTER_AUDIT_2026-04-18.
5. **A7 config.ts copy-paste bug (line 74-80)** — checks .wotann twice instead of .nexus; upgrading users lose workspace.
6. **A8 Silent port conflict in companion server (EADDRINUSE swallowed)** — pairing silently fails.
7. **A9 Session corruption guard for image payloads.**
8. **A10 Telemetry opt-out env var** — DO_NOT_TRACK.
9. **B1 Daemon RPC authentication: socket perms + session token** — session token documented in AUTH.md but audit says daemon RPC still unauthenticated.
10. **B2 Gemini API key in URL query param** — should be header.
11. **B3 Codex JWT signature verification** — never verified.
12. **B4 Remove `unsafe-eval` from Tauri CSP** — needed for Monaco but is a known HIGH issue.
13. **B5 Shell command input sanitization from iOS/desktop.**
14. **B6 Atomic writes + file locks for concurrent agents.**
15. **B7 Route-scoped filesystem permissions.**
16. **C1 Merge duplicate user-model (identity/ + intelligence/)** — 2 classes, 2 storage paths.
17. **C2 DESIGN.md still references old violet theme (#8b5cf6)** — out of sync with Obsidian Precision Apple blue (#0A84FF).
18. **C3 Remove `.nexus/` directory.**
19. **C4 Port 42-line SOUL.md persona into `.wotann/`** (currently 1 line).
20. **C5 Remove deprecated code (NeverStopExecutor, send_message, session.create dup).**
21. **C6 Fix 5 frontend → non-existent Rust commands.**
22. **C7 Seed dream pipeline** — wire observation extraction into session lifecycle.
23. **C8 Fix 15 "Nexus" → "WOTANN" naming references** (5 user-facing).
24. **C9 Resolve 17 duplicate skill files.**
25. **C10 Enrich top 20 minimal skills to 40+ lines.**
26. **D1 Build Computer Use UI** — 21 Rust + 9 CoreGraphics commands dead.
27. **D2 Build Council UI** — was palette-routed wrong; needs dedicated UI.
28. **D3 Wire Meet Mode activation.**
29. **D4 Wire MorningBriefing navigation on iOS.**
30. **D5 Wire NFC pairing button.**
31. **D6 Wire Audio Capture to frontend.**
32. **D7 Wire LocalSend receive.**
33. **D8 Wire LSP to Symbol Outline panel.**
34. **D9 Wire Training/Self-Evolution review UI.**
35. **D10 Wire Connectors config forms** — 6 knowledge connectors.
36. **D11 Wire knowledge graph into planning** — smarter plans.
37. **D12 Thin-client TUI mode** — CLI → daemon IPC (today CLI loads full 408-module runtime).
38. **D13 Oracle/Worker escalation in autonomous mode.**
39. **D14 CI feedback loop for background agents** — push→CI→parse→fix→repeat.
40. **D15 Wire visual-verifier into verification cascade.**
41. **E3 Temporal validity on graph edges (MemPalace-style).**
42. **E4 Observation extraction pipeline (LoCoMo).**
43. **E6 Tool timing in model context (Codex).**
44. **E7 Debug share command (hermes-agent).**
45. **E9 IRC/Google Chat/LINE channels.**
46. **E10 Named harness profiles (deepagents "fast-cheap" / "max-quality").**
47. **E11 Edge TTS backend.**
48. **E12 `/debug` slash command across all channels.**
49. **E13 `required_reading` in agent specs (GSD).**
50. **E14 POST callback for tool results (lobe-chat).**
51. **F1 Enrich Exploit tab (security scanning UI, MITRE mapping).**
52. **F2 Enrich Workshop tab (agent config, skill browser).**
53. **F3 WhatsApp formatting + streaming indicators.**
54. **F4 Ollama thinking token support.**
55. **F5 Empty catch-block cleanup top 5 files (146 catches).**
56. **F6 IPC connection pooling.**
57. **F7 Per-subagent model override via YAML.**
58. **F9 O(1) message lookups.**
59. **G5 LICENSE file (MIT).**
60. **G6 Real sidecar binaries** — download-on-first-run, not placeholders.
61. **G10 One-line install script.**
62. **G11 Auth bypass convention doc** — AUTH.md now exists; ensure referenced from README.

### repo-updates-2026-04-09.md (193 lines)
Content: Tracked competitor repo deltas since 2026-03-29. Biweekly tier (11 repos): spec-kit v0.5.1 fleet extension v1.1.0; Scrapling v0.4.5; LightRAG v1.4.13 JWT alg-none fix (GHSA-8ffj-4hx4-9pgf); claude-subconscious v2.1.1 MiniMax M2.7 + TTY crash fix; openclaw-master-skills v0.8.0 560+ skills; BMAD-METHOD llms.txt + epic context compilation; lightpanda 0.2.8 non-UTF-8 encoding. Monthly tier: AutoGPT hardening (SafeJson, User RPC forward-compat), mem0 hallucinated-ID guard, sentry-mcp replay summaries + stdio smoke tests, mission-control multi-runtime (hermes/openclaw/claude/codex/custom), claude-howto sonnet-4-5→4-6 rename + MCP transport clarification (no WebSocket), OpenSpec ForgeCode support, prompt-master Cline profile.
Conflicts: None direct. `_DOCS_AUDIT_2026-04-18` says all 2026-04-* research docs use NEXUS not WOTANN — this file uses WOTANN, so cleaner than the dated research docs.
Unique action items NOT in execution plan:
1. **LightRAG JWT alg-none vulnerability check** — audit WOTANN's JWT paths (Codex adapter) for same class of bug.
2. **sonnet-4-5 → sonnet-4-6 model-ID rename** — check WOTANN for hardcoded sonnet-4-5 references.
3. **MCP transport reality check** — stdio/sse/http only (no WebSocket). Verify WOTANN's MCP integration doesn't assume WebSocket.
4. **mem0 LLM-hallucinated ID guard pattern** — defensive pattern for memory UUID lookups; directly applicable to WOTANN memory store.
5. **Azure OpenAI response_format forwarding** — from mem0 fix; verify WOTANN's Azure adapter (already under scrutiny per MASTER_AUDIT_2026-04-18).
6. **Mission-control `runtime_type` enum** — multi-runtime agent support (hermes/openclaw/claude/codex/custom) pattern for WOTANN's agent orchestration.
7. **OpenSpec ForgeCode tool support** — new code generation tool to evaluate.
8. **Sentry MCP replay summaries** — pattern for enriching issue context.
9. **OpenClaw 560+ skills survey** — already in Session 10 addendum item 50.

### research-repo-updates-2026-04-09.md (429 lines)
Content: Deep dive into 10 research repos since 2026-03-29. deepagents 40+ commits: langchain-repl middleware, better-harness example (Karpathy autoresearch pattern, train/holdout splits, proposer workspace, TOML experiments), `/skill:name` + `--skill` flag, sub-250ms first paint, notification settings widget, auto-update lifecycle, themes system, LLM-powered eval failure analysis. deer-flow 27 commits: PyMuPDF4LLM PDF pipeline, document-outline injection, sandbox hardening (compound-command splitting, input sanitization), per-agent skill filtering (`available_skills` param), new skills (academic-paper-review, code-documentation, newsletter-generation), WeCom channel (394 lines), read-only sandbox paths, native grep/glob tools, Langfuse tracing, loop detection via stable hash keys, memory middleware improvements (case-insensitive dedup, positive-reinforcement detection). hermes-agent 100 commits re-cloned: unified spawn-per-call execution, context compression constants + tiered pressure warnings + gateway dedup, Voxtral STT + Qwen OAuth providers, Discord forum channel topic inheritance + reply-to mode, Telegram reactions + group_topics + proxy, Feishu interactive card approval, Slack thread engagement + approval buttons, OpenRouter variant tag preservation (`:free`, `:extended`, `:fast`), conversation history in `/v1/runs`, thinking-only prefill, SuperMemory multi-container, cron delivery failure tracking. oh-my-openagent 187 commits v3.16.0: atomic config migration (temp-file + rename), tmux isolation grace periods, plugin consolidation, MCP fixes (disabled server overrides, missing Tavily graceful, Claude Code .mcp.json collision warnings), archive preflight security (tar hard-link validation), tool_use/tool_result pair validator. agents: block-no-verify plugin, documentation-standards HADS plugin, marketplace.json. ruflo: DiskANN vector backend, LongMemEval benchmark, Claude Code → AgentDB bridge, native ruvllm + graph-node intelligence backends, ESM migration. open-swe: proxy auth for git, minimal diff rules + scope planning (reverted), Pygments ReDoS + PyJWT fixes. Cross-cutting patterns: skill dispatch via slash commands, universal sandbox hardening, context-awareness in every layer, autonomous improvement loops, MCP as standard integration, performance via deferred imports.
Conflicts: Session 10 addendum cites this file for items 45-47 (better-harness, sub-250ms, /skill:name). MASTER_AUDIT_2026-04-18 cites hermes-agent for items 22-23 (thread/fork, thread/rollback) but the 100-commit delta is flagged as "needs fresh agent before Wave 5" in addendum.
Unique action items NOT in execution plan:
1. **Hermes 100-commit fresh audit before Wave 5** — addendum explicitly calls this out; execution plan does not schedule.
2. **deer-flow `available_skills` per-agent skill filter API** — clean minimal API pattern for WOTANN skill dispatch.
3. **deer-flow loop detection via stable hash keys for tool calls** — agent-loop problem solver directly applicable.
4. **deer-flow document-outline injection into agent context** — useful for Workshop tab (file context).
5. **deer-flow built-in grep/glob tools in sandbox** — validates WOTANN's file search plan.
6. **deer-flow positive-reinforcement detection in memory middleware** — novel pattern, no WOTANN equivalent.
7. **hermes-agent spawn-per-call execution isolation model** — clean per-invocation isolation, directly relevant.
8. **hermes-agent tiered context pressure warnings with gateway deduplication** — simple high-value feature.
9. **hermes-agent Voxtral Transcribe STT (Mistral)** — new STT provider.
10. **hermes-agent Qwen OAuth with portal-request support** — new provider auth path.
11. **hermes-agent Discord forum channel topic inheritance** — thread session quality.
12. **hermes-agent Telegram reactions + group_topics skill binding** — supergroup forum support.
13. **hermes-agent Slack thread engagement + approval buttons** — human-in-the-loop pattern for WOTANN channels.
14. **hermes-agent OpenRouter variant tag preservation** (`:free`, `:extended`, `:fast`) — relevant when WOTANN routes via OpenRouter.
15. **hermes-agent thinking-only prefill continuation** — structured reasoning.
16. **hermes-agent SuperMemory multi-container support** — search mode, identity templates, env overrides.
17. **hermes-agent cron delivery failure tracking + media file native-attachment delivery.**
18. **hermes-agent consolidated security hardening** — SSRF, timing attacks, tar traversal, credential leakage all in one audit.
19. **hermes-agent persistent sandbox envs survive between turns.**
20. **oh-my-openagent atomic config migration pattern** (temp-file + rename).
21. **oh-my-openagent `tool_use/tool_result` pair validator** — defensive; prevents malformed API calls.
22. **oh-my-openagent archive preflight** — tar hard-link validation.
23. **oh-my-openagent background agent bounded abort waits.**
24. **agents `marketplace.json` manifest** — pattern for WOTANN plugin/skill discovery.
25. **agents HADS documentation standard** — could inform WOTANN doc automation.
26. **ruflo Claude Code → AgentDB memory bridge via MCP** — memory architecture pattern.
27. **ruflo LongMemEval benchmark harness** — long-term memory evaluation.
28. **open-swe proxy-based git auth** — sandboxed environment pattern (no credential files).
29. **open-swe minimal diff rules + scope planning experiment** — constraining diff-size heuristic.

---

## New Findings (not in MASTER_AUDIT_2026-04-18 nor execution plan)

1. **Tauri vite HMR cache regression** — WotannThemePicker edit did not reach the running bundle despite commit landing (SESSION_8_HANDOFF); root cause in `node_modules/.vite/` stale cache or cargo-watch race. Production-build impact unknown. No test or monitoring catches this.
2. **Cargo fingerprint::calculate recursion stall in release build** — 473-crate dep graph triggers slow build; SESSION_8_UX_AUDIT notes Tauri release `.app` build timed out. No mitigation or CI time-limit tracked.
3. **Codemod opportunity**: remaining ~39 `animate-spin` sites matching `w-4 h-4 border-2 rounded-full animate-spin` idiom. One codemod pass replaces all. Execution plan has no codemod tooling.
4. **AUTH.md → AUTH 0600 mode test** — file permission enforcement is documented but not asserted in any test.
5. **AUTH.md → session-token rotation iOS re-pairing prompt** — iOS app must prompt for new pairing code after rotation. No integration test for this flow.
6. **WOTANN theme picker brand propagation to iOS** — SESSION_8_UX_AUDIT CP-1 says iOS lacks signature iconography; UI_DESIGN_SPEC §9 specifies full iOS Watch/Widgets/CarPlay theming but nothing in execution plan allocates effort. Combined gap is much larger than just "port Valknut to iOS."
7. **UI_DESIGN_SPEC §4.2 Huginn & Muninn twin-raven split pane (`⌘⇧2`)** — single most distinctive interaction in the design spec, zero downstream reference.
8. **UI_DESIGN_SPEC §4.5 Raven's Flight iOS↔desktop sync animation** — opt-in delight on cross-device session transfer. No catalog.
9. **UI_DESIGN_SPEC §4.6 Sigil Stamp persistent gold underline** — per-file shadow-git affordance; design spec complete, no implementation mentioned anywhere.
10. **UI_DESIGN_SPEC §5.2 Conversation Braids (`⌘⇧B`)** — multi-thread canvas with cost tracking per braid; not on any roadmap.
11. **UI_DESIGN_SPEC §7.2 Patron Summoning onboarding (Thor/Odin/Loki/Freya config presets)** — 4-card preset fan; unique IA concept.
12. **UI_DESIGN_SPEC §7.4 Cost Glint specular sheen** — paid-key moment-of-delight.
13. **UI_DESIGN_SPEC §8 In-house sound design** — 4 WAV cues at 48kHz/24-bit; location mentioned (`apps/desktop/src-tauri/resources/sfx/`) but no tracked work.
14. **UI_DESIGN_SPEC §9.2 Apple Watch complication rune-state mapping** (Fehu/Raidho/Ansuz/Tiwaz).
15. **UI_DESIGN_SPEC §9.4 Live Activities / Dynamic Island tool-verb copy** (reading/searching/forging/sealing).
16. **UI_DESIGN_SPEC §9.5 CarPlay safety pattern** — "forge rests while you drive"; tool execution suspended, read/plan only.
17. **MASTER_PLAN_PHASE_2 T1.2 Ambient health panel** — unique merge concept of file watch + codebase health + memory quality subsystems.
18. **MASTER_PLAN_PHASE_2 T2.5 Monaco ghost-text tab autocomplete** — inline-completion provider; nowhere else.
19. **MASTER_PLAN_PHASE_2 T2.7 Workflows panel UI** — RPC exists, panel missing.
20. **MASTER_PLAN_PHASE_2 T2.8 Shadow workspace** — isolated background agent via worktree + agents.spawn.
21. **MASTER_PLAN_PHASE_2 T3.1-T3.5 five merges** — Trust UI, Integrations, Live Codebase, Smart Autopilot, Learning — each combines existing modules.
22. **MASTER_PLAN_PHASE_2 T4.3 Duplicate user-model consolidation** — identity/user-model.ts (475 LOC) vs intelligence/user-model.ts (231 LOC).
23. **MASTER_PLAN_PHASE_2 T6.4-6.5 TerminalBench scoring runner + benchmark dashboard** — validates the "+15-30%" claim that `_DOCS_AUDIT_2026-04-18` flags as currently unproven.
24. **DEEP_AUDIT A3 Weekly cost = totalCost * 7** — multiplication bug, unique.
25. **DEEP_AUDIT A4 NotificationService unwired** — methods exist, never called.
26. **DEEP_AUDIT A7 config.ts copy-paste bug (line 74-80)** — checks .wotann twice; upgrading users lose workspace.
27. **DEEP_AUDIT A8 Silent port conflict EADDRINUSE** — iOS pairing silently fails.
28. **DEEP_AUDIT A10 Telemetry DO_NOT_TRACK env var.**
29. **DEEP_AUDIT B1 Daemon RPC socket perms + session token wiring** — AUTH.md documents the convention but DEEP_AUDIT says actual wiring insufficient.
30. **DEEP_AUDIT B2 Gemini API key in URL query param** — HIGH security, easy fix.
31. **DEEP_AUDIT B3 Codex JWT signature unverified.**
32. **DEEP_AUDIT B4 Tauri CSP `unsafe-eval`** — needed for Monaco AMD fallback per SESSION_9; should be replaced with explicit worker registration per Session 10 addendum item 48.
33. **DEEP_AUDIT B6 Atomic writes + file locks for concurrent agents.**
34. **DEEP_AUDIT C4 Port 42-line SOUL.md persona** (still anemic 1-liner); identity path fix landed but content enrichment separate.
35. **DEEP_AUDIT C7 Dream pipeline seed** — wire observation extraction into session lifecycle.
36. **DEEP_AUDIT C8 15 "Nexus" references** (5 user-facing).
37. **DEEP_AUDIT D1-D15 Wire 15 dead features to UI** — Computer Use UI, Council UI, Meet Mode, MorningBriefing, NFC pairing, Audio Capture, LocalSend receive, LSP to Symbol Outline, Training/Self-Evolution review, Connectors config forms, KG into planning, thin-client TUI, Oracle/Worker, CI feedback loop, visual-verifier.
38. **DEEP_AUDIT E9 IRC/Google Chat/LINE channels** — V4 spec lists, not implemented.
39. **DEEP_AUDIT E10 Named harness profiles (deepagents)** — "fast-cheap" and "max-quality" presets.
40. **DEEP_AUDIT E11 Edge TTS backend.**
41. **DEEP_AUDIT E12 `/debug` slash command across channels.**
42. **DEEP_AUDIT E13 `required_reading` in agent specs (GSD).**
43. **DEEP_AUDIT E14 POST callback for tool results (lobe-chat).**
44. **DEEP_AUDIT F3 WhatsApp formatting + streaming indicators.**
45. **DEEP_AUDIT F4 Ollama thinking-token support** — partial in Session 8/9.
46. **DEEP_AUDIT F6 IPC connection pooling.**
47. **DEEP_AUDIT F7 Per-subagent model override via YAML.**
48. **DEEP_AUDIT G10 One-line install script.**
49. **repo-updates LightRAG JWT alg-none vulnerability class check** — audit WOTANN for similar (Codex adapter JWT).
50. **repo-updates sonnet-4-5 → sonnet-4-6 model-ID rename audit** — check hardcodes.
51. **repo-updates MCP transport reality check** — stdio/sse/http only; no WebSocket. Verify WOTANN MCP.
52. **repo-updates mem0 LLM-hallucinated ID guard** — defensive UUID lookup pattern.
53. **repo-updates mission-control `runtime_type` enum** — multi-runtime agent support.
54. **research-repo-updates deepagents `/skill:name` + `--skill` flag** — in Session 10 addendum as item 47, not in execution plan.
55. **research-repo-updates deer-flow `available_skills` per-agent skill filter** — clean API pattern.
56. **research-repo-updates deer-flow loop detection via stable hash keys.**
57. **research-repo-updates deer-flow document-outline injection** for Workshop tab.
58. **research-repo-updates deer-flow positive-reinforcement detection in memory** middleware.
59. **research-repo-updates hermes-agent spawn-per-call execution isolation.**
60. **research-repo-updates hermes-agent tiered context pressure warnings + gateway dedup.**
61. **research-repo-updates hermes-agent Voxtral STT + Qwen OAuth providers.**
62. **research-repo-updates hermes-agent Discord/Telegram/Slack thread + approval features** — multi-platform human-in-the-loop.
63. **research-repo-updates hermes-agent OpenRouter variant-tag preservation (`:free`/`:extended`/`:fast`).**
64. **research-repo-updates hermes-agent thinking-only prefill continuation.**
65. **research-repo-updates hermes-agent SuperMemory multi-container.**
66. **research-repo-updates hermes-agent 100-commit fresh audit pending** (addendum explicit, no scheduled slot).
67. **research-repo-updates oh-my-openagent atomic config migration** (temp-file + rename).
68. **research-repo-updates oh-my-openagent `tool_use/tool_result` pair validator** — malformed-API prevention.
69. **research-repo-updates oh-my-openagent tar hard-link preflight validation.**
70. **research-repo-updates agents `marketplace.json`** — plugin/skill discovery pattern.
71. **research-repo-updates agents HADS doc standard.**
72. **research-repo-updates ruflo Claude Code → AgentDB memory bridge via MCP.**
73. **research-repo-updates ruflo LongMemEval benchmark harness.**
74. **research-repo-updates open-swe proxy-based git auth** (no credential files in sandbox).
75. **research-repo-updates open-swe minimal diff rules / scope planning** — experimental constraint.
76. **UX_AUDIT_2026-04-17 SET-KBD-1 3-column shortcut table.**
77. **UX_AUDIT_2026-04-17 PAL-1 MRU float-to-top** (distinct from palette category grouping).
78. **UX_AUDIT_2026-04-17 iOS Continue-without-pairing Explore path** — surface standalone-capable views (OnDeviceAI/Settings/Diagnostics/Voice/PromptLibrary).
79. **SESSION_8_UX_AUDIT 36 findings** — most are catalog-unique (complete list in per-doc summary above).
80. **SESSION_8_HANDOFF Codemod for 39 remaining animate-spin sites** — single-pass Valknut sweep.

---

## Conflicts Detected Between Docs

1. **Signature component status** — MASTER_PLAN_SESSION_10 (Apr 17) says Runering/CapabilityChips/SealedScroll/Well/FocusView are orphans. `_DOCS_AUDIT_2026-04-18` verifies FocusView/CapabilityChips/SealedScroll now imported; Runering and Well NOT verified. SESSION_10_STATE claims Well mounted in EditorPanel and SealedScroll in TrustView — partial support. Execution plan assumes Wave 1 closed this.
2. **Bedrock/Vertex auth status** — MASTER_PLAN_SESSION_10 "auth fabricated"; `_DOCS_AUDIT_2026-04-18` "NO LONGER TRUE — real SigV4 / real OAuth2"; BUT `MASTER_AUDIT_2026-04-18` lists 4 CRITICAL Bedrock/Vertex bugs in tool-calling plumbing (body omits toolConfig, regex parser ignores toolUse events, hardcoded 5-field body, stream parser only emits text_delta). So: AUTH fixed, TOOLS still broken — the two audits describe different layers of the same stack and both are correct partially.
3. **Fallback-chain status** — MASTER_PLAN_SESSION_10 "excludes 9 of 18"; `_DOCS_AUDIT_2026-04-18` "all 19 in chain"; MASTER_AUDIT_2026-04-18 doesn't contradict. Resolved: fixed.
4. **SOUL.md path** — MASTER_PLAN_SESSION_10 "reads from `$HOME/.wotann/` only"; `_DOCS_AUDIT_2026-04-18` "reads workspace first, homedir fallback" — fixed.
5. **Provider count drift** — CLAUDE.md 11, README/CHANGELOG 17, MASTER_AUDIT_2026-04-14 17, MASTER_AUDIT_2026-04-18 19, DECISIONS D29 10. Actual 19. Every doc is wrong on this number except the latest MASTER_AUDIT.
6. **Middleware layer drift** — CLAUDE.md 16, CHANGELOG 26, code comments 24 AND 25. Actual 25.
7. **Hook event drift** — README/CHANGELOG/CLAUDE.md "19-event hook engine"; actual 9 fire, 10 advisory. SESSION_9 says "12 never-fired"; SESSION_10 says 10. Numerical drift between session docs too.
8. **Channel count drift** — README diagram 14, README table 16, CHANGELOG 15 (with 16 listed), CLAUDE.md 15 (with 16 listed), DEEP_AUDIT 15, MASTER_AUDIT_2026-04-14 17 (via `src/channels/*.ts` count), MASTER_AUDIT_2026-04-18 16. Actual 16.
9. **Test count drift across sessions** — CHANGELOG 3,723; MASTER_AUDIT_2026-04-14 3,659; SESSION_8_HANDOFF 3,903; SESSION_9_SUMMARY 3,922; SESSION_10_STATE 3,942. 5 different numbers. No doc reconciles.
10. **runtime.ts LOC drift** — MASTER_PLAN_PHASE_2 (Apr 13) 3,639; MASTER_PLAN_SESSION_10 4,553; `_DOCS_AUDIT_2026-04-18` 4,724. Growing ~1 day ~170 LOC.
11. **kairos-rpc.ts LOC** — MASTER_PLAN_PHASE_2 3,800+; SESSION_9 5,375; `_DOCS_AUDIT_2026-04-18` 5,375 (stable).
12. **CLI commands** — README/CONTRIBUTING 78; MASTER_AUDIT_2026-04-14 96; MASTER_AUDIT_2026-04-18 85. `_DOCS_AUDIT_2026-04-18` verifies 85.
13. **Palette entry count** — SESSION_8_UX_AUDIT 137; MASTER_PLAN_SESSION_10 63 ("not 137 as earlier claim"). Likely changed — grouped vs total; unclear.
14. **Skills count** — Spec 65+; DEEP_AUDIT 151 (86 + 65 dupes); MASTER_AUDIT_2026-04-14 86; `_DOCS_AUDIT_2026-04-18` 87. Drift.
15. **Wire-level adapter tests** — MASTER_PLAN_SESSION_10 "Only 2 of 18 have tests"; SESSION_10_STATE commit 7848427 "wire-level tools tests every adapter family"; MASTER_AUDIT_2026-04-18 still lists "Only 2 of 18 have wire-level tests." Direct contradiction; audit may predate commit or commit may be partial.
16. **D20 vs D25 (DECISIONS.md)** — D20 prescribes model degradation (opus→sonnet→haiku); D25 prescribes NEVER degrade. Both unflagged per `_DOCS_AUDIT_2026-04-18`.
17. **TerminalBench "+15-30%" claim** — TERMINALBENCH_STRATEGY presents as measured; `_DOCS_AUDIT_2026-04-18` and MASTER_PLAN_PHASE_2 T6.4 mark unproven (no in-tree benchmark runner).
18. **CSP `unsafe-eval`** — DEEP_AUDIT B4 "remove"; SESSION_9 "added for Monaco worker compatibility." Direct tension unresolved; Session 10 addendum item 48 points toward explicit-worker-registration as the resolution.
19. **Council palette route** — MASTER_PLAN_SESSION_10 "mis-routes to compare"; Session 10 addendum item W1-20 slates fix. Current status unverified.
20. **MASTER_PLAN_PHASE_2 marked SUPERSEDED by MASTER_PLAN_SESSION_10** but `_DOCS_AUDIT_2026-04-18` flags Phase_2 as STALE-UPDATE not DELETE, meaning several Phase_2 Tier 2/3/5 items remain unmerged into Session 10 plan (verified above in per-doc summary).
21. **Supabase anon key exposure** — GAP_AUDIT_2026-04-15 contains live key; `_DOCS_AUDIT_2026-04-18` says "still active in production until rotated." ROTATION is critical security action, tracked in MASTER_PLAN_SESSION_10 Wave 3 extra but NO commit in SESSION_10_STATE indicates rotation landed.
22. **IOS-PAIR-2 "Scan or disc…" truncation** — UX_AUDIT_2026-04-17 and addendum both flag; `_DOCS_AUDIT_2026-04-18` doesn't mention ios fixes. Assumed still open.
23. **LOC budgets**: CLAUDE.md says 200-400 typical, 800 max; reality is runtime.ts 4,724, kairos-rpc.ts 5,375 — 5-6× max. CLAUDE.md is directly contradicted by four god-objects.
24. **Magnet phantom-frontmost-app click blocker** — SESSION_8 workaround via osascript AX bypass; still present in SESSION_10 screenshots. Not a WOTANN bug but a test-environment gotcha affecting all computer-use-driven audits.
25. **iOS view count** — SESSION_8_UX_AUDIT 27; UX_AUDIT_2026-04-17 30; DEEP_AUDIT ~32. Drift, potentially reflecting real growth.
26. **MASTER_AUDIT_2026-04-14 super-long (4063 lines)** vs MASTER_AUDIT_2026-04-18 (~20K bytes). `_DOCS_AUDIT` marks 14-doc as STALE, needs SUPERSEDED banner. Apr-18 is the current authoritative audit.
27. **`TERMINALBENCH_STRATEGY.md` + `MASTER_PLAN_PHASE_2` T6.4 TerminalBench scoring runner** — Phase_2 lists building the runner; MASTER_AUDIT_2026-04-18 Tier 1 item 11 lists "Benchmark harness — 20 held-out tasks" as if starting fresh. Same work, redundant planning.
28. **DEEP_AUDIT "12 learning files inert"** vs SESSION_9 commit c295b1d "KnowledgeGraph persistence" — partial fix of learning stack; observation-pipeline end-to-end still unwired per Phase_2 T1.6 / Phase_2 T3.5.

---

End of synthesis. The biggest unique pools of unassigned work sit in UI_DESIGN_SPEC §§4-9 (interactions+onboarding+sound+Watch/CarPlay/Widget specs), SESSION_8_UX_AUDIT's 36 findings, DEEP_AUDIT Phases A-G (especially D1-D15 wire-dead-features), and the research-repo-updates hermes-agent 100-commit delta. These are not catalogued in `AUTONOMOUS_EXECUTION_PLAN_2026-04-18.md` and would roughly double its task count.
