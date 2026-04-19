# COMPETITOR EXTRACTION — LANE 4 (UX & Stealth)

**Agent**: 4 of 8 (Opus 4.7 max effort)
**Date**: 2026-04-19
**Scope**: 4 repos + 4 web targets, all focused on **user-facing UX primitives** and **stealth/anti-detect**.
**Sources**:
- `/Users/gabrielvuksani/Desktop/agent-harness/research/camoufox` — daijro, MPL-2.0 (Firefox anti-detect fork)
- `/Users/gabrielvuksani/Desktop/agent-harness/research/omi` — BasedHardware (wearable voice/meet pipeline)
- `/Users/gabrielvuksani/Desktop/agent-harness/research/warp` — warpdotdev (issues-only mirror; docs/web)
- `/Users/gabrielvuksani/Desktop/agent-harness/research/clicky` — farzaa (SwiftUI cursor buddy with `[POINT:]` grammar)
- Web: Warp Agent Mode/Drive, Glass (glassapp.dev), Conductor.build, Gemini-for-Mac Liquid Glass HUD

**WOTANN anchor files** (paths absolute):
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/browser/camoufox-backend.ts` (593 lines; real port committed f938f08)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/python-scripts/camoufox-driver.py` (341 lines)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/meet/{meeting-pipeline,meeting-runtime,coaching-engine,meeting-store}.ts`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/wotann/Block.tsx` (327 lines, session 10 port)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/computer-use/{computer-agent,perception-adapter,perception-engine,platform-bindings}.ts`

---

## EXECUTIVE SUMMARY — The Parity Ledger

| Capability | Competitor State | WOTANN State (4-19) | Gap | Priority |
|---|---|---|---|---|
| **Camoufox fingerprint injection (C++)** | 35 native Firefox patches touching Navigator/WebGL/Audio/WebRTC/Timezone/Fonts/Voices/Screen/Canvas/Shadow-root/Media-devices. Injected via `CAMOU_CONFIG` env JSON + `MaskConfig.hpp` | TS wrapper speaks JSON-RPC to a Python driver that wraps upstream `camoufox.sync_api.Camoufox` (+ Playwright/stub fallbacks). **No per-context `CAMOU_CONFIG` passthrough**, **no BrowserForge/preset integration**, **no `humanize` telemetry**, **no screenshot dir provisioning for multi-context**. | 9 surface features, ~11 features total | **HIGH** — Tier 1 |
| **Omi voice + meet pipeline** | Deepgram Nova-3 streaming STT (~90 languages), server-side VAD gate (off/shadow/active modes, 300ms pre-roll, 4s hangover), speaker embeddings (pyannote + wespeaker), in-flight diarization microservice, translation events, fair-use soft-cap rolling buckets, DG↔wall-clock timestamp mapping, 4s audio accumulation for webhooks, encrypted-at-rest segments (AES-256-GCM HKDF-SHA256) | `MeetingPipeline` EventEmitter + `MeetingRuntime` composer + `CoachingEngine` with 6 templates. Detects platform via `ps -eo comm`. **No VAD gate, no speaker embeddings, no DG integration, no timestamp remap, no translation events, no encryption**. | ~9 features | **HIGH** — Tier 1 |
| **Warp Block primitive** | Command + output fused into one selectable/copyable/rerunnable/shareable unit with gutter rule, status dot, keyboard nav (j/k) | `Block.tsx` (327 LOC) exists, pure presentation, **NOT wired into EditorTerminal / TerminalPanel / ChatPane / MessageBubble** | 7 wire-up sites + keyboard nav + right-click menu + Ink TUI port | **HIGH** — Tier 1 |
| **Warp OSC 133 semantic prompt markers** | 3 sequences: `\e]133;A` (prompt start), `\e]133;C` (command start), `\e]133;D` (output end). Auto-boundary → Blocks. Terminals silently ignore if unsupported. | **Zero hits** in `src/` or `desktop-app/src/`. `EditorTerminal.tsx` uses plain line concatenation (`in-${ts}` / `out-${ts}`). | Full protocol | **HIGH** — Tier 1 |
| **Clicky `[POINT:x,y:label:screenN]` grammar** | Regex `\[POINT:(?:none\|(\d+)\s*,\s*(\d+)(?::...)?(?::screen(\d+))?)\]\s*$`, parsed in `CompanionManager.swift:786`. Coord clamped to target screen, bezier-arc animation, tangent-rotation, mid-flight scale pulse. | **Zero references** (`grep POINT \| bezier \| Bezier` ⇒ only unrelated docs). WOTANN `computer-use/` has 4-layer perception (OCR+a11y+screenshot+vision) but NO pointing grammar or cursor overlay. iOS has no cursor-fly component. | Full SwiftUI port + regex parser + WOTANN-side prompt injection | **MEDIUM** — Tier 2 (signature demo, but depends on Screen Recording + Accessibility perms) |

**Net new features discovered**: **34**.
**Already partially ported**: Block UI + camoufox JSON-RPC shell + meeting event state machine.
**Critical dark spots**: no VAD gate, no `CAMOU_CONFIG` fingerprint JSON passthrough, no OSC 133, no POINT grammar.

---

## 1. CAMOUFOX — Stealth Fingerprint Injection

### 1.1 Upstream architecture

**License**: MPL-2.0. The project is a full Firefox fork with **35 patches** in `/Users/gabrielvuksani/Desktop/agent-harness/research/camoufox/patches/` and a bundled config system (`/Users/gabrielvuksani/Desktop/agent-harness/research/camoufox/additions/camoucfg/MaskConfig.hpp`) that reads `CAMOU_CONFIG` env vars.

**Injection mechanism** (read from `MaskConfig.hpp` + `fingerprint-injection.patch`):
1. Parent process sets **`CAMOU_CONFIG`** (or `CAMOU_CONFIG_1`, `..._2`, … concatenated in order — works around Windows env var length cap) as **JSON**.
2. `MaskConfig::GetJson()` calls `std::call_once` to load once per process, then provides typed getters: `GetString`, `GetInt32`, `GetDouble`, `GetStringList`, `GetStringListLower`, `GetUintImpl<T>`, `GetInt32Rect` (atomic rect read).
3. Every Firefox C++ site that surfaces a fingerprint to JS is patched to consult `MaskConfig` first before falling back to real OS value. Example from `fingerprint-injection.patch`:
   ```cpp
   double nsGlobalWindowInner::GetInnerWidth(ErrorResult& aError) {
     if (auto value = MaskConfig::GetDouble("window.innerWidth"))
       return value.value();
     FORWARD_TO_OUTER_OR_THROW(GetInnerWidthOuter, (aError), aError, 0);
   }
   ```
4. `Element.cpp`'s `GetClientAreaRect()` multiplies by **60** (app-unit scale) so DOM `clientWidth`/`clientHeight` round-trip through Firefox's layout engine.

### 1.2 Python wrapper — `fingerprints.py`

`/Users/gabrielvuksani/Desktop/agent-harness/research/camoufox/pythonlib/camoufox/fingerprints.py`:
- **BrowserForge integration**: `FingerprintGenerator(browser='firefox', os=('linux','macos','windows'))` for infinite synthetic fingerprints.
- **Real presets**: `fingerprint-presets.json` — picks one at random, converts to `CAMOU_CONFIG` dict via `from_preset()`.
- **CreepJS OS-marker fonts**: `_MACOS_MARKER_FONTS`, `_LINUX_MARKER_FONTS`, `_WINDOWS_MARKER_FONTS` — these are known fonts CreepJS uses to detect OS; they're auto-inserted into the synthesized font list so the subset never leaks a different OS.
- **Seeded randomness**: generates unique `fonts:spacing_seed`, `audio:seed`, `canvas:seed` per launch (1 to 2³²-1, excluding 0 = C++ no-op).
- **Font/voice subset generation**: `_generate_random_font_subset(target_os)` picks 30-78% of the OS's non-essential fonts + always-included essentials + markers. Same mechanism for speech voices (40-80% random subset, macOS only; Windows ships all, Linux empty).
- **Init script builder** `_build_init_script`: emits JS that calls per-context setters (`window.setFontSpacingSeed`, `setAudioFingerprintSeed`, `setCanvasSeed`, `setNavigatorPlatform`, `setNavigatorOscpu`, `setNavigatorUserAgent`, `setNavigatorHardwareConcurrency`, `setWebGLVendor`, `setWebGLRenderer`, `setScreenDimensions`, `setScreenColorDepth`, `setTimezone`, `setWebRTCIPv4`, `setFontList`, `setSpeechVoices`). Each setter **self-destructs after first call** (marks disabled for the user-context ID).
- **Context options**: returns `{init_script, context_options, config, preset}` — `context_options` goes to Playwright's `browser.new_context()` (`user_agent`, `viewport`, `device_scale_factor`, `timezone_id`, `locale`).

### 1.3 Storage — `RoverfoxStorageManager`

From `webrtc-ip-spoofing.patch` + `timezone-spoofing.patch`, fingerprint values are persisted per **user-context ID** in an in-memory hashtable keyed `webrtc_ipv4_<N>`, `webrtc_ipv6_<N>`, `timezone_<N>`, `tz_disabled_<N>`, `webrtc_ipv4_disabled_<N>`, etc. The `Disable*` bits mean JS can never re-read/re-write the setter after the first call (prevents fingerprint exfiltration by the page itself).

### 1.4 Full patch inventory (all 35)

| Patch | Attack surface |
|---|---|
| `fingerprint-injection.patch` | Navigator, Window, Element, Screen — main trunk |
| `navigator-spoofing.patch` | UA, platform, hardwareConcurrency, oscpu, language |
| `webgl-spoofing.patch` | WebGL vendor, renderer, parameters, extensions |
| `audio-context-spoofing.patch` | AudioContext, AudioBuffer fingerprint noise |
| `audio-fingerprint-manager.patch` | Bulk manager for audio randomization |
| `webrtc-ip-spoofing.patch` | Local IP leak mitigation via `WebRTCIPManager` |
| `timezone-spoofing.patch` | `TimezoneManager` w/ per-context keying |
| `locale-spoofing.patch` | navigator.language, Accept-Language header |
| `geolocation-spoofing.patch` | Geolocation API lat/lng injection |
| `screen-spoofing.patch` | Screen width/height/availWidth/availHeight/colorDepth |
| `anti-font-fingerprinting.patch` | Font metrics randomization |
| `font-hijacker.patch` | Intercepts Canvas text measurement |
| `font-list-spoofing.patch` | navigator.fonts enumeration |
| `speech-voices-spoofing.patch` | SpeechSynthesis.getVoices() |
| `voice-spoofing.patch` | Companion voice selection |
| `media-device-spoofing.patch` | navigator.mediaDevices.enumerateDevices() |
| `shadow-root-bypass.patch` | Detect penetration via Shadow DOM |
| `cross-process-storage.patch` | Syncs fingerprint across content processes |
| `global-style-sheets.patch` | Style sheet enumeration mask |
| `no-css-animations.patch` | Disable CSS animations for timing-free fingerprint |
| `all-addons-private-mode.patch` | Force addons into private-browsing context |
| `disable-extension-newtab.patch` | No extension chrome leak on new tab |
| `pin-addons.patch` | Prevent addon removal via JS |
| `browser-init.patch` | Early-init hook point for fingerprint load |
| `chromeutil.patch` | ChromeUtils isolation for automation |
| `config.patch` | Compile-time Firefox config flags |
| `force-default-pointer.patch` | Pointer/touch event spoofing |
| `network-patches.patch` | TCP/TLS fingerprint smoothing |
| `no-search-engines.patch` | No Google search URL leak |
| `macos-sandbox-crash-fix.patch` | macOS sandbox stability |
| `windows-theming-bug-modified.patch` | Windows theming stability |
| `ghostery/`, `librewolf/`, `playwright/` | Sub-directories with third-party integration patches |

### 1.5 WOTANN's current port (verify parity)

`/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/browser/camoufox-backend.ts` (lines 183-593):
- **Persistent JSON-RPC**: spawns Python driver once, pipelines requests — matches upstream design.
- **RPC methods**: `launch`, `navigate`, `click`, `type`, `evaluate`, `screenshot`, `snapshot`, `close`.
- **Backend cascade**: camoufox → playwright → stub. `WOTANN_CAMOUFOX_REAL=1` forces real.
- **Crash handling**: `MAX_CRASH_RETRIES=1`, pending RPCs rejected on exit.
- **Close grace**: `DEFAULT_CLOSE_GRACE_MS=5_000`.

`/Users/gabrielvuksani/Desktop/agent-harness/wotann/python-scripts/camoufox-driver.py` (341 lines):
- `_launch_camoufox()` calls `Camoufox(headless, humanize)` — **ONLY passes headless + humanize**. Does NOT forward `os`, preset selection, fingerprint seeds, locale, timezone, webrtc_ip, font list, voice list, or context options.
- No `CAMOU_CONFIG` env composition (doesn't use the upstream JSON-envvar mechanism — relies purely on the Python `Camoufox()` wrapper defaults).
- `handle_evaluate` uses `repr(value)` fallback on non-JSON results — OK for now.

### 1.6 Parity gaps (11 features)

| # | Gap | Why it matters | Effort | Location |
|---|---|---|---|---|
| 1 | **Preset selection pipeline** — no way to pass `preset=` or `os=` through to Python | Without presets, every launch generates the same BrowserForge fingerprint — bot-detectable | 2h | `camoufox-driver.py:_launch_camoufox` + `camoufox-backend.ts:CamoufoxConfig` |
| 2 | **Per-context fingerprint rotation** — current port exposes ONE page only, not multiple contexts | Multi-identity scraping (e.g., polling a site from 5 "different users") is core to anti-detect workflows | 4h | new `newContext()` RPC method |
| 3 | **`CAMOU_CONFIG` env passthrough** — user cannot supply raw config JSON to override any fingerprint value | Advanced users need escape hatch for custom spoofs | 1h | driver: compose env from params before spawn |
| 4 | **`humanize` cursor movements telemetry** — no way to observe the humanization in tests | Debugging false-positive detection | 1h | expose humanize stats via RPC |
| 5 | **WebRTC IP override** — `setWebRTCIPv4(...)` setter not exposed to WOTANN callers | Any scraping behind a proxy leaks real IP without this | 2h | new `setWebrtcIP` RPC + driver binding |
| 6 | **Locale + timezone override APIs** — callers cannot pass them into `launch()` | Geofenced content + regional A/B tests need this | 2h | driver binding |
| 7 | **Screenshot dir auto-provisioning per context** — current code creates ONE dir, not per-browser-session dir | Multi-session runs overwrite each other | 1h | `camoufox-backend.ts:launch` |
| 8 | **`addInitScript` passthrough** — callers cannot inject custom JS before page scripts | Needed for custom cookie banners, consent auto-click, etc. | 2h | new RPC method |
| 9 | **Cookie import/export** (via `context.storage_state()`) | Reuse login sessions across runs without re-auth | 3h | new RPC methods |
| 10 | **Network interception** (`page.route` → block ads/trackers/images) | Faster scraping + less bandwidth | 3h | new RPC method |
| 11 | **Browser version pinning** (`ff_version=` parameter) | Some anti-bot systems fingerprint exact minor versions | 1h | driver binding |

### 1.7 Stealing-worthy Python patterns (for WOTANN's Python driver)

From `fingerprints.py`:
- **`_ensure_marker_fonts(fonts, markers)`** — always include CreepJS OS-marker fonts.
- **`_generate_random_font_subset(target_os)`** — 30-78% random subset with essentials.
- **`normalize_locale(locale)`** → `{language, region, script, as_string}` for Playwright.
- **`handle_window_size(fp, outer_width, outer_height)`** — center the window on the screen after resizing.

---

## 2. OMI — Voice + Meet Pipeline

### 2.1 Backend architecture (verified from `/Users/gabrielvuksani/Desktop/agent-harness/research/omi/backend/CLAUDE.md` + files)

**Services** (each a separate Docker):
- `backend/` (main FastAPI) — routers, models, utils — 42 routers, 60+ utils.
- `pusher/` — real-time data distribution. Routes transcripts to integrations in **1s batches**, streams audio in **4s batches** to ML services + developer webhooks, LLM conversation analysis, audio upload to private cloud in **60s batches** (3 retries), speaker sample extraction queued at **120s age minimum**, 5 concurrent background tasks per WS connection.
- `diarizer/` — GPU/CUDA. `POST /v1/diarization` (pyannote/speaker-diarization), `POST /v1/embedding` (pyannote/embedding), `POST /v2/embedding` (wespeaker-voxceleb-resnet34-LM).
- `agent-proxy/` — WS bridge: Firebase auth → Firestore VM lookup → GCE lifecycle (start/reset/health) → bidirectional pump with **120s keepalive**, AES-256-GCM message encryption, last-10-message chat history injection on first query.
- `modal/` — serverless GPU. Speaker ID (SpeechBrain, T4), VAD (pyannote/voice-activity-detection), hourly cron notifications.

**3-lane async architecture** (strict):
- **Lane 1** — `httpx.AsyncClient` pools w/ semaphore (`get_webhook_client`, `get_maps_client`, `get_auth_client`, `get_stt_client`) + circuit breakers per target.
- **Lane 2** — executors: `critical_executor` (8 workers), `storage_executor` (16 workers). NEVER raw threads.
- **Lane 3** — pre-commit lint `scripts/lint_async_blockers.py` catches `requests.*` / `time.sleep` / `Thread().start()` in async paths.

### 2.2 STT streaming (`backend/utils/stt/streaming.py`, 384 LOC)

- Deepgram Nova-3, via long-lived WS + `keep_alive()`.
- **Nova-3 multi-language set**: 22 languages (`en, es, fr, de, hi, ru, pt, ja, it, nl` + regional variants).
- **Nova-3 single-language set**: ~85 languages (`ar-*, be, bg, bn, bs, ca, cs, da, de, el, en-*, ...`) — covers the long tail.
- **DG↔wall-clock mapper** (`vad_gate.py:DgWallMapper`) — DG timestamps are continuous (only counting audio actually sent). When silence is skipped via KeepAlive, DG time compresses vs wall time. Mapper tracks checkpoints at each silence→speech transition to convert DG timestamps back to wall-clock. `_MAX_CHECKPOINTS = 500` to bound memory for long sessions.

### 2.3 VAD Streaming Gate (Issue #4644, 646 LOC)

Three modes via `VAD_GATE_MODE` env:
- `off` — all audio forwarded.
- `shadow` — VAD runs + logs decisions, but audio still forwarded (A/B test safe).
- `active` — silence skipped, **KeepAlive** sent to DG instead; **Finalize** flushes pending transcripts on speech→silence transitions.

Parameters (from `vad_gate.py:32-40`):
- `VAD_GATE_PRE_ROLL_MS = 300`
- `VAD_GATE_HANGOVER_MS = 4000`
- `VAD_GATE_SPEECH_THRESHOLD = 0.65`
- `VAD_GATE_FINALIZE_SILENCE_MS = 300`
- `VAD_GATE_KEEPALIVE_SEC = 5`

**`GateState` enum**: SILENCE | SPEECH | HANGOVER — classic 3-state VAD machine with pre-roll buffering.

### 2.4 Speech profiles & speaker embeddings

- `speech_profile.py` — 111 LOC — user voice reference recorded once, matched against.
- `speaker_embedding.py` — 272 LOC — segment-level embedding comparison against stored user profiles.
- `vad.py` — 252 LOC — 80ms windowed ONNX model (`_get_ort_session`, `make_fresh_state`, `run_vad_window`, `VAD_WINDOW_SAMPLES`).
- `safe_socket.py` — wraps DG socket w/ keep-alive config to prevent 1011 timeout.

### 2.5 Fair use + encryption

- **`utils/fair_use.py`** — Rolling speech-hour tracking via **Redis minute buckets**, soft-cap enforcement (2 free hours, etc.).
- **`utils/encryption.py`** — AES-256-GCM per-user encryption with **HKDF-SHA256** key derivation. Firestore segments stored as opaque blobs, decrypted on read via `database/helpers.py` decorators.
- **`utils/log_sanitizer.py`** — `sanitize()` for response text, `sanitize_pii()` for names/emails.

### 2.6 18-tool agentic RAG (`utils/retrieval/`)

Routed via Claude: action items, calendar, Gmail, Apple Health, conversations, memories, screen activity, files, **Perplexity web search**, notifications, etc.

### 2.7 Audio formats

- **Opus** (via `opuslib`) — device format.
- **LC3** (via `lc3py`) — Bluetooth LE Audio.
- **WAL files** — opus-encoded only (decoder silently errors on raw PCM but returns HTTP 200 — a real gotcha logged in omi's CLAUDE.md).
- PyAV (`import av`) for transcoding.

### 2.8 Desktop client (`research/omi/desktop/`, Swift + `agent-swift` for UI testing)

- **Named test bundles**: `OMI_APP_NAME="omi-fix-rewind" ./run.sh` installs to `/Applications/omi-fix-rewind.app` with bundle ID `com.omi.omi-fix-rewind`. Allows parallel testing without clobbering production. **This is stealable for WOTANN** — let developers run 5 WOTANN test bundles simultaneously without permission reset.
- **`agent-swift connect --bundle-id` + `snapshot -i` + `click @e3`** — programmatic Accessibility API verification loop. Prefers CGEvent `click` over AXPress for SwiftUI.
- **NEVER `xcodebuild` from terminal** — invalidates TCC permissions. Use `xcrun swift build` + bundle launch.

### 2.9 WOTANN current state (`src/meet/`, 4 files)

`meeting-pipeline.ts` (194 LOC):
- `MeetingPipeline extends EventEmitter` — states `idle | listening | transcribing | coaching | ended`.
- Platforms detected via `execFileSync("ps", ["-eo", "comm"])` — zoom, teams, meet, slack, discord, facetime, unknown.
- `TranscriptSegment`: `{id, speaker: user|other|unknown, text, startMs, endMs, confidence, timestamp}`.
- `CoachingSuggestion`: `{type: response|action-item|context|sentiment|summary, content, confidence, timestamp}`.
- `getRollingContext(windowMs = 120_000)` — 2 min default.

`meeting-runtime.ts` (223 LOC):
- Composes pipeline + store + coaching engine.
- `coachingCadenceMs = 10_000` (configurable).
- Coaching loop: `setInterval → runCoachingCycle → query(prompt)` if `shouldAnalyze()`.
- Query is stashed on engine as `__query` field (note: uses typed-backdoor pattern — `(engine as unknown as {__query?}).__query`).
- SQLite-backed `MeetingStore` persists segments + final state. Suggestions logged but not persisted (flagged as future schema migration).

`coaching-engine.ts` (80 LOC shown, 6 templates): `standup | oneOnOne | interview | presentation | retro | general`. Each has a systemPrompt + suggestedTypes list.

### 2.10 Parity gaps (9 features)

| # | Gap | Impact | Effort |
|---|---|---|---|
| 1 | **VAD streaming gate** (off/shadow/active) | Skip silence → 70% fewer DG tokens on idle streams | 1d |
| 2 | **DG↔wall-clock timestamp mapper** (checkpoint list w/ bisect, `_MAX_CHECKPOINTS=500`) | Correct timestamps for skipped silence | 4h |
| 3 | **Speaker embedding comparison** (pyannote or wespeaker) | Speaker labels (you vs them) on iOS Meet mode | 2d |
| 4 | **Audio accumulation batches** (4s → webhooks; 60s → cloud) | Prevents pusher OOM; survives deploy | 1d |
| 5 | **Translation events + lang detection gate** (reject `langdetect` on <20 char text) | Multi-language meetings | 1d |
| 6 | **Encryption at rest** (AES-256-GCM + HKDF-SHA256) for transcript segments | Privacy parity | 1d |
| 7 | **Fair use rolling buckets** (Redis minute buckets) for speech hours | Free-tier cost control | 4h |
| 8 | **Opus + LC3 decode path** (opuslib + lc3py) | Device-format support | 2d |
| 9 | **Named test bundles** (`WOTANN_APP_NAME=wotann-fix-X ./run.sh`) | Parallel Swift UI verification | 4h |

---

## 3. WARP — Block-Based Terminal + OSC 133

### 3.1 Block primitive (stolen, partially wired)

`/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/wotann/Block.tsx` (327 LOC) — good port. Supports:
- `BlockStatus = "running" | "success" | "error" | "cancelled"`
- Left gutter 3px rule w/ status color (`STATUS_DOT` map).
- Header: command text (monospaced, ellipsized, `title=` tooltip) + status pill (with pulse animation for running) + duration (tabular-nums) + actions (Copy ⎘ / Rerun ↻ / Share ↗).
- Body: scrollable, `maxHeight: 320`, `whiteSpace: pre-wrap`.
- `selected` state via `onClick + onBlur`.
- Custom `@keyframes wotann-block-pulse` injected inline.
- `BlockStream` — flex column w/ `gap: 10`.

**Not yet wired** (confirmed via grep: zero imports of `Block.tsx`):
- `EditorTerminal.tsx` (272 LOC) — uses plain `TerminalLine` array w/ `in-${Date.now()}` IDs. No Block wrap.
- `TerminalPanel.tsx` (164 LOC) — same.
- `ChatPane.tsx` / `MessageBubble.tsx` — ThinkingBlock exists but no Block wrapper.
- Ink TUI has no `<Block>` component at `src/ui/components/`.

### 3.2 Block feature gaps (from UI spec + competitive scan)

| # | Feature | Status in WOTANN |
|---|---|---|
| B1 | Wire Block into ChatPane / MessageBubble / ToolCallCard (every turn = 1 Block) | **Missing** — UI_DESIGN_SPEC §12 P10 flagged this |
| B2 | Wire Block into EditorTerminal + TerminalPanel | **Missing** |
| B3 | Active-block selection + `j`/`k` keyboard nav in BlockStream | **Missing** — current Block has tabIndex but no stream-level nav |
| B4 | Right-click BlockContextMenu: Copy / Share / Rerun / Bookmark / Delete / **AI-ize** | **Missing** (new component) |
| B5 | OSC 133 parsing in terminal → auto-generates Block boundaries | **Missing** (new subsystem) |
| B6 | Ink TUI port of Block | **Missing** (new `src/ui/components/Block.tsx`) |
| B7 | Hook Block into `ChatView` message rendering in TUI | **Missing** |
| B8 | Share as permalink — currently onShare just exists as callback, no wotann://share route | **Missing** — Bridge server hook |
| B9 | Rerun semantics — current Block has onRerun callback but no history API | **Missing** — persist to WOTANN memory store |

### 3.3 OSC 133 semantic prompt markers

Sequences (from Ghostty/Wezterm/Kitty/iTerm2/Warp spec):
- `\e]133;A\a` — prompt START (before showing $)
- `\e]133;B\a` — prompt END (after showing $, before user input)
- `\e]133;C\a` — command START (after user input, before execution)
- `\e]133;D[;exit_code]\a` — command END + optional exit code

**Why it matters for WOTANN**: every terminal emulator that supports this can auto-detect Block boundaries with **zero heuristics**. Unsupported terminals silently ignore — zero downside.

**Shell integration snippets** needed for WOTANN's `install.sh`:
- Bash/Zsh: inject `PROMPT_COMMAND='printf "\e]133;D;%d\a" $?; printf "\e]133;A\a"'` + `PS1='\e]133;B\a'+PS1+'\e]133;C\a'`.
- Fish: `function _osc133_postexec --on-event fish_postexec; printf "\e]133;D;%d\a\e]133;A\a" $status; end` + `function fish_prompt; printf "\e]133;A\a"; # …; printf "\e]133;B\a"; end`.

**Warp's known issue** ([warpdotdev/warp#6718](https://github.com/warpdotdev/warp/issues/6718)): Warp gets confused when `PROMPT_COMMAND` adds the A marker but the shell is already in command mode. Defensive parse: require strict state machine (only accept A after D or at session start).

### 3.4 Warp Agent Mode policies (from docs.warp.dev)

- **Approval policies**: `always-ask` (every command), `auto-run-allowlist` (whitelist; empty by default), `auto-run-safe` (read-only commands), `autonomous` (trusted workflows).
- **Destructive operations always require confirmation** even if auto-run is on.
- **Sensitive values redacted** from agent context and history.
- **Warp Drive** — team-shared: Workflows (parametrized command templates), Notebooks (runbook-style step lists), Environmental Variables (scoped to Drive).
- **Model Context Protocol (MCP)**: agents can reach databases, ticketing, cloud consoles via a single MCP config — matches WOTANN's existing `src/marketplace/` MCP registry.
- **Oz** — Warp's cloud-agent platform, unlimited parallel cloud agents that survive terminal close.

### 3.5 Warp Drive workflow format (reusable primitive)

```yaml
name: "rebase feature onto main"
description: "Fetch and rebase current branch onto main"
command: |
  git fetch origin
  git rebase origin/main
arguments:
  - name: branch
    default_value: main
tags: [git, rebase]
```

WOTANN could adopt this format in `~/.wotann/workflows/*.yaml` and expose via `wotann workflow run rebase --branch=main`.

---

## 4. CLICKY — `[POINT:x,y:label:screenN]` Grammar + Bezier Cursor

### 4.1 `CompanionManager.swift:782-823` — Parser

```swift
let pattern = #"\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]:\s][^\]:]*?))?(?::screen(\d+))?)\]\s*$"#
```

Cases:
- `[POINT:none]` — Claude decided pointing wouldn't help.
- `[POINT:123,456]` — coord on cursor's current screen.
- `[POINT:123,456:run button]` — coord + label.
- `[POINT:400,300:terminal:screen2]` — coord + label + target screen.

**Critical rule**: tag must be **at end of response** (`\s*$`). This lets the streaming SSE response keep showing text, then parse the tag when the final chunk arrives.

**Return type**:
```swift
struct PointingParseResult {
    let spokenText: String       // response w/ tag removed
    let coordinate: CGPoint?     // nil for "none"
    let elementLabel: String?    // "run button" or "none"
    let screenNumber: Int?       // 1-based; nil ⇒ cursor's screen
}
```

### 4.2 Prompt injection (`CompanionManager.swift:568-576`)

The Claude system prompt instructs:
> format: [POINT:x,y:label] where x,y are integer pixel coordinates in the screenshot's coordinate space, and label is a short 1-3 word description of the element (like "search bar" or "save button"). if the element is on the cursor's screen you can omit the screen number. if the element is on a DIFFERENT screen, append :screenN where N is the screen number from the image label (e.g. :screen2). this is important — without the screen number, the cursor will point at the wrong place.

Examples baked into the prompt:
- `"you'll want to open the color inspector... [POINT:1100,42:color inspector]"`
- `"html stands for hypertext markup language... [POINT:none]"`
- `"see that source control menu up top? ... [POINT:285,11:source control]"`
- `"that's over on your other monitor — see the terminal window? [POINT:400,300:terminal:screen2]"`

### 4.3 Bezier cursor animation (`OverlayWindow.swift:495-568`)

**Quadratic Bezier**: `B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2`
- `P0` = start (current cursor), `P2` = destination (parsed POINT), `P1` = control point = midpoint Y-offset upward by `min(distance * 0.2, 80.0)` px (parabolic arc).
- **Timer at 60fps** — frame-by-frame, NOT Core Animation. Implicit animations turned OFF during navigation so the timer owns position.
- **Duration**: `min(max(distance / 800.0, 0.6), 1.4)` s — short hops fast, long flights dramatic, capped.
- **Smoothstep easeInOut**: `t = linearProgress² × (3 - 2 × linearProgress)` — Hermite-style ease.
- **Tangent rotation**: `B'(t) = 2(1-t)(P1-P0) + 2t(P2-P1)` → `atan2(tangentY, tangentX) * 180/π + 90°` (triangle tip points up at 0°).
- **Scale pulse**: `1.0 + sin(linearProgress * π) * 0.3` → peaks at **1.3×** at midpoint, back to 1.0× on landing ("swoop" feel).
- **Navigation state machine**: `.idle → .navigatingToTarget → .pointingAtTarget → .navigatingToTarget (return) → .idle`.
- **Pointer phrase streaming**: On arrival, streams random pointer phrase ("right here!") char-by-char with `Double.random(in: 0.03...0.06)` delays.
- **Flight back**: 3s hold at target → fade-out bubble → reverse bezier to cursor position.
- **User-cursor cancel**: if user moves mouse > N pixels during navigation, `cancelNavigationAndResumeFollowing()` aborts.

### 4.4 Supporting Clicky architecture (stealable)

- **Cloudflare Worker proxy** (`worker/src/index.ts`, 142 LOC): `/chat` → Claude, `/tts` → ElevenLabs, `/transcribe-token` → AssemblyAI 480s token. API keys never ship with app. WOTANN's proxy story is `src/daemon/proxy-router.ts` — add `/chat`/`/tts` routes there.
- **AssemblyAI streaming (`u3-rt-pro` model)** with shared URLSession across all sessions (creating/invalidating per session corrupts OS connection pool — a hard-won bug).
- **Global push-to-talk via listen-only `CGEvent` tap** (not AppKit global monitor) — modifier chords detected reliably in background.
- **Transient Cursor Mode**: fades in on hotkey, fades out after 1s inactivity.
- **Non-activating `NSPanel` joins all Spaces**, never steals focus.
- **Multi-monitor coord mapping** — screenshot is labeled `screen1`, `screen2`, etc. Claude uses the label. Overlay maps coord → correct monitor.
- **TLS warmup** in `ClaudeAPI.swift` — pre-establishes TLS before first request for lower TTFB.

### 4.5 WOTANN current state

**Computer-use module** (`src/computer-use/`, 2363 LOC total):
- `computer-agent.ts` — top-level agent loop.
- `perception-adapter.ts` — unified interface for 4 layers.
- `perception-engine.ts` — screenshot → OCR → grid cells → spatial analysis (~100 tokens per element vs 15K raw screenshot).
- `platform-bindings.ts` — native OS bindings.
- `types.ts` — `Perception`, `ScreenElement`, `ActiveWindow`.

**What's missing for Clicky parity**:
| # | Feature | Effort |
|---|---|---|
| 1 | `[POINT:x,y:label:screenN]` grammar + regex parser | 2h (port `CompanionManager:782-823` to TS) |
| 2 | Prompt injection rule for the grammar | 1h (add to `src/prompt/`) |
| 3 | SwiftUI `BezierCursorOverlay` component in iOS — full-screen transparent overlay w/ blue triangle cursor | 1d |
| 4 | macOS equivalent (`desktop-app` or separate AppKit target) | 1d |
| 5 | Quadratic bezier animation (60fps Timer, smoothstep, tangent rotation, scale pulse) | 4h (direct port) |
| 6 | Multi-monitor coord mapping from screenshot labels | 4h |
| 7 | Global PTT hotkey on macOS/iOS — listen-only CGEvent tap (or iOS volume button, side button on iPad) | 1d |
| 8 | Transient overlay mode (fade in/out per interaction) | 2h |
| 9 | Pointer phrase streaming (30-60ms per char) | 1h |

### 4.6 WOTANN differentiation opportunity

Clicky is **ONE screen + ONE Claude turn**. WOTANN can:
- Combine the POINT grammar with WOTANN's Autopilot loop → the cursor flies between steps, showing the human what each agent step touches (a "live replay" visualization of the agent's thinking).
- Use the POINT grammar with WOTANN's Compare mode → different models propose different coords, side-by-side.
- Add a **screen recording + POINT playback** export — turn any agent session into a shareable "watch-me-use-this-app" clip.

---

## 5. ADDITIONAL WEB-RESEARCHED TARGETS

### 5.1 Glass (glassapp.dev, Glass-HQ/Glass) — GPL v3 Zed fork

**Architecture**:
- **Forks Zed's GPUI** (UI framework) into standalone `Glass-HQ/gpui`, extends with native iOS + macOS components → GPUI becomes a cross-app framework.
- **Browser + editor + terminal in one app** — "the browser that swallowed the IDE".
- Licensed GPL-3.0-or-later (same as Zed upstream).
- macOS is primary platform (most mature); Windows in development.

**Stealable UI innovations**:
- **Unified omnibar** — URL + command + search in one input (WOTANN has `/` commands + chat input; merging yields the Glass experience).
- **Browser-aware editor** — edit source of the page you're currently browsing. Matches WOTANN's Editor tab spec in Phase 18 but adds the browsing axis.
- **GPUI-style immediate-mode UI** — faster than React, handled via GPU shader lists. Too heavy a rewrite for WOTANN (stick with Tauri + React); note for future.

**Risk**: GPL-3.0 license is contagious. WOTANN would need to keep any derivative component GPL-3.0 (incompatible with WOTANN's likely MIT/BSL mix).

### 5.2 Conductor.build — macOS parallel agents via git worktrees

**Core flow**:
1. Conductor **clones the repo per workspace**.
2. Each workspace is an **isolated git worktree** — agents can't interfere.
3. Runs multiple Claude Code or OpenAI Codex instances simultaneously on different branches.
4. **Codex modes** (0.43.0+): fast mode, plan mode, skills.
5. **Codex Checkpoints** (0.44.0) — rewind to a known state within a session.

**Comment-on-diff** (Conductor 0.29.0 "Claude can now comment on your code"):
- Claude gets an in-process MCP tool (via `createSdkMcpServer` from Claude Code SDK) to comment on specific lines.
- Inline comments rendered on the diff viewer, can be added to chat.
- **GitHub PR comments auto-sync** to diff viewer, show author avatar, disappear when outdated/resolved.

**Stealable for WOTANN**:
- `superpowers:using-git-worktrees` is already in WOTANN's skill registry — integrate at desktop-app level so each Workshop task spawns a real worktree.
- **Comment-on-diff MCP tool** — WOTANN's Review mode + Compare mode need this. Expose via `src/marketplace/in-process-mcp.ts`.
- **GitHub PR comment sync** — `desktop-app/src/components/integrations/ChannelsTab.tsx` already has Channels pattern; add GitHub as a Channel with PR-comment sync.
- **Multi-repo support** (roadmap, not yet shipped) — plan for it now: `.wotann/workspaces/*/` layout with per-workspace config.

### 5.3 Gemini for Mac — Liquid Glass HUD

Launched April 2026 (9to5google, TechCrunch, Google Blog confirm).
- **Option+Space** global shortcut (Spotlight is Cmd+Space — intentionally adjacent but distinct).
- Opens a **small Gemini bar wrapped in Liquid Glass design** — blur, specular highlights, rounded corners.
- macOS 15+ only. Free.
- Critics call out "two missing features" (android-authority) but the shortcut + Liquid Glass are the UI wins.

**Stealable blob-as-status pattern for WOTANN**:
- A minimalist **HUD blob** overlay on macOS — when the user hits `⌥Space`, WOTANN's floating HUD shows the current agent state (idle / thinking / typing / speaking) as a **single morphing blob** — not a window with a text transcript.
- The blob morphs shape + color per state: circle (idle) → pulsing ring (thinking) → waveform (speaking) → checkmark (done).
- Inspired by Siri's blob + the old Mac OS 9 "Appearance" — modernized w/ Liquid Glass materials.
- WOTANN's `desktop-app/src/components/wotann/ValknutSpinner.tsx` could be the seed. Wrap in `.ultraThinMaterial` equivalent via Tauri + CSS `backdrop-filter`.

---

## 6. CONSOLIDATED TIER-ORDERED WORK ITEMS (34 features)

### Tier 1 — Parity (ship in next 2 sessions)
1. **Camoufox `CAMOU_CONFIG` passthrough** — driver composes env JSON from RPC params (1h)
2. **Camoufox preset + os param piping** (2h)
3. **Camoufox per-context isolation** (newContext RPC) (4h)
4. **Block.tsx wired into ChatPane + MessageBubble + ToolCallCard** (4h)
5. **Block.tsx wired into EditorTerminal + TerminalPanel** (3h)
6. **BlockStream j/k keyboard nav** (2h)
7. **OSC 133 parser in EditorTerminal → auto-Block boundaries** (4h)
8. **OSC 133 shell integration snippets in install.sh** (1h)
9. **VAD streaming gate in meeting-pipeline** (3 modes, 1d)
10. **[POINT:x,y:label:screenN] regex parser in TS** (2h)

### Tier 2 — Differentiation (session 3-4)
11. **SwiftUI BezierCursorOverlay iOS** (1d)
12. **macOS BezierCursor overlay** in `desktop-app` Tauri window (1d)
13. **DG↔wall-clock timestamp mapper for skipped silence** (4h)
14. **Speaker embedding pipeline** (pyannote or local onnx) (2d)
15. **Audio encryption at rest** (AES-256-GCM + HKDF-SHA256) (1d)
16. **Comment-on-diff in-process MCP tool** (1d)
17. **Named test bundles** (`WOTANN_APP_NAME=wotann-fix-X ./run.sh`) (4h)
18. **Shadow/gray/auto-run approval policies** — WOTANN sandbox already classifies risk; wire to approval states (1d)
19. **Warp Drive workflow format** (`~/.wotann/workflows/*.yaml`) + CLI (`wotann workflow run`) (1d)

### Tier 3 — Platform (session 5+)
20. **Git-worktree per Workshop task** (1d)
21. **Multi-repo Workspaces** (`.wotann/workspaces/*/`) (2d)
22. **GitHub PR-comment sync** to desktop-app Review mode (1d)
23. **Translation events + langdetect gating** (<20 char reject) (1d)
24. **Fair-use Redis rolling buckets** (4h)
25. **Opus + LC3 decode path** for iOS voice (2d)
26. **Camoufox cookie import/export** (`context.storage_state()`) (3h)
27. **Camoufox network interception** (`page.route`) (3h)
28. **Camoufox `addInitScript` passthrough** (2h)

### Tier 4 — Polish / signature demos
29. **Blob HUD (Gemini-style) morphing across states** (1d)
30. **`⌥Space` global shortcut on macOS** (4h)
31. **Pointer phrase streaming** (30-60ms per char) (1h)
32. **POINT grammar for Autopilot replay** (each step flies the cursor) (1d)
33. **POINT grammar for Compare mode** (side-by-side proposals) (1d)
34. **Block right-click context menu** (Copy/Share/Rerun/Bookmark/Delete/AI-ize) (4h)

---

## 7. SECURITY / LICENSE NOTES

| Source | License | WOTANN impact |
|---|---|---|
| Camoufox | MPL-2.0 | **Safe to port**: C++ patches + Python wrapper ideas. MPL is file-scoped — only changed files carry MPL, not WOTANN as a whole |
| Omi | AGPL (likely — verify) | **Port ideas only**, not code. Translate Python → TS from scratch |
| Warp | Proprietary | **OSC 133 is an open spec** (iTerm2 originated); Block primitive is patented UX pattern but inspired-by is legal |
| Clicky | MIT (`research/clicky/LICENSE`) | **Safe to port code directly** with attribution — POINT grammar + bezier animation can be lifted |
| Glass | GPL-3.0-or-later | **Avoid code port** — stick to inspiration only, keep WOTANN non-GPL |
| Conductor.build | Proprietary | Inspiration only; in-process MCP tool pattern is from Claude Code SDK (open) |

**Secret management check** (from `rules/security.md`):
- Camoufox Python driver never logs params → good. Verify `log_sanitizer.py` equivalent in WOTANN.
- Clicky's Cloudflare Worker pattern (keys on proxy, not in app) is a gold-standard port target for WOTANN's proxy router.

---

## 8. OPEN QUESTIONS FOR PLANNER

1. **Should BezierCursor ship on iOS first (harder — no cursor on iOS, need virtual indicator) or macOS first (easier — already has NSCursor)?** Recommend macOS first for demo, iOS second with finger-point indicator (follow Siri wave pattern).
2. **Does WOTANN commit to `⌥Space` as the global shortcut**, colliding with Gemini-for-Mac? Alternative: `⌃Space` or `^⌥Space`.
3. **Warp Drive workflow format vs existing `src/skills/`** — are these separate primitives, or should Workflows be a subclass of Skills?
4. **Encryption key derivation** — should WOTANN's meet encryption key come from Keychain (per-device) or from user password (cross-device)? Omi chooses HKDF from a user secret → cross-device wins but means a password.

---

## 9. FILE POINTERS FOR PARENT / PLANNER AGENT

**Competitor code to re-read in depth**:
- `/Users/gabrielvuksani/Desktop/agent-harness/research/camoufox/patches/fingerprint-injection.patch` (355 LOC)
- `/Users/gabrielvuksani/Desktop/agent-harness/research/camoufox/additions/camoucfg/MaskConfig.hpp`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/camoufox/pythonlib/camoufox/fingerprints.py` (715 LOC)
- `/Users/gabrielvuksani/Desktop/agent-harness/research/omi/backend/utils/stt/vad_gate.py` (646 LOC)
- `/Users/gabrielvuksani/Desktop/agent-harness/research/omi/backend/utils/stt/streaming.py` (384 LOC)
- `/Users/gabrielvuksani/Desktop/agent-harness/research/clicky/leanring-buddy/OverlayWindow.swift` (881 LOC, lines 485-568 for bezier)
- `/Users/gabrielvuksani/Desktop/agent-harness/research/clicky/leanring-buddy/CompanionManager.swift` (1026 LOC, lines 568-823 for POINT grammar)

**WOTANN files to modify (Tier 1)**:
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/python-scripts/camoufox-driver.py` (add CAMOU_CONFIG compose)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/browser/camoufox-backend.ts` (expand config surface)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/editor/EditorTerminal.tsx` (import Block + OSC 133)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/layout/TerminalPanel.tsx` (import Block)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/chat/{ChatPane,MessageBubble}.tsx` (wrap in Block)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/meet/meeting-pipeline.ts` (add VAD gate)

---

**END LANE 4 EXTRACTION — 34 features documented, 10 in Tier 1, 9 in Tier 2, 9 in Tier 3, 6 in Tier 4.**
