# WOTANN Source-of-Truth Registry

Git HEAD: `aaf7ec2` • Generated 2026-04-19

> Phase 2 output of the WOTANN deep audit. Canonical inventory blocking Phases 3-14.


## 1. Executive Numbers

- **Total source files** (TypeScript under `src/**`): 481
- **Total source LOC**: 162,886
- **Total test files**: 307
- **Total test LOC**: 57,294
- **Total test cases** (`it()` / `test()`): 4,811
- **Files with matching test** (src/X.ts ⟷ tests/X.test.ts): 134 / 481 = 27.9%
- **Files without matching test**: 347
- **Avg consumer depth** (mean imports_in): 1.96
- **Total local imports resolved**: 942 static + dynamic
- **ORPHAN count** (imports_in = 0 and no dynamic reference): 89
- **Orphan LOC**: 21,453 (13.2% of source)
- **ENTRY points**: 6 (`src/index.ts`, `src/lib.ts`, `src/daemon/start.ts`, `src/mcp/mcp-server.ts`, `vendor-types.d.ts`, `ws-shim.d.ts`)
- **WIRED** (static imports_in > 0): 384
- **WIRED-DYNAMIC** (referenced via dynamic import): 2

**Status distribution:** 384 WIRED + 2 WIRED-DYNAMIC + 6 ENTRY + 89 ORPHAN = 481 total

### Surface LOC totals (for scope bracketing)

| Surface                                   | Files | Notes |
|---                                        |---    |---    |
| TypeScript core (`src/**`)                | 481 | 162,886 LOC |
| Tests (`tests/**`)                        | 307 | 57,294 LOC, 4,811 cases |
| Desktop React app (`desktop-app/src/**`) | 152 .ts[x] (134 .tsx) | Vite + Tauri frontend |
| Tauri Rust shell (`desktop-app/src-tauri/src/**`) | 17 .rs | Hotkeys, sidecar, IPC, remote-control |
| iOS app (`ios/**`)                        | 128 .swift (excluding .build) | SwiftUI, Watch, Intents, Widgets, ShareExt |
| Python scripts                            | 1 .py (camoufox-driver.py) | stealth browser driver |

## 2. Module Table (481 rows)

See full CSV at `docs/WOTANN_INVENTORY.tsv`. Below is the top-100 most-imported + top-20 largest by LOC. Abbreviations: `in` = imports-in, `out` = imports-out, `T` = has test, `—` = no test.

### Top 30 most-imported (hub modules)

| Path | LOC | in | out | Status | Test | SHA |
|---|---:|---:|---:|---|---|---|
| `src/core/types.ts` | 250 | 62 | 0 | WIRED | — | `4d41702` |
| `src/core/runtime.ts` | 4843 | 28 | 169 | WIRED | — | `89b4f56` |
| `src/providers/types.ts` | 124 | 24 | 1 | WIRED | — | `343ceb3` |
| `src/memory/store.ts` | 1994 | 21 | 5 | WIRED | — | `79ff6f0` |
| `src/prompt/engine.ts` | 529 | 20 | 6 | WIRED | — | `85015cf` |
| `src/middleware/types.ts` | 97 | 15 | 1 | WIRED | — | `993d661` |
| `src/channels/gateway.ts` | 329 | 13 | 3 | WIRED | — | `993d661` |
| `src/context/limits.ts` | 722 | 12 | 0 | WIRED | — | `993d661` |
| `src/cli/runtime-query.ts` | 77 | 10 | 3 | WIRED | — | `993d661` |
| `src/core/mode-cycling.ts` | 306 | 10 | 1 | WIRED | — | `993d661` |
| `src/lsp/symbol-operations.ts` | 886 | 10 | 14 | WIRED | — | `5d31766` |
| `src/providers/discovery.ts` | 768 | 10 | 5 | WIRED | — | `cb55d53` |
| `src/channels/adapter.ts` | 189 | 9 | 3 | WIRED | — | `993d661` |
| `src/connectors/connector-registry.ts` | 188 | 9 | 0 | WIRED | — | `993d661` |
| `src/providers/provider-service.ts` | 1306 | 8 | 7 | WIRED | — | `81700d2` |
| `src/channels/channel-types.ts` | 25 | 7 | 0 | WIRED | — | `993d661` |
| `src/channels/dispatch.ts` | 324 | 7 | 10 | WIRED | — | `993d661` |
| `src/orchestration/autonomous.ts` | 1281 | 7 | 1 | WIRED | — | `5de7521` |
| `src/autopilot/types.ts` | 82 | 6 | 1 | WIRED | — | `cb3d661` |
| `src/intelligence/codebase-health.ts` | 408 | 6 | 3 | WIRED | — | `993d661` |
| `src/utils/shadow-git.ts` | 169 | 6 | 4 | WIRED | — | `11a26e0` |
| `src/acp/protocol.ts` | 290 | 5 | 0 | WIRED | T | `436d8f0` |
| `src/daemon/kairos-ipc.ts` | 723 | 5 | 6 | WIRED | T | `cb55d53` |
| `src/daemon/kairos.ts` | 1750 | 5 | 84 | WIRED | — | `a5827fd` |
| `src/desktop/types.ts` | 237 | 5 | 0 | WIRED | — | `993d661` |
| `src/providers/account-pool.ts` | 293 | 5 | 1 | WIRED | — | `6ca693d` |
| `src/providers/format-translator.ts` | 333 | 5 | 1 | WIRED | — | `6ca693d` |
| `src/browser/camoufox-backend.ts` | 593 | 4 | 6 | WIRED | — | `f938f08` |
| `src/cli/commands.ts` | 458 | 4 | 13 | WIRED | — | `c5d0838` |
| `src/context/inspector.ts` | 237 | 4 | 0 | WIRED | — | `993d661` |

### Top 30 largest source files

| Path | LOC | in | out | Status | Test | SHA |
|---|---:|---:|---:|---|---|---|
| `src/daemon/kairos-rpc.ts` | 5375 | 3 | 73 | WIRED | T | `070aa4c` |
| `src/core/runtime.ts` | 4843 | 28 | 169 | WIRED | — | `89b4f56` |
| `src/index.ts` | 3655 | 0 | 139 | ENTRY | — | `e3c3ca8` |
| `src/desktop/companion-server.ts` | 2075 | 2 | 25 | WIRED | T | `31521da` |
| `src/memory/store.ts` | 1994 | 21 | 5 | WIRED | — | `79ff6f0` |
| `src/daemon/kairos.ts` | 1750 | 5 | 84 | WIRED | — | `a5827fd` |
| `src/providers/provider-service.ts` | 1306 | 8 | 7 | WIRED | — | `81700d2` |
| `src/orchestration/autonomous.ts` | 1281 | 7 | 1 | WIRED | — | `5de7521` |
| `src/hooks/built-in.ts` | 1252 | 1 | 9 | WIRED | — | `b9763f8` |
| `src/intelligence/forgecode-techniques.ts` | 1075 | 3 | 3 | WIRED | — | `993d661` |
| `src/lib.ts` | 1039 | 0 | 143 | ENTRY | — | `ace6cea` |
| `src/lsp/symbol-operations.ts` | 886 | 10 | 14 | WIRED | — | `5d31766` |
| `src/intelligence/accuracy-boost.ts` | 873 | 2 | 4 | WIRED | — | `cb3d661` |
| `src/computer-use/platform-bindings.ts` | 854 | 2 | 6 | WIRED | — | `f938f08` |
| `src/security/guardrails-off.ts` | 842 | 2 | 3 | WIRED | — | `518e38e` |
| `src/mobile/ios-app.ts` | 837 | 2 | 5 | WIRED | T | `cb3d661` |
| `src/computer-use/perception-engine.ts` | 820 | 3 | 9 | WIRED | — | `993d661` |
| `src/daemon/automations.ts` | 800 | 1 | 4 | WIRED | — | `cb3d661` |
| `src/voice/tts-engine.ts` | 780 | 2 | 5 | WIRED | — | `0ba8cea` |
| `src/marketplace/registry.ts` | 779 | 3 | 8 | WIRED | — | `0c136e4` |
| `src/providers/discovery.ts` | 768 | 10 | 5 | WIRED | — | `cb55d53` |
| `src/memory/graph-rag.ts` | 762 | 3 | 1 | WIRED | T | `993d661` |
| `src/orchestration/plan-store.ts` | 759 | 2 | 4 | WIRED | T | `993d661` |
| `src/daemon/kairos-ipc.ts` | 723 | 5 | 6 | WIRED | T | `cb55d53` |
| `src/context/limits.ts` | 722 | 12 | 0 | WIRED | — | `993d661` |
| `src/skills/loader.ts` | 713 | 4 | 6 | WIRED | — | `993d661` |
| `src/voice/voice-mode.ts` | 705 | 2 | 4 | WIRED | — | `a687abd` |
| `src/context/window-intelligence.ts` | 689 | 4 | 1 | WIRED | — | `ad37d2c` |
| `src/voice/stt-detector.ts` | 685 | 2 | 4 | WIRED | — | `0ba8cea` |
| `src/learning/skill-forge.ts` | 673 | 2 | 4 | WIRED | T | `993d661` |

> Full table: 481 rows available in `docs/WOTANN_INVENTORY.tsv` (tab-separated).


## 3. Orphan List (imports_in = 0, no dynamic consumer)

89 files (21,453 LOC, 13.2% of source) are never imported by any other `src/**` module (static OR dynamic). These are the primary candidates for the Phase 4c 'library-only-no-wiring' report.

Grouped by directory (with LOC in parentheses, `T` if a sibling test exists):

**`src/acp/`** (1 files, 138 LOC)
  - T `thread-handlers.ts` (138 LOC) `436d8f0`

**`src/autopilot/`** (2 files, 560 LOC)
  - T `checkpoint.ts` (290 LOC) `00d1ffc`
  - T `trajectory-recorder.ts` (270 LOC) `497828c`

**`src/channels/`** (1 files, 116 LOC)
  - T `terminal-mention.ts` (116 LOC) `a3c9372`

**`src/cli/`** (6 files, 1,121 LOC)
  - — `debug-share.ts` (321 LOC) `5d31766`
  - — `history-picker.ts` (215 LOC) `993d661`
  - — `incognito.ts` (131 LOC) `993d661`
  - — `onboarding.ts` (185 LOC) `993d661`
  - — `pipeline-mode.ts` (165 LOC) `993d661`
  - — `test-provider.ts` (104 LOC) `993d661`

**`src/connectors/`** (5 files, 1,392 LOC)
  - — `confluence.ts` (158 LOC) `993d661`
  - — `google-drive.ts` (278 LOC) `993d661`
  - — `jira.ts` (291 LOC) `993d661`
  - — `linear.ts` (342 LOC) `993d661`
  - — `notion.ts` (323 LOC) `993d661`

**`src/context/`** (1 files, 182 LOC)
  - T `importance-compactor.ts` (182 LOC) `992d92a`

**`src/core/`** (9 files, 2,380 LOC)
  - — `agent-profiles.ts` (147 LOC) `22cecf2`
  - — `claude-sdk-bridge.ts` (178 LOC) `cb55d53`
  - — `content-cid.ts` (165 LOC) `ebc5726`
  - — `deep-link.ts` (273 LOC) `993d661`
  - — `prompt-override.ts` (230 LOC) `378e710`
  - — `runtime-tool-dispatch.ts` (454 LOC) `b49ce09`
  - — `runtime-tools.ts` (257 LOC) `b49ce09`
  - — `schema-migration.ts` (346 LOC) `cb3d661`
  - — `wotann-yml.ts` (330 LOC) `b5cd165`

**`src/daemon/`** (1 files, 193 LOC)
  - — `auto-update.ts` (193 LOC) `993d661`

**`src/desktop/`** (1 files, 214 LOC)
  - — `desktop-store.ts` (214 LOC) `ad37d2c`

**`src/intelligence/`** (10 files, 2,405 LOC)
  - T `adversarial-test-generator.ts` (338 LOC) `5cba72b`
  - T `answer-normalizer.ts` (269 LOC) `78793c0`
  - T `budget-enforcer.ts` (191 LOC) `603fe15`
  - T `chain-of-verification.ts` (139 LOC) `ac92dfe`
  - T `confidence-calibrator.ts` (220 LOC) `8267f13`
  - T `multi-patch-voter.ts` (222 LOC) `9491750`
  - T `policy-injector.ts` (248 LOC) `c119c6e`
  - T `search-providers.ts` (257 LOC) `19a686d`
  - T `strict-schema.ts` (360 LOC) `de202e4`
  - T `tool-pattern-detector.ts` (161 LOC) `aaf7ec2`

**`src/learning/`** (3 files, 580 LOC)
  - T `darwinian-evolver.ts` (197 LOC) `870a01f`
  - T `miprov2-optimizer.ts` (183 LOC) `c06d3cc`
  - T `reflection-buffer.ts` (200 LOC) `694503b`

**`src/lsp/`** (1 files, 333 LOC)
  - T `lsp-tools.ts` (333 LOC) `45208ee`

**`src/meet/`** (1 files, 222 LOC)
  - T `meeting-runtime.ts` (222 LOC) `b7924fc`

**`src/memory/`** (11 files, 3,501 LOC)
  - T `contextual-embeddings.ts` (212 LOC) `81c7a48`
  - T `dual-timestamp.ts` (296 LOC) `cc18611`
  - T `entity-types.ts` (236 LOC) `f764929`
  - T `hybrid-retrieval.ts` (255 LOC) `b4a0bc4`
  - T `incremental-indexer.ts` (256 LOC) `aef3314`
  - T `mem-palace.ts` (267 LOC) `c7eec26`
  - T `memory-benchmark.ts` (530 LOC) `993d661`
  - — `memory-tools.ts` (580 LOC) `563f666`
  - — `memvid-backend.ts` (393 LOC) `993d661`
  - T `relationship-types.ts` (281 LOC) `4bb5852`
  - T `semantic-cache.ts` (195 LOC) `0e2d232`

**`src/middleware/`** (2 files, 566 LOC)
  - T `file-type-gate.ts` (357 LOC) `af46533`
  - — `forced-verification.ts` (209 LOC) `993d661`

**`src/orchestration/`** (3 files, 566 LOC)
  - T `code-mode.ts` (281 LOC) `312a597`
  - T `parallel-coordinator.ts` (148 LOC) `5f2d1e1`
  - T `speculative-execution.ts` (137 LOC) `acb65b6`

**`src/prompt/`** (2 files, 453 LOC)
  - T `template-compiler.ts` (276 LOC) `3d10d81`
  - T `think-in-code.ts` (177 LOC) `1385798`

**`src/providers/`** (6 files, 1,306 LOC)
  - T `budget-downgrader.ts` (162 LOC) `0d1eef3`
  - T `circuit-breaker.ts` (186 LOC) `5b31410`
  - — `harness-profiles.ts` (242 LOC) `518e38e`
  - T `prompt-cache-warmup.ts` (315 LOC) `a5137c7`
  - T `retry-strategies.ts` (227 LOC) `37bfea5`
  - — `usage-intelligence.ts` (174 LOC) `993d661`

**`src/runtime-hooks/`** (1 files, 186 LOC)
  - T `dead-code-hooks.ts` (186 LOC) `621689a`

**`src/sandbox/`** (4 files, 1,067 LOC)
  - T `approval-rules.ts` (228 LOC) `d092d70`
  - T `extended-backends.ts` (237 LOC) `f25a8d0`
  - T `output-isolator.ts` (284 LOC) `89b4f56`
  - T `unified-exec.ts` (318 LOC) `dada187`

**`src/skills/`** (2 files, 390 LOC)
  - T `skill-compositor.ts` (192 LOC) `23419ec`
  - T `skill-optimizer.ts` (198 LOC) `8ff5197`

**`src/telemetry/`** (1 files, 158 LOC)
  - T `token-estimator.ts` (158 LOC) `2d4663c`

**`src/tools/`** (5 files, 1,193 LOC)
  - — `monitor.ts` (240 LOC) `aa09786`
  - — `pdf-processor.ts` (269 LOC) `993d661`
  - — `post-callback.ts` (192 LOC) `993d661`
  - T `task-tool.ts` (366 LOC) `993d661`
  - — `tool-timing.ts` (126 LOC) `993d661`

**`src/ui/`** (6 files, 1,374 LOC)
  - T `context-meter.ts` (159 LOC) `79f4d9e`
  - — `context-references.ts` (660 LOC) `cb3d661`
  - — `helpers.ts` (141 LOC) `993d661`
  - — `keybindings.ts` (79 LOC) `993d661`
  - — `themes.ts` (234 LOC) `993d661`
  - — `voice-controller.ts` (101 LOC) `993d661`

**`src/ui/raven/`** (1 files, 229 LOC)
  - — `raven-state.ts` (229 LOC) `1ab289d`

**`src/utils/`** (2 files, 181 LOC)
  - — `logger.ts` (98 LOC) `993d661`
  - — `platform.ts` (83 LOC) `993d661`

**`src/workflows/`** (1 files, 447 LOC)
  - T `workflow-runner.ts` (447 LOC) `1386c5d`

### Orphan sub-categorization

| Category | Count | Signal | Primary takeaway |
|---|---:|---|---|
| Orphans WITH test (library-only-no-wiring)    | 50 | test asserts behavior that production never invokes | Phase 4c drift alert |
| Orphans WITHOUT test (pure dead code)         | 39 | no consumer, no verification | Phase 4d deletion candidate |

## 4. Test-less Source (WIRED modules with no `.test.ts`)

308 files are actively imported but have **no** matching `tests/<path>.test.ts`. This is the Phase 4 coverage-gap list.

> Note: Some of these are covered by cross-cutting integration tests (e.g. `tests/integration/*.test.ts`, `tests/providers/adapter-multi-turn.test.ts`). Those 173 tests without 1:1 source mapping (see Section 11) may cover some entries here.

| Directory | Count | Sample files |
|---|---:|---|
| `src/providers/` | 31 | `account-pool.ts`, `anthropic-adapter.ts`, `anthropic-subscription.ts`, … +28 |
| `src/intelligence/` | 28 | `accuracy-boost.ts`, `ambient-awareness.ts`, `amplifier.ts`, … +25 |
| `src/channels/` | 23 | `adapter.ts`, `auto-detect.ts`, `base-adapter.ts`, … +20 |
| `src/prompt/modules/` | 18 | `capabilities.ts`, `channels.ts`, `conventions.ts`, … +15 |
| `src/orchestration/` | 17 | `agent-registry.ts`, `architect-editor.ts`, `arena.ts`, … +14 |
| `src/core/` | 16 | `agent-bridge.ts`, `config-discovery.ts`, `config.ts`, … +13 |
| `src/middleware/` | 16 | `auto-install.ts`, `doom-loop.ts`, `intent-gate.ts`, … +13 |
| `src/cli/` | 14 | `audit.ts`, `autofix-pr.ts`, `away-summary.ts`, … +11 |
| `src/memory/` | 13 | `active-memory.ts`, `context-loader.ts`, `context-tree-files.ts`, … +10 |
| `src/security/` | 12 | `anti-distillation.ts`, `archive-preflight.ts`, `auto-classifier.ts`, … +9 |
| `src/context/` | 10 | `compaction.ts`, `context-replay.ts`, `context-sharding.ts`, … +7 |
| `src/learning/` | 9 | `autodream.ts`, `cross-session.ts`, `decision-ledger.ts`, … +6 |
| `src/telemetry/` | 9 | `audit-trail.ts`, `benchmarks.ts`, `cost-oracle.ts`, … +6 |
| `src/daemon/` | 7 | `automations.ts`, `background-workers.ts`, `cron-utils.ts`, … +4 |
| `src/hooks/` | 6 | `auto-archive.ts`, `benchmark-engineering.ts`, `built-in.ts`, … +3 |
| `src/utils/` | 6 | `atomic-io.ts`, `shadow-git.ts`, `sidecar-downloader.ts`, … +3 |
| `src/autopilot/` | 5 | `ci-feedback.ts`, `completion-oracle.ts`, `oracle-worker.ts`, … +2 |
| `src/computer-use/` | 5 | `computer-agent.ts`, `perception-adapter.ts`, `perception-engine.ts`, … +2 |
| `src/voice/` | 5 | `edge-tts-backend.ts`, `stt-detector.ts`, `tts-engine.ts`, … +2 |
| `src/desktop/` | 4 | `layout.ts`, `supabase-relay.ts`, `tauri-config.ts`, … +1 |
| `src/` | 4 | `index.ts`, `lib.ts`, `vendor-types.d.ts`, … +1 |
| `src/skills/` | 4 | `agentskills-registry.ts`, `eval.ts`, `loader.ts`, … +1 |
| `src/tools/` | 4 | `encoding-detector.ts`, `hash-anchored-edit.ts`, `hashline-edit.ts`, … +1 |
| `src/ui/` | 4 | `agent-fleet-dashboard.ts`, `bootstrap.ts`, `canvas.ts`, … +1 |
| `src/identity/` | 3 | `persona.ts`, `reasoning-engine.ts`, `user-model.ts` |
| `src/intelligence/benchmark-runners/` | 3 | `aider-polyglot.ts`, `code-eval.ts`, `terminal-bench.ts` |
| `src/meet/` | 3 | `coaching-engine.ts`, `meeting-pipeline.ts`, `meeting-store.ts` |
| `src/prompt/` | 3 | `engine.ts`, `instruction-provenance.ts`, `model-formatter.ts` |
| `src/sandbox/` | 3 | `executor.ts`, `security.ts`, `terminal-backends.ts` |
| `src/testing/` | 3 | `prompt-regression.ts`, `screen-aware.ts`, `visual-verifier.ts` |
| `src/agents/` | 2 | `background-agent.ts`, `required-reading.ts` |
| `src/auth/` | 2 | `login.ts`, `oauth-server.ts` |
| `src/browser/` | 2 | `camoufox-backend.ts`, `chrome-bridge.ts` |
| `src/connectors/` | 2 | `connector-registry.ts`, `slack.ts` |
| `src/marketplace/` | 2 | `manifest.ts`, `registry.ts` |
| `src/plugins/` | 2 | `lifecycle.ts`, `manager.ts` |
| `src/providers/tool-parsers/` | 2 | `index.ts`, `parsers.ts` |
| `src/api/` | 1 | `server.ts` |
| `src/lsp/` | 1 | `symbol-operations.ts` |
| `src/mobile/` | 1 | `ios-types.ts` |
| `src/monitoring/` | 1 | `source-monitor.ts` |
| `src/training/` | 1 | `trajectory-extractor.ts` |
| `src/verification/` | 1 | `pre-commit.ts` |

## 5. Provider Adapter Table (21 rows)

19 ProviderName values in `src/core/types.ts`, mapped via `src/providers/registry.ts` switch. Two dedicated auth-flavor adapters: `anthropic-subscription` (OAuth) and `anthropic-adapter` (API key); plus reusable `openai-compat-adapter` for 15 chat-completions providers.

| Provider | Auth Env | Endpoint | Stream | Tools | Vision | Cache | Wired |
|---|---|---|:---:|:---:|:---:|:---:|:---:|
| `anthropic` | ANTHROPIC_API_KEY (or oauth) | @anthropic-ai/sdk (api.anthropic.com) | Y | Y | Y | Y | Y |
| `anthropic-subscription` | claude.ai session cookie | OAuth token via CLAUDE_CODE_OAUTH_TOKEN | Y | Y | Y | Y | Y |
| `openai` | OPENAI_API_KEY | api.openai.com/v1 | Y | Y | Y | N | Y |
| `openai-compat` | varies | configurable baseUrl | Y | Y | Y | N | Y (multiplexed) |
| `codex` | CODEX_JWT (ChatGPT) | chatgpt.com/backend-api | Y | Y | Y | N | Y |
| `copilot` | GITHUB_TOKEN (PAT) | api.githubcopilot.com | Y | Y | Y | N | Y |
| `gemini-native` | GEMINI_API_KEY | generativelanguage.googleapis.com | Y | Y | Y | Y (implicit) | Y |
| `ollama` | local (OLLAMA_HOST) | http://localhost:11434 | Y | Y | partial | N | Y |
| `bedrock` | AWS_ACCESS_KEY_ID + SECRET | bedrock-runtime.<region>.amazonaws.com (SigV4) | Y | Y | Y | N | Y |
| `vertex` | GOOGLE_APPLICATION_CREDENTIALS (JWT exchange) | <region>-aiplatform.googleapis.com | Y | Y | Y | N | Y |
| `free (groq/cerebras)` | GROQ_API_KEY or CEREBRAS_API_KEY | api.groq.com or api.cerebras.ai (OpenAI-compat) | Y | Y | N | N | Y |
| `huggingface` | HF_TOKEN | router.huggingface.co/v1 | Y | Y | Y | N | Y |
| `azure` | AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT + AZURE_OPENAI_DEPLOYMENT | user-configured endpoint (path deployment + api-version qs) | Y | Y | Y | N | Y |
| `mistral` | MISTRAL_API_KEY | api.mistral.ai/v1 | Y | Y | N | N | Y |
| `deepseek` | DEEPSEEK_API_KEY | api.deepseek.com | Y | Y | N | N | Y |
| `perplexity` | PERPLEXITY_API_KEY | api.perplexity.ai | Y | partial | N | N | Y |
| `xai` | XAI_API_KEY | api.x.ai | Y | Y | Y | N | Y |
| `together` | TOGETHER_API_KEY | api.together.xyz/v1 | Y | Y | partial | N | Y |
| `fireworks` | FIREWORKS_API_KEY | api.fireworks.ai/inference/v1 | Y | Y | partial | N | Y |
| `sambanova` | SAMBANOVA_API_KEY | api.sambanova.ai | Y | Y | N | N | Y |
| `groq` | GROQ_API_KEY | api.groq.com/openai/v1 | Y | Y | N | N | Y |

**Notes:**
- Wiring confirmed by inspection of `src/providers/registry.ts` (switch statement line 51-367).
- `anthropic-subscription.ts` exists as a separate file but is chosen dynamically via `auth.method === 'oauth-token'`.
- `prompt-cache-warmup.ts` and `extended-thinking.ts` in `src/providers/` are capability helpers; `prompt-cache-warmup.ts` is currently ORPHAN (see §3).
- `bedrock-signer.ts` implements AWS SigV4 from scratch (no `@aws-sdk/*` dependency), a Session-10 fix.

## 6. Channel Adapter Table

From `src/channels/` (25 files). Daemon wires channels via dynamic imports in `src/daemon/kairos.ts` lines 736-881.

| Channel | Direction | Auth | Wired |
|---|---|---|:---:|
| `webchat` | bidirectional | none (public demo) | Y (via WOTANN_CHANNELS_WEBCHAT=1) |
| `telegram` | bidirectional | TELEGRAM_BOT_TOKEN | Y (TELEGRAM_BOT_TOKEN) |
| `slack` | bidirectional | SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET | Y |
| `discord` | bidirectional | DISCORD_BOT_TOKEN | Y |
| `signal` | bidirectional | signal-cli-rest bridge | Y |
| `whatsapp` | bidirectional | WHATSAPP_ACCESS_TOKEN + phone num ID | Y |
| `email` | bidirectional | SMTP/IMAP creds | Y |
| `webhook` | outbound mostly | URL/secret | Y |
| `sms` | bidirectional | TWILIO_SID + TWILIO_TOKEN | Y |
| `matrix` | bidirectional | MATRIX_HS_URL + MATRIX_ACCESS_TOKEN | Y |
| `teams` | bidirectional | TEAMS_APP_ID + TEAMS_APP_PASSWORD | Y |
| `imessage (gateway)` | bidirectional | BlueBubbles/Beeper relay URL | Y (via IMessageGatewayAdapter) |
| `irc` | bidirectional | IRC server + nick | Y |
| `google-chat` | bidirectional | GOOGLE_CHAT_SERVICE_ACCOUNT_JSON | Y |
| `github-bot` | bidirectional | GITHUB_APP_PRIVATE_KEY + GITHUB_APP_ID | Y (auto-wired in kairos constructor) |
| `ide-bridge` | bidirectional | local socket | Y |
| `terminal-mention` | inbound | local scan | N (orphan) |
| `imessage (direct)` | bidirectional | macOS Messages app (AppleScript) | ?partial |
| `sms (Twilio alt)` | via sms.ts |  | (covered by sms) |

**Notes:**
- `src/channels/terminal-mention.ts` is ORPHAN (no production consumer).
- `src/channels/imessage.ts` (macOS AppleScript direct) vs `imessage-gateway-adapter.ts` (BlueBubbles relay) — gateway is the wired path; direct may be legacy.
- Gateway hub `src/channels/gateway.ts` is one of the most-imported files (in=13).
- `src/channels/route-policies.ts` and `channel-types.ts` provide shared typing.

## 7. Benchmark Runner Table

Located under `src/intelligence/benchmark-runners/` (not `src/eval/` or top-level `benchmarks/` — those directories do not exist in HEAD).

| Runner | File | Corpus requirement | Executable today? |
|---|---|---|---|
| aider-polyglot | `src/intelligence/benchmark-runners/aider-polyglot.ts` | requires polyglot-benchmark submodule | (no corpus wired on disk) |
| terminal-bench | `src/intelligence/benchmark-runners/terminal-bench.ts` | requires official corpus | (no corpus; test uses fake runtime) |
| code-eval | `src/intelligence/benchmark-runners/code-eval.ts` | HumanEval-style JSONL tasks | (in-memory smoke corpus) |

- Harness: `src/intelligence/benchmark-harness.ts`
- Test: `tests/intelligence/benchmark-runners.test.ts` — 'exercises the RunnerRuntime structural interface with an in-memory fake runtime… No actual LLM / Docker / pip dependencies touched.' So nothing runs real benchmarks on CI or locally.
- No SWE-bench, τ-bench, or real TerminalBench corpus present on disk in HEAD.
- CLI: `wotann bench` command exists (confirmed via `.command('bench')` in index.ts) but launches the structural harness.

## 8. Cross-Surface Feature Counts

| Surface | Count | Source |
|---|---:|---|
| **TUI commands** (top-level `commander.command(...)` in index.ts) | **74** | `src/index.ts` |
| **Desktop GUI views** (`.tsx` under `desktop-app/src/**`) | **134** | `desktop-app/src/` |
| **Desktop components total** (`.tsx` + non-tsx .ts) | 152 | `desktop-app/src/` |
| **iOS SwiftUI source files** (`.swift` excluding .build/DerivedData) | **128** | `ios/WOTANN`, `ios/WOTANN*` extensions |
| **iOS views in `WOTANN/Views/`** | **83** | `ios/WOTANN/Views/` |
| **Watch (Apple Watch app files)**  | **1** | `ios/WOTANNWatch/WOTANNWatchApp.swift` |
| **CarPlay integration files** | **1** | `ios/WOTANN/Services/CarPlayService.swift` |
| **Intent extensions** | **4** | `ios/WOTANNIntents/*.swift` (AskWOTANN, CheckCost, EnhancePrompt, IntentService) |
| **Widget bundles** | **3** | `ios/WOTANNWidgets/*.swift` (CostWidget, AgentStatusWidget, WOTANNWidgetBundle) |
| **Share extension files** | **2** | `ios/WOTANNShareExtension/*.swift` |
| **Tauri Rust entry files** | **17** | `desktop-app/src-tauri/src/` |
| **Python helper scripts** | **1** | `python-scripts/camoufox-driver.py` |

### CLI command inventory (74, alphabetical)

- `acp`                    • `architect`              • `arena`                 
- `audit`                  • `autofix-pr`             • `autonomous`            
- `available`              • `bench`                  • `benchmark`             
- `channels`               • `check`                  • `ci`                    
- `cli-registry`           • `config`                 • `context`               
- `cost`                   • `council`                • `cu`                    
- `daemon`                 • `decisions`              • `doctor`                
- `dream`                  • `engine`                 • `enhance`               
- `export-agentskills`     • `extract`                • `git`                   
- `guard`                  • `health`                 • `hover`                 
- `import`                 • `init`                   • `install`               
- `kanban`                 • `link`                   • `list`                  
- `local`                  • `login`                  • `lsp`                   
- `mcp`                    • `memory`                 • `mine`                  
- `next`                   • `onboard`                • `outline`               
- `policy-add`             • `policy-list`            • `policy-remove`         
- `precommit`              • `providers`              • `refs`                  
- `rename`                 • `repl`                   • `repos`                 
- `research`               • `resume`                 • `route`                 
- `run`                    • `search`                 • `self-improve`          
- `serve`                  • `skills`                 • `start`                 
- `status`                 • `stop`                   • `symbols`               
- `sync`                   • `team`                   • `team-onboarding`       
- `train`                  • `verify`                 • `voice`                 
- `watch`                  • `worker`                

## 9. Drift Flags (memory vs. code)

Claims on record (from MEMORY.md / session transcripts / CLAUDE.md) cross-checked against HEAD `aaf7ec2`:

| Claim | Verdict | Evidence |
|---|:---:|---|
| 11 provider adapters wired | **actually 19** | `src/core/types.ts` ProviderName union enumerates 19 providers; all 19 have a `case` in `src/providers/registry.ts:51-367` |
| Gemma 4 bundled | **NOT in HEAD** | no `gemma*` in `src/providers/` or `src/`, no local-model weights paths configured. `huggingface` adapter exists. |
| 223 features | unverifiable via code alone | spec is high-level; no single-file feature registry |
| 325KB / 7927-line SPEC | matches | WOTANN spec in user memory (`project_nexus_v4.md`), not checked-in; docs/ has multiple synthesized audits |
| `src/core/` composition root | **confirmed** | 28 files, `runtime.ts` is the largest (4843 LOC) and 2nd most-imported (in=28) |
| 16-layer middleware pipeline | **confirmed via directory** | `src/middleware/` has 16+ `.ts` modules (pipeline, fallback-chain, non-interactive, etc.) |
| Gateway-bus architecture for channels | **confirmed** | `src/channels/gateway.ts` (in=13) is central hub; dynamic-imported from daemon |
| 65+ skills, progressive disclosure | **NOT fully visible** | `src/skills/` has 14 .ts files (`skill-compositor.ts`, `skill-optimizer.ts` both ORPHAN). Skill marketplace is external (`src/marketplace/`) |
| 8-layer memory store | partial | `src/memory/` has 38 files; only half have consumers |
| TUI from Phase 0 | **confirmed present** | `src/ui/` has 21 files, 74 CLI commands |
| 4 tabs (Chat / Editor / Workshop / Exploit) | **confirmed GUI** | `desktop-app/src/components/{chat,editor,workshop,exploit}/` all exist |
| iOS: SwiftUI + Watch + CarPlay + Intents + Widgets + ShareExt | **confirmed** | all 6 targets present in `ios/`, Xcode project `WOTANN.xcodeproj` |
| Shadow-git singleton threaded | **confirmed via tests** | `tests/integration/shadow-git-singleton.test.ts` exists |

## 10. Test Inventory

- Total test files: 307
- Total test cases: 4811
- Tests with 1:1 source mapping (tests/X.test.ts for src/X.ts): 134
- Tests without 1:1 source mapping (integration, e2e, cross-cutting): 173

**Test directory breakdown** (files per subdirectory):

| Directory | Files |
|---|---:|
| `tests/unit/` | 149 |
| `tests/intelligence/` | 22 |
| `tests/memory/` | 22 |
| `tests/desktop/` | 10 |
| `tests/orchestration/` | 10 |
| `tests/providers/` | 10 |
| `tests/integration/` | 9 |
| `tests/learning/` | 7 |
| `tests/sandbox/` | 7 |
| `tests/daemon/` | 6 |
| `tests/acp/` | 5 |
| `tests/training/` | 5 |
| `tests/channels/` | 4 |
| `tests/core/` | 4 |
| `tests/security/` | 4 |
| `tests/skills/` | 4 |
| `tests/middleware/` | 3 |
| `tests/mobile/` | 3 |
| `tests/autopilot/` | 2 |
| `tests/context/` | 2 |
| `tests/prompt/` | 2 |
| `tests/tools/` | 2 |
| `tests/ui/` | 2 |
| `tests/browser/` | 1 |
| `tests/e2e/` | 1 |
| `tests/git/` | 1 |
| `tests/lsp/` | 1 |
| `tests/mcp/` | 1 |
| `tests/meet/` | 1 |
| `tests/runtime-hooks/` | 1 |
| `tests/telemetry/` | 1 |
| `tests/testing/` | 1 |
| `tests/unit/orchestration/` | 1 |
| `tests/unit/prompt/` | 1 |
| `tests/voice/` | 1 |
| `tests/workflows/` | 1 |

### Tests without a matching source file (173)

These tests exercise cross-cutting behavior, multi-file integration, or wiring paths — they are NOT anti-signals on their own, but they deserve cross-check in Phase 4d.

Top 20 by test case count:

| Test file | LOC | #cases |
|---|---:|---:|
| `tests/memory/temporal-qa.test.ts` | 358 | 44 |
| `tests/unit/context-references.test.ts` | 467 | 42 |
| `tests/unit/prompt/model-formatter.test.ts` | 320 | 39 |
| `tests/unit/rules-of-engagement.test.ts` | 512 | 39 |
| `tests/unit/vector-store.test.ts` | 515 | 37 |
| `tests/providers/tool-parsers.test.ts` | 315 | 36 |
| `tests/unit/accuracy-boost.test.ts` | 360 | 36 |
| `tests/unit/benchmark-engineering.test.ts` | 281 | 34 |
| `tests/unit/forgecode-techniques.test.ts` | 417 | 34 |
| `tests/unit/response-validator.test.ts` | 358 | 30 |
| `tests/unit/memory-8layer.test.ts` | 322 | 29 |
| `tests/unit/skills.test.ts` | 405 | 28 |
| `tests/unit/security-enhanced.test.ts` | 163 | 27 |
| `tests/unit/context-maximizer.test.ts` | 232 | 25 |
| `tests/unit/middleware.test.ts` | 260 | 24 |
| `tests/unit/route-policies.test.ts` | 231 | 23 |
| `tests/memory/memory-recommendations.test.ts` | 518 | 22 |
| `tests/unit/model-router.test.ts` | 256 | 22 |
| `tests/unit/response-cache.test.ts` | 258 | 22 |
| `tests/unit/virtual-paths.test.ts` | 177 | 22 |

### Adversary-signal flags (pre-Phase 4d scan)

255 test files match at least one heuristic signal. These are NOT definitive; Phase 4d should audit them. Breakdown:

| Signal | Count | Meaning |
|---|---:|---|
| `happy-path-only` | 252 | test has it() cases but no .rejects / .toThrow / catch() — no error-case coverage |
| `structural-only` | 3 | asserts on typeof / toBeDefined / class identity but not behavior |

*Full flagged list in `/tmp/test_flags.tsv`; promoted to `docs/WOTANN_TEST_FLAGS.tsv` alongside this inventory.*

## 11. How This Inventory Was Produced

```text
# File discovery
os.walk(wotann/src) → 481 *.ts files (excluded node_modules, dist, build, .git; also excluded *.test.ts)
os.walk(wotann/tests) → 307 *.test.ts files

# Per-file metrics (LOC, imports_out)
LOC := count(newlines) + trailing-line flag
imports_out := count of `from '..'`, `import('...')`, `require('...')` in file, comments stripped

# Per-file imports_in
For each reference, resolve via importer-relative path (handle `.js` ↔ `.ts`, `index.ts`, `.d.ts`).
Count = number of OTHER src/*.ts files whose resolved reference lands on this file.
942 of 1653 total import/require refs resolve to local src/*.ts (rest are npm packages).

# Status classification
WIRED              := imports_in > 0
WIRED-DYNAMIC      := imports_in == 0 BUT basename.js appears in another file's string literal
ENTRY              := binary entry point (index.ts, lib.ts, daemon/start.ts, mcp-server.ts) OR .d.ts ambient
ORPHAN             := everything else (89 files)

# has-test
src/X.ts has a test if tests/X.test.ts exists (mirrored path).
Tests without a mirrored src file are recorded as target='(none)' in the test inventory.

# last_sha
`git log -1 --format=%h -- <path>` per file (parallelized via 16-thread pool).
```

## 12. Artifact Files Produced

| File | Purpose |
|---|---|
| `docs/WOTANN_INVENTORY.md` (this file) | Human-readable registry |
| `docs/WOTANN_INVENTORY.tsv` | All 481 rows: `path, loc, imports_in, imports_out, status, has_test, last_sha` |
| `docs/WOTANN_ORPHANS.tsv` | 89 orphan rows with directory group |
| `docs/WOTANN_TEST_FLAGS.tsv` | 255 tests flagged by adversary heuristics |
| `docs/WOTANN_TESTS_INVENTORY.tsv` | 307 tests with target source file |

---
*End of Phase 2 registry. Phases 3-14 of the deep audit can cite this file by row count + line number.*