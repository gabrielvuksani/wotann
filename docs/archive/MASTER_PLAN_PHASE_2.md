# WOTANN Master Plan — Phase 2

> Generated 2026-04-13 — beyond the Phase 1 76-item plan, this is the "make it premium" plan.

## Prioritization

Impact per hour of work. "Wire what exists" ranks above "build new." Foundations above surfaces. Zero dev cost throughout.

---

## Tier 1 — Verify & wire (cheapest wins, biggest product-feel change)

| # | Item | Why | Files |
|---|---|---|---|
| T1.1 | Verify learning stack actually produces output | 12 learning files exist but may emit zero — biggest moat, zero visibility | `src/learning/*` |
| T1.2 | Wire ambient health panel (file watch + codebase health + memory quality, live) | Three built subsystems that never got combined into a single "live" panel | `src/daemon/ambient-awareness.ts`, new desktop `AmbientPanel.tsx` |
| T1.3 | Surface Proof Bundles in UI with real data | The moat is "proof-oriented autonomy"; today it's invisible | existing `desktop-app/src/components/proof/ProofViewer.tsx` + wire to `proofs.list` |
| T1.4 | Wire hook system so stop/pre-compact actually fires | 19 events defined; unclear which listeners run | `src/hooks/*`, test harness |
| T1.5 | Verify autopilot oracle/worker round-trip | Wired but never exercised end-to-end | `src/orchestration/autonomous.ts` + new integration test |
| T1.6 | Wire observation pipeline end-to-end | Feeds dream/instinct/skill-forge — foundation for learning | already partly wired at `runtime.close()`; verify emission |

## Tier 2 — Competitive parity (the "feels like Cursor" layer)

| # | Item | Competitor | Effort | Files |
|---|---|---|---|---|
| T2.1 | `@` references in composer (file/symbol/git/web/skill) | Cursor | Medium | new `desktop-app/src/components/chat/AtReferences.tsx` + palette hook |
| T2.2 | Multi-file edit preview with accept/reject per hunk | Cursor Composer, Claude Code | Medium | new `MultiFileDiff.tsx` + `runtime.editBatch()` API |
| T2.3 | Repo map (Aider-style auto-generated on project open) | Aider | Low | new `src/context/repo-map.ts` using existing `file-dep-graph.ts` |
| T2.4 | Plan mode (agent shows plan → user approves → executes) | Claude Code | Low | extends existing `superpowers:plan` + new `PlanReviewSheet.tsx` |
| T2.5 | Ghost-text tab autocomplete in editor | Cursor | Medium | extends `EditorPanel` with Monaco inline-completion provider |
| T2.6 | Perplexity-style citations on web search responses | Perplexity | Low | existing `src/providers/perplexity` adapter + UI citation chips |
| T2.7 | Workflows (saved command sequences) | Warp | Low | existing `workflow.list` RPC + new `WorkflowsPanel.tsx` |
| T2.8 | Shadow workspace (isolated background agent) | Cursor | Medium | uses existing `git worktree` + `agents.spawn` |

## Tier 3 — Merges (compounding value from already-built pieces)

| # | Merge | Existing Pieces |
|---|---|---|
| T3.1 | **Trust UI** — one panel: proof bundle + instruction provenance + verification cascade | `orchestration/proof-bundles.ts` + `prompt/instruction-provenance.ts` + `intelligence/verification-cascade.ts` |
| T3.2 | **Integrations** — channels + connectors + MCP + skills marketplace under one nav | 15 channel adapters + 6 knowledge connectors + MCP registry + skill registry |
| T3.3 | **Live Codebase** — ambient awareness + file watch + health report + dep graph | 4 files already exist, no shared panel |
| T3.4 | **Smart Autopilot** — oracle/worker + CI feedback + visual verifier + completion oracle | 4 modules exist, none wired together |
| T3.5 | **Learning** — observation-extractor + dream + instinct + skill-forge + pattern-crystallizer | 5 modules, plumbing incomplete |

## Tier 4 — Refactors (code health; enable future velocity)

| # | Refactor | Current | Target |
|---|---|---|---|
| T4.1 | Split `runtime.ts` | 3,639 lines | 4 files, ~800 each |
| T4.2 | Split `kairos-rpc.ts` | 3,800+ lines | 5 files by RPC domain |
| T4.3 | Consolidate duplicate user-model.ts | 2 classes | 1 class (Agent C partially did) |
| T4.4 | Empty catch-block cleanup (146 in top 5 files) | Silent failures | Structured error dispatch |
| T4.5 | Dead tool files registered in default surface | 6 dead files | All registered via capability equalizer |

## Tier 5 — UI/UX premium polish

| # | Item | Notes |
|---|---|---|
| T5.1 | iOS Phase C — Chat redesign (tool-call reveal, haptic tokens, swipe-reply) | Plan already exists in agent output |
| T5.2 | iOS Phase D — Work tab (Linear-style rows, ActiveWorkStrip) | Plan already exists |
| T5.3 | iOS Phase E — 3-screen onboarding + pairing wizard | Plan already exists |
| T5.4 | Desktop chat — Arc-soul polish (borderless assistant, artifact cards, streaming line) | Mirror iOS direction |
| T5.5 | Desktop loading/empty/error states consistent via tokens | Reuse iOS `Shimmer`/`Skeleton`/`EmptyState` pattern |
| T5.6 | Desktop command palette — actually bind `⌘K` (not just registered) + recent + @/#/ prefixes | Agent C built the palette; verify shortcut |
| T5.7 | Design tokens enforced in CSS vars (not Tailwind arbitrary values) | Desktop has inline `#0A84FF` everywhere — unify |
| T5.8 | Motion system: spring defaults, reduce-motion respect, no linear | Apply across desktop |

## Tier 6 — Infrastructure

| # | Item | Effort |
|---|---|---|
| T6.1 | Ad-hoc codesign the Tauri bundle so Gatekeeper doesn't warn | Trivial — `codesign --force --deep --sign -` |
| T6.2 | GitHub Releases automation (tag → DMG + artifacts) | Medium — GH Actions |
| T6.3 | Changelog automation from conventional commits | Low |
| T6.4 | TerminalBench scoring runner (validates "harness adds 15-30%" claim) | Medium |
| T6.5 | Benchmark dashboard in desktop (shows live leaderboard vs baseline) | Low, given runner |

## What we are NOT building

- Marketplace without eval/trust — need quality gate first
- Native LLM serving — Ollama covers local
- FUSE-overlay isolation — Docker + Seatbelt + worktrees sufficient
- Cloud IDE integration — desktop CU handles browsers
- WeChat / DingTalk channels — not relevant audience
- Full runtime.ts big-bang rewrite — incremental extraction only

## Execution order (this session)

1. T4.1 — split runtime.ts (biggest maintainability wins; unblocks everything else)
2. T1.2 + T3.3 — ambient health panel + live codebase merge
3. T2.3 — repo map generator
4. T5.6 — command palette ⌘K verification
5. T2.1 — @ references in composer
6. T1.3 — proof bundles UI
7. T6.1 — ad-hoc codesign

Each item ends with typecheck + build verification. No item ships unverified.
