# Master Plan Addendum — Post Triple-Check

After triple-checking the 8-agent audit findings against source, memory,
remaining docs (AUTH, competitor-research-perplexity-mempalace, repo-
updates, research-repo-updates, superpowers/specs x2), and empirical
iOS install, the plan is augmented with **9 additional items** and
**4 confirmations**.

## Empirically verified this session

* **4 critical audit claims spot-checked in source** — all confirmed:
  Runering mounted / `emitRuneEvent` never called · CapabilityChips /
  SealedScroll / FocusView / Well zero imports · SOUL.md path reads
  `~/.wotann/` not workspace · fallback chain has 10 of 18 providers ·
  Bedrock registry uses openai-compat Bearer with no SigV4 signer.

* **iOS app installed to iPhone 17 Pro simulator (PID 17002)** — pairing
  view renders live. `Info.plist CFBundleIdentifier = com.wotann.ios`.
  **Empirical confirmation of IOS-PAIR-2**: the second stepper chip
  "Scan or disc…" is truncated in live render (screenshot
  `session-10-ios-pairing.png`).

* **Tauri empirical verification** (already in main plan §11): Chat +
  Editor (CHAT-1 fixed) + Palette (63 grouped entries, ⌘N glyph) +
  Providers (3 real subs Connected) all render.

## New items to append to Top-40 leaderboard

(Insert after item 40; re-sort as needed in execution order.)

| # | Item | Source | LOC | Days | Prio | Source doc |
|---|---|---|---:|---:|---|---|
| **41** | **MemPalace "drawer" layer** — raw verbatim storage alongside structured blocks (search summaries, return originals) | MemPalace | 250 | 2 | **S** | competitor-research-perplexity-mempalace §1 |
| **42** | **Domain/topic metadata partitioning** (wing/room filter on MemoryEntry) — **+34% retrieval** from pre-search filter | MemPalace | 180 | 1.5 | **S** | ibid |
| **43** | **L0/L1/L2/L3 progressive context loading** (~170 tokens wake-up, deeper on-demand) | MemPalace | 300 | 2.5 | **A** | ibid |
| **44** | **Conversation mining** — import past Claude/ChatGPT/Slack exports into memory store | MemPalace + deer-flow | 350 | 3 | **A** | ibid + research-repo-updates |
| **45** | **better-harness pattern** — TOML-driven autonomous harness optimization (Karpathy autoresearch style) | deepagents 0.5.x | 450 | 4 | **A** | research-repo-updates §deepagents |
| **46** | **Sub-250ms first paint** — aggressive import deferral, markdown prewarming, reduced health-poll intervals | deepagents | 150 | 1.5 | **A** | ibid |
| **47** | **`/skill:name` slash dispatch + `--skill` startup flag** | deepagents | 200 | 1.5 | **A** | ibid |
| **48** | **Monaco worker explicit registration** — `self.MonacoEnvironment.getWorker = …` + copy worker bundles to `public/` in Vite config | self | 80 | 1 | **A** | S10 Tauri audit §2 |
| **49** | **iOS IOS-PAIR-2** — fix "Scan or disc…" truncation (shorten label to "Scan" or ellipsize correctly) + IOS-DEEP-1 pair-gated deep link behaviour | self | 40 | 0.5 | **B** | UX_AUDIT 2026-04-17 + live ios screenshot |
| **50** | **Survey OpenClaw 560-skill library** for 10-20 candidates to lift into WOTANN skills dir | OpenClaw | 0 + skill ports | 2 | **B** | repo-updates §openclaw-master-skills |

### Hermes 100-commit delta — deferred, needs fresh agent

hermes-agent had 100 commits on main since Apr 9 (`research-repo-updates
§hermes`). Those cover unified execution layer, context compression,
new providers. **Recommendation**: before Wave 5 launch, dispatch one
more Opus agent to audit the hermes delta and extract any new patterns
missed by existing items 12, 26, 30 on the main Top-40 list.

## Revised Wave 1 scope (additions)

Append 3 items to Wave 1 "Close the S9 lies":

* **W1-18**: SOUL.md path fix (item 6 in main plan) — 1-line change.
* **W1-19**: Monaco worker explicit registration (item 48 above) — 80 LOC.
* **W1-20**: Council palette mis-route fix (item 23 in main plan) — 1-line change.

Everything else in Wave 1 unchanged.

## Inputs consumed (full list for audit-trail completeness)

1. `docs/UX_AUDIT_2026-04-17.md` (read full)
2. `docs/SESSION_8_UX_AUDIT.md` (read full via head; verified to end of TAURI section)
3. `docs/SESSION_8_HANDOFF.md` (read full)
4. `docs/GAP_AUDIT_2026-04-15.md` (persisted 29.6K — read full via persist file)
5. `docs/UI_DESIGN_SPEC_2026-04-16.md` (read full)
6. `docs/MASTER_AUDIT_2026-04-14.md` (read through section 12; agent 7 covered rest)
7. `docs/MASTER_PLAN_PHASE_2.md` (read full)
8. `docs/DEEP_AUDIT_2026-04-13.md` (read through Phase E items)
9. `docs/AUTH.md` (read full this turn)
10. `docs/competitor-research-perplexity-mempalace-2026-04-09.md` (read full this turn — 359 lines — new items 41-44)
11. `docs/repo-updates-2026-04-09.md` (read full this turn)
12. `docs/research-repo-updates-2026-04-09.md` (read full this turn — new items 45-47)
13. `docs/SESSION_9_SUMMARY.md` (self-authored, referenced)
14. `docs/superpowers/specs/2026-04-05-depth-ui-redesign-design.md` (read full this turn — confirmed current design tokens)
15. `docs/superpowers/specs/2026-04-09-sidebar-redesign-design.md` (read full this turn — "NOT definitive" marker, "text contrast needs to be higher", "Worker Pill = Workshop entry")
16. 9 session transcripts (Apr 15 x4 + Apr 16 x3 + Apr 16 session-6 prompt + continuation prompts) — agent 8 ledger
17. 10 cloned competitor repos (deer-flow/hermes-agent synced mid-session)
18. MEMORY.md (session start context)
19. Engram search for "wotann quality bars verify commit plan execution waves" — returned 0 hits (no conflicting stored memory)
20. Git log `33e76fc..HEAD` (5 S9 commits + 1 S10 plan + 1 addendum-pending)

## Gap-coverage self-check

| Dimension | Agent coverage | Extra manual coverage |
|---|---|---|
| Core runtime / daemon | ✓ A1 | §4 source-verified orphans |
| Providers | ✓ A2 | §4 source-verified Bedrock + fallback |
| Memory / prompt / skills | ✓ A3 | §4 source-verified SOUL.md path |
| Tauri desktop | ✓ A4 | live screenshots (Chat / Editor / Palette / Providers) |
| iOS + channels + voice | ✓ A5 | live iOS install + screenshot |
| Security / sandbox / tests / CI | ✓ A6 | test run 3922/3933 baseline |
| Competitor landscape | ✓ A7 | + MemPalace/deepagents extras this turn |
| Session-ledger reconciliation | ✓ A8 | git-log cross-check |
| Bundle size / perf | — | deferred to Wave 6 polish |
| A11y | partial (A4) | deferred to Wave 6 polish |
| i18n | — | not in v0.5 scope |
| MCP integration | ✓ A3 | Cognee/Omi covered |
| Telemetry opt-out honesty | ✓ A6 | verified honest |
| Docker/Seatbelt sandbox reality | ✓ A6 | verified prod-quality macOS |
| TUI Ink live | — | desk-audit confirmed 2979 LOC violation (A4); live TUI not exercised this session — not blocking because Tauri is the public surface |

No more blind spots that would invalidate Wave 1 execution. **Cleared to
proceed.**
