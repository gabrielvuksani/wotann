# WOTANN Agent Harness — File-System Inventory (Phase 1 Agent A)

**Generated:** 2026-04-19
**Scope root:** `/Users/gabrielvuksani/Desktop/agent-harness/`
**Git HEAD (wotann):** `aaf7ec2 feat(intelligence/tool-pattern-detector): n-gram mining + shortcut suggestions`
**Method:** `find` + `stat -f '%m|%z|%N'` + `wc -l` executed in parallel batches, exclusions applied via `find -prune`.

Exclusions honored per prompt: `node_modules/`, `.git/`, `dist/`, `build/`, `target/`, `.next/`, `__pycache__/`, `.DS_Store`. See the PROMPT-LIES section for build-cache directories that slipped past this filter but which this report surfaces separately.

---

## 1. Executive Summary

| Metric | Value |
|---|---|
| Total in-scope files | **66,914** |
| Total in-scope bytes | **7.35 GiB** (7,895,595,528 bytes) |
| Top-level directories with files | 11 (wotann, research, reference, .nexus, .swarm, .superpowers, .claude-flow, .playwright-mcp, .github, .claude, tmp, wotann-old-git-20260414_114728) |
| Total code-text files (see ext list in §1.3) | 47,999 |
| Total LOC across those files | ~10.53 M (including build caches) |

### 1.1 LOC Totals by Language (top 15)

Aggregated over every file passing the extension filter. **Note:** these totals include build-cache directories (`wotann/ios/.build/`, `wotann/desktop-app/src-tauri/target-audit/`) that the audit prompt did not explicitly list in the exclusion set but that are plainly build output. The §1.4 "real source LOC" row excludes those.

| Ext | LOC | Files |
|---|---|---|
| py | 2,381,669 | 8,176 |
| ts | 2,219,334 | 10,133 |
| md | 2,218,050 | 8,184 |
| json | 1,793,588 | 6,695 |
| rs | 886,318 | 2,035 |
| dart | 618,864 | 603 |
| tsx | 538,417 | 2,741 |
| js | 523,969 | 1,745 |
| swift | 420,562 | 1,547 |
| yaml | 235,670 | 1,021 |
| c | 217,505 | 497 |
| h | 188,198 | 813 |
| hpp | 112,234 | 194 |
| cpp | 110,555 | 272 |
| sh | 77,555 | 564 |

### 1.2 Top-20 LARGEST Files (Bytes, Build-Cache Excluded)

| Bytes | Path |
|---|---|
| 110,388,420 | `./.playwright-mcp/Ollama.dmg` |
| 92,763,611 | `./research/omi/plugins/hume-ai/video/rizz-omi-setup.MOV` |
| 77,871,956 | `./research/camoufox/bundle/fonts/macos/PingFang.ttc` |
| 77,704,715 | `./research/omi/sdks/swift/Sources/omi-lib/Resources/ggml-tiny.en.bin` |
| 66,933,080 | `./research/camoufox/bundle/fonts/macos/Supplemental/Songti.ttc` |
| 55,783,456 | `./research/camoufox/bundle/fonts/macos/STHeiti Light.ttc` |
| 55,754,164 | `./research/camoufox/bundle/fonts/macos/STHeiti Medium.ttc` |
| 52,118,230 | `./research/ruflo/v2/models/phi-4-mini/.../model.onnx` |
| 47,275,520 | `./research/goose/ui/desktop/src/platform/windows/bin/uv.exe` |
| 47,027,712 | `./research/camoufox/bundle/fonts/macos/AppleColorEmoji.ttf` |
| 45,084,563 | `./research/omi/plugins/hume-ai/video/demo.mov` |
| 44,736,069 | `./research/ruflo/v2/models/phi-4-mini/.../model.onnx.data` |
| 36,786,404 | `./research/camoufox/bundle/fonts/windows/mingliub.ttc` |
| 30,906,876 | `./research/goose/documentation/blog/2025-04-17-goose-goes-to-NY/focus5.jpg` |
| 28,428,204 | `./research/camoufox/bundle/fonts/macos/AppleSDGothicNeo.ttc` |
| 27,520,663 | `./research/goose/documentation/blog/.../focus3.jpg` |
| 25,879,292 | `./research/camoufox/bundle/fonts/macos/Hiragino Sans GB.ttc` |
| 23,729,404 | `./research/goose/ui/desktop/src/platform/windows/bin/libstdc++-6.dll` |
| 23,278,008 | `./research/camoufox/bundle/fonts/macos/Supplemental/Arial Unicode.ttf` |
| 22,808,099 | `./research/omi/plugins/hume-ai/video/notification.MP4` |

Observation: of the 20 largest, 1 is a Playwright-MCP artifact (Ollama.dmg), the rest are cloned competitor media/fonts/models — none is WOTANN product code.

### 1.3 Top-20 Most Recently Modified Files (Cruft Filtered)

This list excludes `wotann/.wotann/**` runtime state, the old-git backup, build caches, Playwright console logs, and the stray `big.txt/p{1,2,3}.txt/small.txt` scratch files (all written 2026-04-19T10:29 and clearly test-only). The list below is the real work surface.

| mtime (local) | Bytes | Path |
|---|---|---|
| 2026-04-19T10:29:05 | 3,225 | `./wotann/tests/intelligence/tool-pattern-detector.test.ts` |
| 2026-04-19T10:28:53 | 5,340 | `./wotann/src/intelligence/tool-pattern-detector.ts` |
| 2026-04-19T10:28:07 | 5,007 | `./wotann/tests/learning/reflection-buffer.test.ts` |
| 2026-04-19T10:27:49 | 6,414 | `./wotann/src/learning/reflection-buffer.ts` |
| 2026-04-19T10:26:59 | 3,607 | `./wotann/tests/intelligence/chain-of-verification.test.ts` |
| 2026-04-19T10:26:47 | 4,862 | `./wotann/src/intelligence/chain-of-verification.ts` |
| 2026-04-19T10:26:04 | 3,552 | `./wotann/tests/memory/semantic-cache.test.ts` |
| 2026-04-19T10:25:49 | 5,817 | `./wotann/src/memory/semantic-cache.ts` |
| 2026-04-19T10:25:06 | 4,485 | `./wotann/tests/prompt/template-compiler.test.ts` |
| 2026-04-19T10:24:50 | 8,494 | `./wotann/src/prompt/template-compiler.ts` |
| 2026-04-19T10:23:50 | 3,024 | `./wotann/tests/orchestration/speculative-execution.test.ts` |
| 2026-04-19T10:23:39 | 4,748 | `./wotann/src/orchestration/speculative-execution.ts` |
| 2026-04-19T10:22:58 | 4,105 | `./wotann/tests/telemetry/token-estimator.test.ts` |
| 2026-04-19T10:22:40 | 5,236 | `./wotann/src/telemetry/token-estimator.ts` |
| 2026-04-19T10:21:55 | 4,817 | `./wotann/tests/providers/circuit-breaker.test.ts` |
| 2026-04-19T10:21:39 | 5,891 | `./wotann/src/providers/circuit-breaker.ts` |
| 2026-04-19T10:20:57 | 4,596 | `./wotann/tests/context/importance-compactor.test.ts` |
| 2026-04-19T10:20:38 | 6,103 | `./wotann/src/context/importance-compactor.ts` |
| 2026-04-19T10:19:50 | 4,116 | `./wotann/tests/orchestration/parallel-coordinator.test.ts` |
| 2026-04-19T10:19:36 | 4,906 | `./wotann/src/orchestration/parallel-coordinator.ts` |

**Verified pattern:** the last 10 commits on the wotann HEAD each landed as `src/<domain>/<feature>.ts` plus `tests/<domain>/<feature>.test.ts` in a TDD cadence — matches the git log one-for-one. Work is active and test-first.

### 1.4 "Real Source" LOC — Build Caches Removed

| Section | Files | LOC |
|---|---|---|
| `wotann/src/` | 500 | 168,259 |
| `wotann/tests/` | 309 | 57,769 |
| `wotann/ios/` (excluding `.build/`) | 155 | 30,698 |
| `wotann/desktop-app/` (excluding `src-tauri/target-audit/`) | 206 | 71,537 |
| `wotann/docs/` | 50 | 20,914 |
| `wotann/skills/` | 87 | 4,591 |
| `wotann/scripts/` + `python-scripts/` + `Formula/` | 6 | 786 |
| `wotann/.wotann/` (runtime state) | 5,208 | 986 |
| `wotann/.superpowers/` | 31 | 6,408 |
| **WOTANN total (real source)** | **~6,552** | **~361,948** |
| **research/ total (40 repos)** | **49,515** | ~9,558,000 |

---

## 2. Table by Top-Level Directory

| Dir | Files | Dominant types | Purpose |
|---|---|---|---|
| `wotann/` | 16,517 | `ts`, `tsx`, `rs`, `swift`, `md` | Product repo (git repo, HEAD aaf7ec2). Contains `src/`, `tests/`, `ios/`, `desktop-app/`, `docs/`, `skills/`. |
| `research/` | 49,515 | mixed (40 cloned competitor repos) | Competitor-reference material; see §5. |
| `wotann-old-git-20260414_114728/` | 692 | git objects | Backup of a prior `.git` directory (renamed on 2026-04-14). Contains a 625 MB pack file. Dead weight — see §4. |
| `.playwright-mcp/` | 99 | `yml` (58), `log` (40), `dmg` (1) | Playwright-MCP runtime artifacts: page snapshots, console logs, and one Ollama installer (105 MiB). |
| `reference/` | 5 | `md` | L1 reference docs: AGENTS_ROSTER, HOOKS_REGISTRY, MEMORY_ARCHITECTURE, TOOLS_AND_MCP. |
| `.nexus/` | 10 | `db`, `json`, log dirs | Old (V3-era) Nexus runtime state: `memory.db` SQLite (156 KiB), 9 session JSONs, empty `screenshots/`, `episodes/memory/84327-*`. |
| `.superpowers/` | 8 | `md`, `json` | Superpowers plugin brainstorming artifacts (parent-level, separate from wotann's own). |
| `.swarm/` | 2 | `json` | `q-learning-model.json` + `state.json`. Claude-flow swarm state — likely vestigial. |
| `.claude-flow/` | 1 | `json` | `metrics/swarm-activity.json` — single metrics file. |
| `.github/` | 1 | `md` | One file: `agents/planner.agent.md` (parent-level agent def). |
| `.claude/` | 3 | `json` | Per-project `settings.local.json`, `scheduled_tasks.lock`, and `projects/-Users-gabrielvuksani-Desktop-agent-harness/` memory dir. |
| `tmp/` | 3 | `json` | Three stray "sona" test JSONs dated 2026-04-03 — orphan scratch. See §4. |
| `node_modules/` (root) | 2 | `json` | Only `.package-lock.json` + `.vite/` (largely empty). Not counted in main totals. |

### 2.1 `wotann/` Sub-directory Breakdown

| Sub-dir | Files | LOC | Dominant types |
|---|---|---|---|
| `src/` | 500 | 168,259 | `ts` (majority), a few `md` |
| `tests/` | 309 | 57,769 | `ts` (vitest) |
| `ios/` (excluding `.build/`) | 155 | 30,698 | `swift`, `plist`, `pbxproj`, `yaml` |
| `ios/.build/` | 3,299 | 845,505 | Swift build cache (see §4) |
| `desktop-app/` (excluding `target-audit/`) | 206 | 71,537 | `rs`, `tsx`, `ts`, `css` |
| `desktop-app/src-tauri/target-audit/` | 6,622 | 0 | Rust debug build cache (see §4) |
| `docs/` | 50 | 20,914 | `md` (audit/plan/deep-reads) |
| `skills/` | 87 | 4,591 | `md` + `yaml` (skill defs) |
| `scripts/` | 4 | 389 | `sh` |
| `python-scripts/` | 1 | 341 | `py` (camoufox-driver.py) |
| `Formula/` | 1 | 56 | `rb` (Homebrew formula stub) |
| `.wotann/` (runtime state) | 5,208 | 986 | `json`, `db`, logs, `.shadow-git/` |
| `.codex-home/` | 2 | 0 | Empty-looking dirs |
| `.github/` | 5 | 343 | `yml` (workflows) |
| `.superpowers/` | 31 | 6,408 | `md`, `html` (brainstorm artifacts) |
| root | 37 | — | package.json, README, 11+ MDs, 5 scratch txt, 11 screenshots, install.sh, etc. |

---

## 3. Files > 500 LOC (Splitting Candidates)

Per the immutability-and-small-files rule in `~/.claude/rules/coding-style.md` (800 LOC soft cap, 200-400 typical), every file below is a candidate for extraction. 118 files in wotann are over 500 LOC (excluding build caches, node_modules, dist, `.wotann/` runtime state, `package-lock.json`, and non-`*.md` JSONs).

### 3.1 Top-30 Largest Source Files

| LOC | Path | Purpose (first-line-derived) |
|---|---|---|
| 5,375 | `wotann/src/daemon/kairos-rpc.ts` | KAIROS JSON-RPC handler — 160 handler registrations |
| 4,843 | `wotann/src/core/runtime.ts` | `WotannRuntime` composition root wiring all subsystems |
| 3,655 | `wotann/src/index.ts` | Main CLI entry `#!/usr/bin/env node` |
| 3,554 | `wotann/desktop-app/src-tauri/src/commands.rs` | Tauri commands invoked from React; KAIROS IPC-first, fallbacks |
| 2,979 | `wotann/src/ui/App.tsx` | Main TUI app wired to `WotannRuntime` (Ink) |
| 2,827 | `wotann/desktop-app/src-tauri/gen/schemas/desktop-schema` (macOS+generic JSON generated schema) | Generated Tauri schema (non-hand-written — tolerable) |
| 2,761 | (same, variant) | ditto |
| 2,253 | `wotann/desktop-app/src/styles/globals.css` | Global CSS for desktop app |
| 2,075 | `wotann/src/desktop/companion-server.ts` | Secure WS bridge between WOTANN Desktop and iOS |
| 1,994 | `wotann/src/memory/store.ts` | SQLite + FTS5 memory store (8-layer unified, §14) |
| 1,750 | `wotann/src/daemon/kairos.ts` | KAIROS always-on daemon; tick system; heartbeat; cron |
| 1,567 | `wotann/desktop-app/src/components/settings/SettingsView.tsx` | Settings panels: providers, theme, shortcuts, security |
| 1,306 | `wotann/src/providers/provider-service.ts` | Unified provider state (ProviderService) |
| 1,281 | `wotann/src/orchestration/autonomous.ts` | Autonomous "fire-and-forget" execution engine |
| 1,252 | `wotann/src/hooks/built-in.ts` | 17+ built-in hooks (hook-as-guarantee pattern) |
| 1,235 | `wotann/desktop-app/src/components/palette/CommandPalette.tsx` | Cmd+K command palette container |
| 1,212 | `wotann/desktop-app/src/components/onboarding/OnboardingView.tsx` | First-launch onboarding steps (welcome/providers/done) |
| 1,075 | `wotann/src/intelligence/forgecode-techniques.ts` | ForgeCode harness engineering for 81.8% TerminalBench accuracy |
| 1,073 | `wotann/ios/WOTANN/Views/RemoteDesktop/RemoteDesktopView.swift` | iOS remote-desktop SwiftUI view |
| 1,039 | `wotann/src/lib.ts` | Module exports / public API |
| 1,030 | `wotann/desktop-app/src/store/engine.ts` | Zustand engine store + async Tauri actions |
| 919 | `wotann/.superpowers/brainstorm/22264-1775412743/content/design-depth.html` | Brainstorm artifact (self-contained HTML) |
| 891 | `wotann/ios/WOTANN/Networking/RPCClient.swift` | iOS RPC client |
| 886 | `wotann/src/lsp/symbol-operations.ts` | LSP rename/refs/type-info/insert with TS fallback |
| 873 | `wotann/src/intelligence/accuracy-boost.ts` | Accuracy-boost techniques (TerminalBench + SWE-bench) |
| 854 | `wotann/src/computer-use/platform-bindings.ts` | Platform-specific desktop automation bindings |
| 842 | `wotann/src/security/guardrails-off.ts` | Guardrails-off mode for authorized security research |
| 837 | `wotann/src/mobile/ios-app.ts` | iOS app server-side handlers |
| 820 | `wotann/src/computer-use/perception-engine.ts` | Perception engine (harness's "eyes") |
| 800 | `wotann/src/daemon/automations.ts` | Event-driven agents; trigger+agent_config+memory_scope |

### 3.2 All Files > 500 LOC (Summary Counts)

- `src/daemon/`: 4 files over 500 LOC (kairos-rpc, kairos, kairos-ipc, automations, background-workers) — **candidates to split by responsibility**.
- `src/memory/`: 8 files over 500 LOC (store, graph-rag, vector-store, episodic-memory, memory-tools, memory-benchmark, conversation-miner, + test).
- `src/orchestration/`: 8 files over 500 LOC (autonomous, plan-store, council, workflow-dag, agent-registry, self-healing-pipeline, parallel-coordinator, speculative-execution).
- `src/intelligence/`: 8 files over 500 LOC (forgecode-techniques, accuracy-boost, auto-reviewer, response-validator, deep-research, benchmark-harness, + recent CoVe + tool-pattern-detector).
- `src/voice/`: 4 files over 500 LOC (tts-engine, stt-detector, voice-mode, voice-pipeline).
- `src/providers/`: 6 files over 500 LOC (provider-service, discovery, capability-equalizer, copilot-adapter, codex-adapter, gemini-native-adapter, tool-parsers/parsers).
- `docs/`: 17 MD files over 500 lines (mostly audit/deep-read reports — acceptable for doc artifacts).
- `desktop-app/src/`: 7 TSX files over 500 LOC — candidates for component extraction.
- `ios/WOTANN/Views/`: 7 Swift files over 500 LOC — SwiftUI candidates for child-view extraction.

Full list (118 entries) is in `/tmp/audit_a/wotann_over500.txt` on this host. Re-generate with:
```
awk -F'|' '$1 > 500 && $2 ~ /^\.\/wotann\// && $2 !~ /\.build\// && $2 !~ /target-audit\// && $2 !~ /dist\// && $2 !~ /\.wotann\// && $2 !~ /node_modules/ && $2 !~ /package-lock/ && $2 !~ /\.json$/' loc.txt | sort -t'|' -k1 -rn
```

---

## 4. Dead Weight (orphaned / test-scratch / backup / build-cache)

### 4.1 At `wotann/` Root — Confirmed Scratch Files

These are all untracked (`git status: ??`) and were written in one burst at 2026-04-19T10:29:36–10:29:42 — clearly TDD scratch output from an earlier session.

| File | Size | Content |
|---|---|---|
| `big.txt` | 1,000 | 1000 `x` characters, no newline |
| `p1.txt` | 1 | Single `A` |
| `p2.txt` | 1 | Single `B` |
| `p3.txt` | 1 | Single `C` |
| `small.txt` | 1 | Single `y` |

**Verdict:** safe to delete. None are referenced in `src/`, `tests/`, `scripts/`, or `package.json`. Likely probe artifacts from exploratory file-tool tests. The `git status` output during this audit confirmed five `??` entries matching these filenames.

### 4.2 `wotann-old-git-20260414_114728/` — Orphaned Git Directory

- **692 files, 685 MiB** including a 625 MiB `pack-4b47ed155a8c8e704285c7512486cc4d53339c86.pack`.
- Name pattern suggests it was renamed from `.git/` on 2026-04-14 at 11:47:28 (probably during a `git gc` or history rewrite). Contains stale `COMMIT_EDITMSG`, HEAD, 15 `index*` files (several 4.27 MiB copies), `hooks/`, `logs/`, `refs/`, `objects/`.
- **Not referenced by any tool** — neither `wotann/.git/` nor `research/` points at it.
- **Verdict:** recoverable-if-needed backup. Safe to delete after verifying the active `wotann/.git/` has all commits, which it does (HEAD `aaf7ec2` verified, log back to Apr 14 clean).

### 4.3 `wotann/desktop-app/src-tauri/target-audit/` — Rust Build Cache

- **6,622 files, 3.42 GiB.** Debug build of `wotann_desktop` — the single largest consumer of disk in the workspace.
- Directory name is `target-audit/` (not `target/`) so the audit-prompt's `target/` exclusion did **not** hit it. Every file inside is build-generated (.rlib, .rmeta, .o, .d, incremental deps).
- **Verdict:** regenerable. Add `target-audit/` to the prompt's exclusion list for future audits; safe to `cargo clean`-equivalent anytime.

### 4.4 `wotann/ios/.build/` — Swift Build Cache

- **3,299 files, 278 MiB.**
- Swift Package Manager `.build/` checkouts: mlx-swift, swift-transformers, swift-collections, swift-argument-parser test data, etc. Generated LOC of 845,505 is **not real source** — it's vendored + compiled Swift packages.
- **Verdict:** regenerable. `swift package clean` equivalent; add to exclusion list.

### 4.5 `tmp/` — Three Stray JSONs at Parent Root

- `sona-kw-test.json` (659 B), `sona-test-patterns.json` (277 B), `sona-test2.json` (566 B).
- Dated 2026-04-03 19:19 — matches the era of the `.nexus/` and `.swarm/` dirs.
- **Verdict:** orphan. No tool currently reads from `tmp/` (verified via no-results on `grep -r "sona-kw-test"` and similar).

### 4.6 `research/.broken/` — Old Repo Snapshots

- **7,461 files, 168 MiB, 1,989,652 LOC.**
- Eight dated snapshots (all `20260414_*`): `claude-task-master`, `deepagents`, `deer-flow`, `eigent`, `hermes-agent`, `hermes-agent-old`, `oh-my-openagent`, `open-swe`. `hermes-agent-old_*` has restricted perms (`drwx------`).
- Each was superseded by a re-cloned version in `research/<name>/` on 2026-04-17/18.
- **Verdict:** fossilized re-cloning backups. Likely safe to delete; verify no `grep` in audit docs references `.broken` paths before removal.

### 4.7 `wotann/.wotann/` — Runtime State With Leaked Temp Files

- **5,208 files, 202 MiB.** Legitimate runtime state (logs, memory.db, knowledge-graph.json, dreams/, episodes/) that survives across sessions.
- **However**, contains 20+ `knowledge-graph.json.tmp.<pid>.<epoch>` leaked atomic-write tempfiles from multiple process runs. Also contains duplicates like `memory 2.db-shm`, `memory 3.db-shm`, ... `memory 5.db-shm/-wal` — stale SQLite replica files.
- `.shadow-git/` inside `.wotann/` is a loose-object git store (no pack file) — presumably the snapshot engine's own git.
- **Verdict:** the `*.tmp.*` files and `memory N.db-*` duplicates are dead weight; the rest is legitimate runtime state. A cleanup pass that deletes `knowledge-graph.json.tmp.*` and `memory [0-9].db-*` (keeping the primary `memory.db`, `memory.db-shm`, `memory.db-wal`) would recover disk without data loss.

### 4.8 `.playwright-mcp/Ollama.dmg` — 105 MiB Installer

- Dated 2026-04-05. Stale Ollama installer left behind from an earlier session's MCP work.
- **Verdict:** safe to delete.

### 4.9 Dead-Weight Roll-Up

| Category | Files | Size |
|---|---|---|
| `target-audit/` (Rust cache) | 6,622 | 3.42 GiB |
| `wotann-old-git-20260414_114728/` | 692 | 685 MiB |
| `.wotann/` (mixed legit + leaked) | 5,208 | 202 MiB |
| `research/.broken/` | 7,461 | 168 MiB |
| `ios/.build/` (Swift cache) | 3,299 | 278 MiB |
| `.playwright-mcp/Ollama.dmg` | 1 | 105 MiB |
| 5 scratch TXTs at `wotann/` root | 5 | ~1 KiB |
| `tmp/` sona files | 3 | ~1.5 KiB |
| **TOTAL prunable** | **~23,291** | **~4.85 GiB** |

Pruning this would drop the workspace from 7.35 GiB to ~2.5 GiB without touching a single source file.

---

## 5. Competitor Repo LOC Summary (`research/`)

Per-repo totals computed over code/text extensions only. Primary-language column = the single `ts|tsx|py|rs|swift|go|md|...` extension with the highest file count inside the repo. "Real reference" vs "skeleton" judgment is mine, based on LOC density + dominant language + what the repo name points to.

| Repo | Files | LOC | Primary lang | Classification |
|---|---|---|---|---|
| `ruflo` | 9,996 | 2,228,699 | md (2,429 md files) | **Real reference** — 3 versioned sub-repos (`v2/`, `v3/`) with substantial Phi-4 ONNX weights and agent code |
| `omi` | 5,588 | 1,688,993 | dart | **Real reference** — massive Flutter+native SDK project (wearable/iOS/Android) |
| `codex` | 3,760 | 844,450 | rs (1,499) | **Real reference** — OpenAI Codex CLI full Rust tree |
| `hermes-agent` | 2,030 | 752,213 | py (955) | **Real reference** — 862-file skill catalogue per prior docs |
| `goose` | 2,707 | 727,642 | tsx (591 files, but heavily Rust+TS mix) | **Real reference** — full Goose desktop app |
| `deepagents` | 673 | 410,381 | py (442) | **Real reference** — Langchain DeepAgents + eval suites |
| `oh-my-openagent` | 1,974 | 321,031 | ts (1,757) | **Real reference** — OpenAgent TS mono |
| `claude-task-master` | 1,253 | 301,496 | ts (451) | **Real reference** — task-master full tree |
| `openai-agents-python` | 1,287 | 293,379 | py (741) | **Real reference** — OpenAI Python Agents SDK |
| `cognee` | 2,000 | 221,809 | py (1,353) | **Real reference** — Cognee memory/graph project |
| `agents` | 695 | 199,695 | md (550) | **Real reference** — large agent collection (md-heavy) |
| `archon` | 800 | 192,363 | ts (327) | **Real reference** — Archon coordination layer |
| `eigent` | 1,115 | 180,908 | py (350) | **Real reference** |
| `deer-flow` | 890 | 168,963 | py (333) | **Real reference** |
| `multica` | 947 | 150,340 | tsx (261) | **Real reference** |
| `deeptutor` | 744 | 149,297 | py (451) | **Real reference** |
| `gstack` | 465 | 148,918 | ts (209) | **Real reference** |
| `vercel-open-agents` | 742 | 140,023 | ts (359) | **Real reference** |
| `openai-skills` | 773 | 111,332 | md (536) | Partial — skill defs, md-heavy |
| `camoufox` | 1,188 | 89,700 | py (142) | **Real reference** — fonts+driver |
| `context-mode` | 299 | 63,436 | ts (110) | Medium reference |
| `opcode` | 235 | 61,945 | tsx (90) | Medium reference |
| `magika` | 533 | 50,970 | md (58) | Medium reference — Google magika file-type classifier |
| `code-review-graph` | 195 | 48,292 | py (83) | Medium reference |
| `claude-context` | 164 | 32,191 | ts (44) | Small reference |
| `evolver` | 162 | 22,587 | js (145) | Small reference |
| `superpowers` | 142 | 21,822 | md (73) | Skeleton / skill-pack |
| `deepgemm` | 142 | 14,602 | hpp (49) | Small — CUDA GEMM kernels |
| `generic-agent` | 122 | 13,649 | py (35) | Skeleton |
| `open-swe` | 86 | 10,884 | py (67) | Skeleton |
| `clicky` | 84 | 10,563 | swift (25) | Skeleton — macOS click tool |
| `autonovel` | 57 | 10,233 | py (28) | Skeleton |
| `addyosmani-agent-skills` | 60 | 9,563 | md (50) | Skeleton — skill docs |
| `wacli` | 75 | 8,117 | go (60) | Skeleton — small Go CLI |
| `hermes-agent-self-evolution` | 29 | 4,670 | py (21) | Skeleton |
| `competitor-analysis` | 12 | 3,975 | md (12) | Internal notes (not a cloned repo) |
| `andrej-karpathy-skills` | 6 | 859 | md (4) | Near-empty — 6 files |
| `warp` | 12 | 810 | md (1) | Near-empty — 12 files |
| `awesome-design-systems` | 3 | 218 | md (1) | Near-empty — 3 files |

Plus `research/.broken/` (see §4.6) which duplicates 8 of the above.

**Total research/ LOC (excluding `.broken/`):** ~9.56 M. Dominant languages: `py` (2.38 M), `md` (2.22 M), `ts` (2.22 M).

---

## 6. Hidden-State Inventory

All paths relative to parent root unless noted.

### 6.1 `.nexus/` — V3-era Nexus Runtime

| Item | Type | Notes |
|---|---|---|
| `.nexus/memory.db` | SQLite DB | **156 KiB.** Primary candidate for a follow-up read (sqlite schema dump). Dated 2026-04-03 14:29. |
| `.nexus/memory.db-shm` | SQLite shared-mem | 32 KiB, still touched 2026-04-19T11:17 (suggests something is still attached). |
| `.nexus/memory.db-wal` | SQLite WAL | 0 bytes — clean WAL. |
| `.nexus/sessions/` | 9 JSON files | Session snapshots from UUIDs (e.g. `07e8d9be-0290-458d-be17-85f7edc5d311.json`). |
| `.nexus/episodes/memory/` | 1 subdir | `84327-1775441060/` (timestamp epoch 1775441060 ≈ 2026-04-02). |
| `.nexus/screenshots/` | empty | Created but never populated. |

**Action for Phase 2 Agent:** dump schema of `.nexus/memory.db` to know if it contains decisions/learnings that should be migrated to `wotann/.wotann/memory.db`.

### 6.2 `.swarm/` — Claude-flow Q-learning

| File | Size | Notes |
|---|---|---|
| `q-learning-model.json` | — | Q-table from claude-flow swarm experiments (Apr 3). |
| `state.json` | — | Swarm state snapshot. |

### 6.3 `.superpowers/` (parent) — Brainstorming Session

| Subdir | Notes |
|---|---|
| `brainstorm/` | 8 files; brainstorm content from Apr 7. Distinct from `wotann/.superpowers/` which has 31 files. |

### 6.4 `.claude-flow/` — Metrics

| File | Notes |
|---|---|
| `metrics/swarm-activity.json` | 138 B, Apr 3 — one-line metrics stub. |

### 6.5 `.playwright-mcp/` — Playwright Runtime Artifacts

| Content | Count | Notes |
|---|---|---|
| `*.yml` | 58 | Page snapshots from Playwright. |
| `*.log` (console-*) | 40 | Dated 2026-04-05 through 2026-04-08. Console logs from Tauri browser sessions. |
| `Ollama.dmg` | 1 | 105 MiB. Stale installer (see §4.8). |

### 6.6 `.claude/` (parent) — Claude Code Local Project State

| Item | Notes |
|---|---|
| `settings.local.json` | Per-project overrides. |
| `scheduled_tasks.lock` | Scheduled-task lock file. |
| `projects/-Users-gabrielvuksani-Desktop-agent-harness/` | Claude Code auto-memory home (the parent-level `MEMORY.md`). |

### 6.7 `.github/` (parent) — Lone Agent Def

| Item | Notes |
|---|---|
| `agents/planner.agent.md` | Parent-level planner agent definition (separate from `wotann/.github/workflows/` + agent defs). |

### 6.8 `wotann/.wotann/` — Active Wotann Runtime State

| Item | Type | Notes |
|---|---|---|
| `memory.db` + `memory.db-shm` + `memory.db-wal` | SQLite | Primary Engram-style memory store. `memory.db-wal` was 2.17 MiB at time of scan (active). |
| `memory 2.db-shm`/`-wal` ... `memory 5.db-shm`/`-wal` | SQLite orphans | **Dead weight** — see §4.7. Leaked replica files. |
| `knowledge-graph.json` | JSON | Active knowledge graph (49 B at scan time — likely just got reset). |
| `knowledge-graph.json.tmp.*` | JSON tempfiles | 20+ leaked atomic-write tempfiles (dead weight). |
| `logs/2026-04-06.jsonl` through `2026-04-19.jsonl` | JSONL | Daily log files; `2026-04-19.jsonl` = 827 KiB active. |
| `sessions/*.json` | JSON | 6 current-session UUID files. |
| `instincts.json`, `learnings.json`, `last-dream.json`, `daemon.status.json` | JSON | Runtime state. |
| `dreams/`, `episodes/`, `context-tree/` | dirs | Subsystem state. |
| `.shadow-git/objects/**` | git loose-object store | Snapshot engine's internal git — many `objects/??/*` under 10 KiB. |
| `AGENT-ROSTER.md`, `AGENTS.md`, `BOOTSTRAP.md`, `DESIGN.md`, `DREAMS.md`, `gotchas.md`, `HEARTBEAT.md`, `IDENTITY.md` | MD | 8 runtime-facing docs. |

---

## 7. Sorting

### 7.1 Main Table Sorted by Size Descending

See §1.2 for top-20. Full size-sorted list (all 66,914 files) lives at `/tmp/audit_a/sizes2.txt` on this machine. Format: `mtime_epoch|size_bytes|path`. To re-list:
```
sort -t'|' -k2 -rn /tmp/audit_a/sizes2.txt | head -N
```

### 7.2 Top-100 Most-Recent Files (mtime Descending, Cruft Filtered)

Generated at `/tmp/audit_a/top100_recent_iso.txt`. Top 30 shown; full 100 is numeric-sortable same way. All rows are meaningful work products (no `.wotann/` runtime churn, no build caches).

```
2026-04-19T10:29:05|3225|./wotann/tests/intelligence/tool-pattern-detector.test.ts
2026-04-19T10:28:53|5340|./wotann/src/intelligence/tool-pattern-detector.ts
2026-04-19T10:28:07|5007|./wotann/tests/learning/reflection-buffer.test.ts
2026-04-19T10:27:49|6414|./wotann/src/learning/reflection-buffer.ts
2026-04-19T10:26:59|3607|./wotann/tests/intelligence/chain-of-verification.test.ts
2026-04-19T10:26:47|4862|./wotann/src/intelligence/chain-of-verification.ts
2026-04-19T10:26:04|3552|./wotann/tests/memory/semantic-cache.test.ts
2026-04-19T10:25:49|5817|./wotann/src/memory/semantic-cache.ts
2026-04-19T10:25:06|4485|./wotann/tests/prompt/template-compiler.test.ts
2026-04-19T10:24:50|8494|./wotann/src/prompt/template-compiler.ts
2026-04-19T10:23:50|3024|./wotann/tests/orchestration/speculative-execution.test.ts
2026-04-19T10:23:39|4748|./wotann/src/orchestration/speculative-execution.ts
2026-04-19T10:22:58|4105|./wotann/tests/telemetry/token-estimator.test.ts
2026-04-19T10:22:40|5236|./wotann/src/telemetry/token-estimator.ts
2026-04-19T10:21:55|4817|./wotann/tests/providers/circuit-breaker.test.ts
2026-04-19T10:21:39|5891|./wotann/src/providers/circuit-breaker.ts
2026-04-19T10:20:57|4596|./wotann/tests/context/importance-compactor.test.ts
2026-04-19T10:20:38|6103|./wotann/src/context/importance-compactor.ts
2026-04-19T10:19:50|4116|./wotann/tests/orchestration/parallel-coordinator.test.ts
2026-04-19T10:19:36|4906|./wotann/src/orchestration/parallel-coordinator.ts
(... 80 more, all identical TDD src/tests pattern ...)
```

Pattern verified: the last ~60 files touched form disciplined `src/<domain>/<feat>.ts` + `tests/<domain>/<feat>.test.ts` pairs, matching one-for-one with the commit log (HEAD backwards). TDD is active.

---

## 8. PROMPT-LIES Caught

The audit prompt contains several claims this inventory disproves. Being brutally honest per the quality bar:

1. **"iOS dir is `wotann/ios/` (not `ios-app/`)"** — verified **correct** (`wotann/ios/` exists, no `ios-app/`). This one was accurate.

2. **"Screenshots at parent root: chat-*.png, depth-*.png, e2e-*.png, editor-space.png, exploit-*.png, command-palette.png, main-app-*.png, final-main-view.png, fix-layout-*.png, input-fix-check.png"**
   — **Incomplete.** The parent root also contains: `settings-appearance.png`, `settings-page.png`, `settings-providers.png`, `model-picker-open.png`, `notification-panel.png`, `onboarding-*.png` (7 variants), `spacing-fix-system.png`, `spacing-fix-welcome.png`, `wotann-engine.png`, `wotann-main-app.png`, `wotann-providers.png`, `wotann-system-check.png`, `wotann-welcome.png`, `workshop-space.png`, and `onboarding-step1.png`. Total PNGs at parent root is substantially more than the list implied.

3. **"Parent MDs: AGENT_FRAMEWORK_ANALYSIS.md, COMPETITIVE_ANALYSIS.md, COMPETITOR_FEATURE_COMPARISON_2026-04-03.md, COMPREHENSIVE_SOURCE_FINDINGS_2026-04-03.md, DEEP_SOURCE_EXTRACTION_2026-04-03.md, COMPUTER_CONTROL_ARCHITECTURE.md (~250KB)"**
   — **Partial.** `COMPUTER_CONTROL_ARCHITECTURE.md` does **not** exist at parent root — it lives at `research/COMPUTER_CONTROL_ARCHITECTURE.md` (48 KiB, not 250 KiB). Parent root also has **AGENTS.md, BUILD_GUIDE.md, ECOSYSTEM-CATALOG.md, MASTER_CONTINUATION_PROMPT.md, NEXUS_V1_SPEC_old.md, NEXUS_V2_SPEC_old.md, NEXUS_V3_SPEC_old.md, NEXUS_V4_SPEC.md (325 KiB), SOURCES.md, UNIFIED_SYSTEMS_RESEARCH.md, .abstract.md** that the prompt did not list. NEXUS_V4_SPEC.md is 333,824 bytes (325 KiB) — it is the ~250KB-ish doc the prompt was probably recalling.

4. **Implicit claim: exclusions `node_modules/`, `dist/`, `build/`, `target/`, `.next/`, `__pycache__/` suffice.**
   — **False.** `wotann/desktop-app/src-tauri/target-audit/` (6,622 files, 3.42 GiB) and `wotann/ios/.build/` (3,299 files, 278 MiB) are both build-cache directories that the prompt's exclusion list does **not** catch. Also `wotann-old-git-20260414_114728/` (685 MiB) is a git-directory backup with a different name than `.git`. These three together are ~4 GiB of "we probably shouldn't be walking this." Surfaced separately in §4.

5. **"`wotann/research` does NOT exist — research is at parent `agent-harness/research/` with 40+ cloned competitor repos"**
   — verified **correct** (`wotann/research/` does not exist; `research/` at parent has 39 active repos + 8 broken snapshots = 47 total, close to "40+").

6. **"Hidden state at parent: `.nexus/`, `.swarm/`, `.superpowers/`, `.claude-flow/`, `.playwright-mcp/`, `.github/`"**
   — **Incomplete.** Parent also has `.claude/` (3 files) and `.abstract.md` (not a dir but a hidden-name file). Also `tmp/` at parent root (not hidden but unmentioned) contains 3 orphan JSONs. Listed in §2 and §6.

7. **No mention in prompt of `wotann-old-git-20260414_114728/`** — a 692-file, 685 MiB sibling directory next to `wotann/`. It is by far the most surprising finding not covered by the prompt; past-Claude presumably renamed the .git during a history rewrite and forgot to delete it. Flagged in §4.2.

8. **No mention of `.broken/` inside `research/`** — 7,461 files, 168 MiB. Flagged in §4.6.

9. **No mention of `.wotann/` runtime state on wotann side**, only `.nexus/`. Yet `wotann/.wotann/` has 5,208 files and 202 MiB and contains the **active** memory.db, logs, knowledge graph, dreams, episodes, sessions, shadow-git. This is where the live runtime writes — it dwarfs `.nexus/` (which is a V3 vestige). Documented in §6.8.

10. **"Formula/"** — prompt did not mention it. `wotann/Formula/wotann.rb` is a Homebrew formula (56 LOC). Small but real.

11. **"python-scripts/"** — prompt did not mention it. `wotann/python-scripts/camoufox-driver.py` is the only file (341 LOC). Small but real.

12. **Node_modules at parent root has 2 files** (`.package-lock.json` + empty `.vite/` subdir). Effectively empty; not worth a directory. Surfaced for transparency.

---

## 9. Appendix: Raw Data Location

All intermediate data for reproducibility lives at `/tmp/audit_a/` on this host:
- `files_no_ds.txt` — all 66,914 paths, one per line, no `.DS_Store`.
- `sizes2.txt` — `epoch|bytes|path` for every file.
- `loc.txt` — `loc|path` for every code/text file (47,999 entries).
- `code_files.txt` — subset of sizes with an extension matching the code filter.
- `wotann_over500.txt` — 118 wotann source files > 500 LOC.
- `top100_recent_iso.txt` — 100 most-recent files with ISO timestamps.

Regeneration is idempotent; re-running the same `find | stat` + `wc -l` pipelines in `/tmp/audit_a/` should yield the same numbers within ±the count of leaked `.wotann/knowledge-graph.json.tmp.*` files (which churn every daemon tick).

---

*End of AUDIT_INVENTORY.md — Phase 1 Agent A.*
