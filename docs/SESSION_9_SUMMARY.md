# WOTANN Session 9 — Deep-Audit-Driven Upgrade (2026-04-17)

Run profile: one long autonomous run. Six parallel Opus Explore agents
audited every subsystem of the product; their findings became the concrete
gap inventory for this session's commits. All work gated on clean
typecheck in both `src/` and `desktop-app/src/`.

## Audit dispatch (6 agents, parallel)

| Agent | Scope | Duration |
|---|---|---|
| A1 | Core runtime + daemon + middleware + hooks | ~4 min |
| A2 | Providers subsystem (17 claimed) + fallback chain | ~2.7 min |
| A3 | Memory + context + prompt pipeline | ~4.7 min |
| A4 | UI Tauri desktop + Ink TUI | ~3.3 min |
| A5 | iOS targets + channels (16) + voice stacks | ~3.4 min |
| A6 | Tests + security + skills + marketplace | ~15.5 min |

## Headline findings (compressed)

| # | Area | Finding |
|---|---|---|
| 1 | Providers | Azure sent Bearer to raw endpoint (rejected). Bedrock / Vertex auth structurally broken (no SigV4, no OAuth exchange). Perplexity `supportsToolCalling: false` even though sonar GA'd the tools API. Groq only reachable via `"free"` pseudo-provider — the named "groq" provider had no registry case. 11/17 providers not in fallback chain. |
| 2 | Memory | `KnowledgeGraph` is RAM-only — `knowledge_nodes`/`knowledge_edges` SQL tables are orphan. Every restart wipes the graph. `memoryMiddleware` attaches `memoryCandidate` that nothing consumes. `instruction-provenance.ts` is exported, never invoked. |
| 3 | UI | `App.tsx` 2,979 LOC (violates 800-cap); TUI has 65 themes, desktop has 5 — drift; 100+ Tauri commands with no per-command allowlist; disconnected banner eats 32-40px of every view; design tokens duplicated across files; TUI keybindings in-memory only. |
| 4 | Editor | Cmd+2 triggers ErrorBoundary — Monaco needs `worker-src` + `'unsafe-eval'` that CSP blocked. |
| 5 | Channels | 16 adapters (README says 14). Two `ChannelAdapter` interfaces coexist. iMessage adapter implements neither. |
| 6 | Voice | Two parallel voice stacks coexist (voice-mode / voice-pipeline) with different STT provider enums. System-STT on macOS is a fabricated-success stub (honest in session 6+). |
| 7 | Tests | 3 tautological `expect(true).toBe(true)` (telegram, api-server). 4 flaky tests treated as acceptable. CI masked shard-1 failures with `continue-on-error: true` as a "runner-flake" excuse. |
| 8 | Dead code | `auto-archive`, `rate-limit-resume`, `code-mode`, `red-blue-testing`, `spec-to-ship`, `file-type-gate`, `deferred-tool-filter`, `tool-error-handler (standalone)` — tests pass in isolation, never wired into runtime. Total ~2.6K LOC of callable-but-unused code re-exported from `lib.ts`. |

## Commits landed (3 total)

### Commit 1 — UI polish + signature overlays + provider honesty

`518e38e feat(desktop): UI polish + signature runering/capability-chips/shortcut-overlay (session 9)`

**25 files changed / 1,038 insertions / 123 deletions.**

- **9 `animate-spin` sites → `<ValknutSpinner>`** across Memory,
  ScheduledTasks, PluginManager, ProjectList, ArbitrageDashboard,
  ExecApprovals, Sidebar, SearchReplace, SettingsView, OnboardingView.
- **Disconnected banner is now dismissible.** Dismissal persists in
  localStorage, auto-clears on engine-reconnect so next disconnect re-
  surfaces. Removes 32-40px of warning chrome from every view.
- **Empty providers CTA.** Dashed-border card with clock glyph +
  "Run discovery" primary button + explanation of which envs it scans.
- **Editor CSP fix.** Added `worker-src 'self' blob:` + `'unsafe-eval'`
  + `blob:` to script-src + jsDelivr CDN to connect-src — Monaco can
  now load its workers + the VS Code module loader. Resolves CHAT-1.
- **Runering component** (design-spec §4.1). 8 Elder Futhark runes
  mapped to memory-save kinds (Ansuz/Raidho/Kenaz/Naudhiz/Algiz/Wunjo/
  Othala/Thurisaz). 480ms traced-circle + 280ms pulse + 600ms fade.
  Subscribes to global `wotann:rune-event` custom events. Queues so
  bursts stay visible.
- **CapabilityChips component** (design-spec §4.4). Provider-provenance
  strip for assistant messages. Sigils (🜂 vision / 🜃 thinking / 🜄
  tools) appear only when the capability-augmenter synthesised the
  feature — gold/moss for paid/local providers, shadow-git SHA chip
  with scrubber affordance.
- **KeyboardShortcutsOverlay component.** `?` opens a grouped cheatsheet
  of 20 shortcuts across Navigation / Actions / Power-user / Safety.
  Respects inputs (no swallow when typing). Esc or click-outside to
  dismiss.
- **Groq explicit registry case.** Was only reachable via `"free"`.
  Added `"groq"` to ProviderName union + guardrails-off chain +
  `hasCredentialsFor` (scans `GROQ_API_KEY`).
- **Perplexity `supportsToolCalling: false → true`.** Sonar's native
  tools API is now preferred over capability-augmenter XML emulation.
- **CI honesty.** Removed `continue-on-error: ${{ matrix.shard == 1 }}`
  — failures now fail the pipeline instead of hiding under "flake".
- **3 tautological tests fixed** — `expect(true).toBe(true)` → real
  observable post-conditions (`not.toThrow`, method-shape checks).

### Commit 2 — Backend memory + two new UI components

`c295b1d feat(memory,desktop): persist KnowledgeGraph + FocusView + SealedScroll`

**3 files changed / 593 insertions / 1 deletion.**

- **KnowledgeGraph persistence.** Boots with empty graph + async
  `rehydrateKnowledgeGraph` reads `.wotann/knowledge-graph.json` if
  present (best-effort, malformed file leaves the empty graph).
  `persistKnowledgeGraph` is called fire-and-forget from `close()` —
  atomic temp-file-rename, never blocks shutdown. Resolves the
  MEM-RAM-only finding.
- **FocusView** — 3-line conversation collapse (Claude Code `/focus`
  port). Last user prompt, aggregated tool summary, final assistant
  response. Click expands. Pure `summarizeMessages()` function for
  trivial unit testing.
- **SealedScroll** (design-spec §4.3). Proof-bundle materialisation.
  Four wax-seal chips (tests/typecheck/diff/screenshots) with pending/
  running/passed/failed/skipped states. Unroll animation. Export-as-
  Markdown CTA on seal.

### Commit 3 — Azure URL fix + The Well scrubber

`a11debe feat(providers,desktop): Azure deployment URL fix + The Well timeline scrubber`

**2 files changed / 470 insertions / 4 deletions.**

- **Azure adapter rebuild.** Reads `AZURE_OPENAI_DEPLOYMENT` /
  `AZURE_OPENAI_DEPLOYMENT_NAME` + `AZURE_OPENAI_API_VERSION` envs,
  builds `{endpoint}/openai/deployments/{deployment}?api-version=...`,
  uses `api-key` header. Default model = deployment name.
- **The Well** (design-spec §5.3). Shadow-git timeline scrubber.
  Horizontal ribbon of rune ticks (ᚱᚲᚷᛉᚨᚠ◆ᛗᛒ per event kind),
  auto-clusters checkpoints within 2s, click→restore confirmation with
  Inspect vs Restore CTAs. Pure presentation — caller wires
  `shadow.checkpoints` RPC → props and `shadow.undo` on restore.

## Known gaps still open (follow-up priority order)

### High leverage, quick

1. Bedrock + Vertex structural auth fix (AWS SigV4 + Google OAuth2
   exchange). Currently both issue broken requests on first call.
2. Format translator still Anthropic ↔ OpenAI only — add Gemini path
   so the translator matches the README claim.
3. `memoryCandidate` consumer OR deletion — the middleware layer
   attaches it but nothing reads it.
4. Deprecation notes in `lib.ts` for the 6 dead modules (code-mode,
   red-blue-testing, spec-to-ship, auto-archive, rate-limit-resume,
   file-type-gate) OR wire them into runtime.

### Medium leverage

5. `runtime.ts` 4,489 LOC split into 4 files (~800 each). Dedicated
   session with dependency-map agent.
6. `kairos-rpc.ts` 5,375 LOC split into 5 domain files.
7. Per-command Tauri allowlist (capabilities/default.json).
8. Two `ChannelAdapter` interfaces unification.
9. 4 flaky tests (legitimate timeouts, not flake) — fix root cause.
10. 12 never-fired HookEvent variants — remove from type OR wire.

### iOS (blocked on physical device)

11. Live Activity `Activity.request()` wiring.
12. WOTANNIntents ECDH integration.
13. `@Observable` migration (215 call sites).
14. 18 other items documented in GAP_AUDIT.

## Verification

- `npm run typecheck` — clean (root).
- `cd desktop-app && npx tsc --noEmit` — clean.
- `npm test` — ran green (3 commits were each gated on green tests
  before commit). Tautological fixes preserve existing pass count.
- `git log --oneline -5` shows 3 new commits on `main` after session 8.

## Design-spec commits delivered

| Design-spec section | Component | File |
|---|---|---|
| §4.1 Runering | Runering + 8 rune kinds + keyframes | `components/wotann/Runering.tsx` |
| §4.4 Capability Chips | CapabilityChips + alchemical sigils | `components/wotann/CapabilityChips.tsx` |
| §4.3 Sealed Scroll | SealedScroll + seal-chip states | `components/wotann/SealedScroll.tsx` |
| §5.3 The Well | Well + clusters + restore popover | `components/wotann/Well.tsx` |
| §12 P9 Focus View | FocusView + summarize helper | `components/chat/FocusView.tsx` |
| (UX gap) Shortcuts | KeyboardShortcutsOverlay | `components/shared/KeyboardShortcutsOverlay.tsx` |

Signature WOTANN UI pieces now live as first-class components. Each is
pure presentation (no runtime coupling beyond props/window events), so
wiring them into concrete surfaces is additive follow-up work — they
can be adopted incrementally without breaking existing views.
