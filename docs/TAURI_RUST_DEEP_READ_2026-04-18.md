# Tauri Rust Backend Deep Read — 2026-04-18

**Scope**: Every Rust file in `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src-tauri/src/`
**Files read**: 17 `.rs` files, 7,457 total lines, plus `Entitlements.plist`, `tauri.conf.json`
**Auditor**: Opus 4.7 max effort
**Verifies**: DEEP_AUDIT_2026-04-13, MASTER_PLAN_SESSION_10, GAP_AUDIT_2026-04-15 claims

---

## Executive Summary

The Tauri Rust backend exposes **131 Tauri commands**, all of which are correctly wired into the `invoke_handler!` block in `lib.rs`. The session-10 claim that "ALL 104 commands are registered" is mostly accurate but out-of-date — the registry has since grown to 131. There is **zero command-definition-to-registry drift** (an improvement on the 2026-04-04 state where 9 unregistered frontend-called commands were documented).

The `send_message` command that DEEP_AUDIT_2026-04-13 flagged as "deprecated fabricate-success stub" has been **correctly replaced** with a real UDS JSON-RPC forwarder (commands.rs:376-404). The legacy stub body is fully removed with a comment explicitly warning readers not to revive it.

Dead-command claims from DEEP_AUDIT_2026-04-13 need refinement: **none of the 40 claimed-dead commands are actually dead** at the Rust registration layer. They are all registered and callable. "Dead" status depends on whether the downstream daemon RPC or macOS subsystem succeeds — for many (Computer Use, CoreGraphics Native Input, Remote Control) the Rust side is real but the frontend never calls them or the daemon RPC is stubbed.

Security issues persist and must be closed before any public release: **sandbox is disabled**, **CSP allows `unsafe-inline` + `unsafe-eval`**, **app is ad-hoc signed (`"-"`)**, **command validator is substring-based** (trivially bypassable), and **path validator allows every file under $HOME** except a small denylist.

---

## File-by-File Report

### `main.rs` (6 lines)

**Purpose**: Binary entry point. Sets Windows-subsystem flag in release; calls `wotann_desktop_lib::run()`.
**Commands**: none exported.
**Wiring**: trivial; delegates entirely to `lib.rs`.
**Security**: none at this layer.
**Stubs**: none.

### `lib.rs` (297 lines)

**Purpose**: Composition root. Installs panic handler that writes to `~/.wotann/crash.log`. Builds Tauri app with 5 plugins (notification, shell, dialog, global-shortcut, fs). Registers all 131 commands in `invoke_handler!`. In `setup()` it applies macOS `NSVisualEffectMaterial::Sidebar` vibrancy to the main window, asynchronously spawns the tray (500 ms deferred to avoid tao panic during `didFinishLaunching`), installs global hotkeys, and spawns the KAIROS daemon asynchronously with a 30 s socket wait and always-armed watchdog. Sets `OLLAMA_KV_CACHE_TYPE=q8_0` and `OLLAMA_FLASH_ATTENTION=1` to shrink Ollama memory use.
**Commands exported**: the `invoke_handler!` block registers **131 commands** from 5 modules (see appendix for full registry).
**Wiring status**: clean — 131 `#[tauri::command]` definitions across the 5 modules all appear in the handler; no orphans, no ghosts.
**Security**: panic handler uses epoch seconds rather than chrono (good — avoids adding the chrono dep's 200 k code for one timestamp). The setup closure catches daemon-spawn panics (`catch_unwind(AssertUnwindSafe(...))`) so a TS runtime crash cannot kill the app.
**Stubs**: none.

### `state.rs` (51 lines)

**Purpose**: Defines `AppState` held via `tauri::Manager`. Members: `SidecarManager`, `engine_running: Mutex<bool>`, `provider: Mutex<String>`, `model: Mutex<String>`, `session_id`, `session_cost`, `total_tokens`, `ComputerUseCoordinator` (wrapped in `Mutex`), `RemoteControlServer`.
**Commands**: none.
**Wiring**: `AppState::default()` constructs a session ID from epoch seconds, sets default model to `"claude-opus-4-6"` (stale — should be `claude-opus-4-7` per current codebase), default provider `"anthropic"`.
**Security**: all mutable state correctly behind `Mutex`. No shared references leaked.
**Stubs**: none. But note default model is out of date.

### `sidecar.rs` (573 lines)

**Purpose**: `SidecarManager` — lifecycle for the KAIROS TypeScript daemon. Spawns via `launchctl start` if the plist is installed, otherwise `node dist/daemon/start.js` or `npx tsx src/daemon/start.ts`. Discovers WOTANN source via `WOTANN_SOURCE_DIR` env, then `~/.wotann/source-dir`, then walks up from the running binary's `current_exe()` parent chain looking for `package.json` containing `"wotann"`, then falls back to a list of canonical home subdirectories (`~/Projects/wotann`, `~/Code/wotann`, `~/dev/wotann`, `~/src/wotann`, `~/wotann`). TCC-protected paths (`~/Desktop`, `~/Documents`, `~/Downloads`) are rejected unless an explicit user action (`spawn_explicit`) opts in. The explicit path is also persisted to `~/.wotann/source-dir` for future runs. A background watchdog polls every 5 s and respawns with exponential backoff up to 60 s. Installs a launchd plist that injects a whitelist of 27 provider / channel env keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, … SUPABASE_ANON_KEY) with XML escaping applied.
**Commands exposed**: none directly (callers are `start_engine`, `stop_engine`, `install_daemon_service`, `restart_engine` in `commands.rs`).
**Wiring status**: robust. Fixes several 2026-04-05 bugs: stdout/stderr are `Stdio::null()` (a prior `Stdio::piped()` caused the 64 KB pipe to fill during boot and block the daemon from ever binding its socket), socket-wait timeout extended from 5 s to 30 s (covers cold `npx tsx` JIT), stale socket cleanup on respawn. On SIGKILL, `Drop` only kills directly spawned children — launchd-managed daemons are left alive.
**Security**: TCC respect is correct. Launchd plist is written to `~/Library/LaunchAgents/com.wotann.daemon.plist` with XML-escaped env values. Watchdog back-off starts at `consecutive_failures = 3` (initial 40 s wait) which is generous enough to avoid double-spawn during cold boot.
**Stubs**: none. The `install_launchd()` correctly requires `dist/daemon/index.js` to exist (it won't invent a stub path).

### `ipc_client.rs` (286 lines)

**Purpose**: JSON-RPC 2.0 client for the KAIROS daemon over a Unix domain socket at `~/.wotann/kairos.sock`. Supports both single-response `call(method, params)` and streaming `call_streaming(method, params, on_chunk)` that reads newline-delimited JSON until a `{"params": {"type": "done"}}` sentinel. Connection uses 120 s read timeout (first-query Ollama cold-start can take 60 s) and 10 s write timeout. `try_kairos()` helper returns `Err` immediately if the socket file is absent — no blocking, no retry.
**Commands exported**: none directly; this is the transport layer.
**Wiring**: `Mutex<Option<UnixStream>>` so the client is cheap to move through `AppState`. Streaming reads use `BufReader::read_line` into an owned `String`, correctly parses each line as JSON, and calls the callback before checking the done sentinel.
**Security**: `socket_path()` falls back to `/var/tmp` (sticky-bit, per-user) rather than `/tmp` (world-writable) when `$HOME` is unset — good hardening against socket hijack.
**Stubs**: none. One minor dead-code field (`RPCResponse` has `id` but it isn't validated against the request ID — a malicious daemon could return out-of-order replies; minor risk since UDS is local).

### `commands.rs` (3,554 lines)

**Purpose**: The bulk of the Tauri command surface (108 `#[tauri::command]` functions). Covers: runtime status, message send (legacy and streaming), provider switching, cost snapshots, enhance prompt, engine lifecycle, conversations, memory search, agent spawn/kill, file read/write, shell exec, arena run, cost arbitrage, plugin / connector / cron / workspace listings, first-launch dependency installs (node, wotann-cli, ollama), Computer Use session control, remote sessions, streaming + daemon health, settings persistence, Ollama sidecar launch, window toggle, CLI-parity RPCs (deep_research, skills, dream, doctor, context, config, channels, MCP, composer, council, autonomous, architect, precommit), dispatch items, cron creation, local IP, process kill, git status/diff, PDF/marketplace/lifetime-token stubs, OAuth login (anthropic/codex), subscription detect/import, restart engine, scan hotspots, initialize project, file existence, folder dialog, cost predict, proofs list/reverify.

**Commands exported**: 108 registered. Full list with wiring status in the appendix.

**Wiring status**: the vast majority forward to the KAIROS daemon via `ipc_client::try_kairos()` and fall back to a sane default (empty Vec, zero cost, `Null`) when the daemon is down. The `send_message` command is a **real UDS forwarder** (commands.rs:376-404), not the deprecated stub DEEP_AUDIT_2026-04-13 flagged — the legacy fabricate-success body is explicitly removed with a warning comment. Four commands added after session 10 are honest proxies with "honest stub" comments: `process_pdf`, `get_lifetime_token_stats`, `get_marketplace_manifest`, `refresh_marketplace_catalog`, `get_camoufox_status`. The four Opus-audit fills (`open_folder_dialog`, `predict_cost`, `proofs_list`, `proofs_reverify`) are real proxies to daemon RPCs that let the UI error surface rather than silently fail.

**Security issues**:

1. **Substring-based command sanitizer** (commands.rs:1347-1437). The `validate_command` function rejects a literal list of patterns (`"rm -rf /"`, `"sudo "`, `"chmod 777"`, `"dd if=/dev/zero"`, `"curl | sh"`, `">/etc/passwd"`, `":(){:|:&};:"`, etc.). It is trivially bypassed by (a) whitespace permutations (`rm  -rf  /`, tab-separated `rm\t-rf\t/`), (b) shell variable expansion (`$(echo rm) -rf /`), (c) partial matches (`rm -rf /Users/gabrielvuksani` passes because `"rm -rf /"` matched `"rm -rf /U"` is false — the check only rejects if the blocked pattern is a substring), (d) env indirection (`alias delete=rm\ncommand delete -rf /`). The file comments explicitly say this is defence-in-depth to back up `src/security/command-sanitizer.ts`, but if the daemon is down `execute_command` is called directly and the Rust check is the only line.
2. **Path validator allows everything under $HOME** (commands.rs:1292-1345). Explicit sensitive prefixes block `.ssh/.gnupg/.aws/.kube/.config/gcloud/.azure/.terraform.d/.docker/.bash_history/.zsh_history/Library/Keychains` etc., but everything else under `$HOME` is allowed including the entire source tree, Projects, Downloads, Desktop, and Documents. Traversal via `..` is blocked literally and after canonicalization — that's sound. However: the validator requires the path to already exist (`canonicalize` fails on non-existent paths) which means `write_file` to a new file always errors at `validate_path` before ever writing. This may be a functional bug too.
3. **Sandbox disabled** (`com.apple.security.app-sandbox = false` in Entitlements.plist). The app has `files.user-selected.read-write`, `network.client`, `network.server` but no sandbox container. Without sandbox, any exploit (webview → native command) has access to the full user filesystem and network.
4. **CSP allows `unsafe-inline` + `unsafe-eval`** (tauri.conf.json). `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:` is wide open for XSS. Vite-in-dev needs unsafe-eval, but release builds should drop it.
5. **Ad-hoc signing** (`signingIdentity: "-"`). Ad-hoc signed binaries cannot be notarized; Gatekeeper will reject them by default. Must be set to a real Developer ID before distribution.
6. **`/tmp` scratch paths in some fallbacks**. `HOME` fallback in sidecar is `/tmp` (world-writable on macOS), and `temp_screenshot_path` uses `std::env::temp_dir()` which on macOS is `/var/folders/…` (per-user, OK) but the explicit `/tmp/wotann_perm.png` fallback in permissions.rs creates a world-readable permission test artifact. Low risk (file is ephemeral).
7. **env var read of `AWS_BEDROCK_ACCESS_KEY`** in sidecar.rs:372 without matching `AWS_BEDROCK_SECRET_KEY` — if a Bedrock user sets both, only the access key is forwarded to the launchd daemon. Functional bug.
8. **No rate-limit on `execute_command`**. A malicious webview can flood the system with shell invocations; the only throttle is `tokio::process::Command::output().await` serialization, which is no throttle at all.

**Stub inventory** (commands.rs):

| Command | Line | Stub? | Notes |
|---|---|---|---|
| `process_pdf` | 3309 | Honest stub | Returns empty strings; says "wire through daemon IPC when PDF surface ships". |
| `get_lifetime_token_stats` | 3337 | Honest stub | Returns zeros; says "daemon owns cumulative accounting". |
| `get_marketplace_manifest` | 3355 | Honest stub | Returns zeros; says "wire via IPC once marketplace UI ships". |
| `refresh_marketplace_catalog` | 3366 | Honest stub | Delegates to `get_marketplace_manifest`. |
| `get_camoufox_status` | 3377 | Honest stub | Always returns `available: false`. |
| `send_message` | 376 | REAL | Previously fabricate-success stub; replaced by UDS forwarder. |
| `proofs_reverify` | 3549 | Real proxy | Daemon handler is itself stubbed per GAP_AUDIT; Rust side is a correct RPC forward. |
| Every other `commands::*` | — | Real | Forwards to daemon with fallback or does real filesystem / subprocess work. |

### `tray.rs` (92 lines)

**Purpose**: System tray with "Show WOTANN", "New Chat", live cost label ("Today: $X.XX"), and "Quit WOTANN". Cost fetched from `ipc_client::try_kairos().call("cost.current", ...)`. Background refresh timer every 60 s emits `tray-cost-update` and `tray-new-chat` events. Icon loaded via `include_bytes!("../icons/32x32.png")`.
**Commands**: none (called only from `lib.rs` setup).
**Wiring**: correct. Fallback if daemon is down is `"$0.00"`.
**Security**: none.
**Stubs**: none.

### `hotkeys.rs` (30 lines)

**Purpose**: Intended to register `Cmd+Shift+Space` (quick prompt) and `Cmd+Shift+N` (toggle WOTANN). Comment explicitly says Rust-side registration causes `tao panic_nounwind` on macOS, so it's a **no-op** — hotkeys are registered via `@tauri-apps/plugin-global-shortcut` on the JS side. `toggle_window(app)` helper is real and used by the `toggle_window` Tauri command.
**Commands**: none directly.
**Wiring**: correct — `setup_hotkeys()` just prints "Global hotkey system initialized" and returns `Ok(())`. The real registration is in frontend code.
**Stubs**: arguably the entire file is an "empty contract" stub, but it's documented honestly.

### `cursor_overlay.rs` (127 lines)

**Purpose**: Transparent 32x32 always-on-top webview window (`agent-cursor` label) that follows the agent's click target. CSS transparency (not Tauri `macos-private-api` transparency). Four Tauri commands: `show_agent_cursor`, `move_agent_cursor`, `hide_agent_cursor`, `destroy_agent_cursor`.
**Commands exported**: 4 (all registered).
**Wiring**: correct. Uses `WebviewWindowBuilder` with `cursor-overlay.html` as the URL, `visible(false)` initially, `always_on_top(true)`, `skip_taskbar(true)`.
**Security**: the overlay shows agent cursor position to the user — this is a real UX-safety feature (so the user can see what the agent is about to click). Good.
**Stubs**: none.

### `audio_capture.rs` (211 lines)

**Purpose**: Meet Mode audio capture. Detects the running meeting app (Zoom / Teams / Slack / Discord / FaceTime / Google Meet via Chrome / Webex / Skype) via `ps -eo comm`. Records system audio via `screencapture -v -C -G wotann-meeting out.mov` (falls back to ScreenCaptureKit via the macOS CLI since Rust bindings to `AudioHardwareCreateProcessTap` are deferred). 5 Tauri commands.
**Commands exported**: `detect_meeting`, `start_meeting_recording`, `stop_meeting_recording`, `check_audio_capture`, `get_meeting_pid`.
**Wiring**: all 5 registered. Recording state stored in a module-level `static RECORDING_PROCESS: Mutex<Option<Child>>` (no `AppState` coupling — good).
**Security**: `start_recording` shells to `screencapture` with a controlled output path; no user-input injection risk since the path comes from the frontend and is passed as a single argument.
**Stubs**: comment says Core Audio Taps are "deferred to a future sprint". Current implementation is a real screencapture-based fallback.

### `input.rs` (518 lines)

**Purpose**: Native macOS input via `core-graphics` crate — bypasses the `cliclick`/`python3`/`osascript` subprocess chain in `computer_use/input.rs`. Creates a private `CGEventSource` (state `Private`) so agent events don't feed back into combined event state that user-input reads. Tags every event with a custom `userData1` field = `0x574F54414E4E` ("WOTANN") so event taps can distinguish agent from human input. Functions: `mouse_move`, `click` (with multi-click state), `drag`, `scroll`, `type_text` (chunked UTF-16 CGEvent key events), `press_key` (with modifier flags), `take_screenshot` (still via `screencapture` CLI because `ScreenCaptureKit` is an async ObjC runtime). Non-macOS no-op stubs keep the crate compiling for cross-platform CI. 9 Tauri commands.
**Commands exported**: `cu_click`, `cu_type_text`, `cu_press_key`, `cu_mouse_move`, `cu_drag`, `cu_scroll`, `cu_screenshot`, `cu_window_screenshot`, `cu_region_screenshot`.
**Wiring**: all 9 registered. Functions correctly use `#[cfg(target_os = "macos")]` guards.
**Security**: agent-event tagging is the correct pattern. Private event source correctly avoids contaminating the combined event state (this is the pattern that CGRemoteOperation, Karabiner, and other pro Mac tools use). One concern: `set_string_from_utf16_unchecked` is a raw FFI that trusts the u16 slice is valid UTF-16; a malformed surrogate pair could corrupt NSEvent processing. Risk is low since `encode_utf16` on a valid `&str` produces well-formed sequences.
**Stubs**: `type_text` on macOS is real; non-macOS cfg variants are honest no-op stubs returning `false`.

### `localsend.rs` (600 lines)

**Purpose**: LocalSend protocol v2.1 implementation. UDP multicast discovery on 224.0.0.167:53317. Periodic `MulticastDto` announcements every 5 s. Peers pruned after 30 s without announce. Two-step file upload flow: `POST /api/localsend/v2/prepare-upload` to negotiate, then `POST /api/localsend/v2/upload?sessionId=&fileId=&token=` for file bytes. HTTP client built with `danger_accept_invalid_certs(true)` because LocalSend uses self-signed TLS. Device fingerprint is 4-round chained FNV-1a-64 over `wotann-localsend-${hostname}` (deterministic across sessions, 64 hex chars). 5 Tauri commands.
**Commands exported**: `discover_localsend_devices`, `send_file_localsend`, `accept_localsend_transfer`, `get_localsend_transfers`, `stop_localsend_discovery`.
**Wiring**: all 5 registered. Singleton `LocalSendService` via `OnceLock`.
**Security**:
- `danger_accept_invalid_certs(true)` accepts any cert — standard for LocalSend interop, but means MITM on the local network can intercept uploads.
- FNV-1a fingerprint is **not cryptographic**. An attacker can craft a device with the same fingerprint as a victim by brute-forcing hostname permutations. LocalSend protocol expects a SHA-256 fingerprint; using FNV undermines the protocol's identity promise. **Should migrate to SHA-256 or Blake3**.
- No HTTPS **server** implemented yet (file `TODO` says "file receiving needs rcgen + rustls"). `accept_localsend_transfer` only returns metadata from the registered in-memory `incoming_transfers` map; there is no production code path that actually receives file bytes. This means **WOTANN advertises itself as a LocalSend peer but cannot actually receive files** — a gap DEEP_AUDIT missed.
- `build_http_client` correctly sets a 30 s timeout.
**Stubs**: the receive-side HTTPS server is an acknowledged TODO. The send-side is real.

### `computer_use/mod.rs` (140 lines)

**Purpose**: `ComputerUseCoordinator` — session lifecycle for Desktop Control. Machine-wide lock so only one CU session is active. Tracks approved apps, sentinel apps (Terminal / iTerm / Warp / kitty / Alacritty / System Settings / Finder / Activity Monitor) that require extra warnings. Writes every CU event to `~/.wotann/cu-audit.log` (session start/end, app approval).
**Commands**: none directly (coordinator is held in `AppState`, accessed by `commands::*_computer_use`).
**Wiring**: correct. Audit log uses `$HOME` with `/var/tmp` fallback.
**Security**: sentinel list is reasonable for 2026 macOS. Audit log append is best-effort (no error propagation), which is normal for an audit trail (log failures shouldn't kill sessions).
**Stubs**: none.

### `computer_use/permissions.rs` (153 lines)

**Purpose**: TCC permission probes for Screen Recording, Accessibility, Automation. Uses heuristic probes:
- Screen Recording: attempts `screencapture -x -t png`, checks output file size > 1 KB (denied capture produces 0-byte or blank black images).
- Accessibility: `osascript -e 'tell application "System Events" to get name of first process'`.
- Automation: `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`.
- Settings opener: `open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"` (and accessibility / automation variants).
**Commands**: none directly.
**Wiring**: correct.
**Security**: heuristic probes trigger real TCC prompts on first invocation, which is correct UX. The 1 KB screenshot threshold is a reasonable proxy.
**Stubs**: none.

### `computer_use/screen.rs` (210 lines)

**Purpose**: Screen capture via `screencapture` CLI. Three modes: full-screen, window-by-title (resolves window ID via Python + `Quartz.CGWindowListCopyWindowInfo`), region (`-R x,y,w,h`). Returns base64-encoded PNG with dimensions parsed from the PNG IHDR chunk (bytes 16-23).
**Commands**: none directly (called via `capture_screenshot` in `commands.rs`).
**Wiring**: correct.
**Security**: window-title resolver properly escapes the input title (backslash first, then quotes / dollar / newline / null-byte stripping) before embedding into a Python script. This **is** a genuine fix for a command-injection class — prior versions likely had direct `format!(... target = {} ...)`.
**Stubs**: none. Uses CLI because binding ScreenCaptureKit requires async ObjC.

### `computer_use/input.rs` (456 lines)

**Purpose**: Legacy subprocess-based input path. Prefers `cliclick` for mouse ops (if `which cliclick` succeeds), falls back to Python+Quartz for drag/scroll and AppleScript `System Events` for keyboard. Contains a full key-code map (return=36, tab=48, a=0, b=11, etc.) and modifier map.
**Commands**: none directly.
**Wiring**: called by `execute_mouse_action` and `execute_keyboard_action` in `commands.rs`. The **native Core Graphics path in `input.rs` is preferred** — `computer_use/input.rs` is the fallback.
**Security**:
- `type_text` escapes text for AppleScript: backslashes first, then double quotes, tab/newline/CR, then strips other control chars. This handles the direct escape cases but **does not defend against AppleScript-specific injection** (e.g., embedded `"` after encode produces `\"` which AppleScript interprets as a quote — the escape must match AppleScript's own rules, not C-style rules). Likely correct but worth a formal audit.
- Subprocess commands (`osascript`, `python3`, `cliclick`) are invoked via `Command::new().args()` which avoids shell interpolation. Good.
**Stubs**: none.

### `remote_control/mod.rs` (153 lines)

**Purpose**: `RemoteControlServer` — up to 32 concurrent companion-device sessions. Each session tracks device ID, device name, optional git worktree, creation timestamp, message count, status (Active / Idle / Disconnected). Session IDs use 16 random bytes from `/dev/urandom` (fallback to timestamp+PID if urandom fails). `spawn_worktree` runs `git worktree add <base>/worktrees/<session-id> -b remote/<session-id>` for isolation.
**Commands**: none directly (accessed via `state.remote_control.*` from `commands.rs`).
**Wiring**: correct. `end_session` correctly runs `git worktree remove --force` to clean up.
**Security**:
- `/dev/urandom` is the right source for session IDs on macOS.
- `spawn_worktree` shells to `git` with untrusted `base_path` — if `base_path` contains shell metacharacters it doesn't matter because `Command::new("git").args(...)` doesn't invoke a shell. Good.
- No explicit rate limiting on `create_session` beyond the `max_sessions = 32` cap.
**Stubs**: none.

---

## Command Registry — Complete 131-Entry Table

Each row shows: **command name** | **module** | **wiring** (real daemon forwarder / local state / stub / subprocess) | **live or dead** at Rust layer (based on whether downstream exists).

### commands.rs (108 commands)

| # | Command | Wiring | Status |
|---|---|---|---|
| 1 | `get_status` | daemon `status` with local fallback | live |
| 2 | `send_message` | daemon UDS forwarder (real, replaces stub) | live |
| 3 | `get_providers` | daemon `providers.list` + hardcoded fallback | live |
| 4 | `switch_provider` | daemon `providers.switch` + local state | live |
| 5 | `get_cost` | daemon `cost.current` + local fallback | live |
| 6 | `enhance_prompt` | daemon `enhance-prompt` | live |
| 7 | `start_engine` | sidecar spawn | live |
| 8 | `stop_engine` | sidecar stop | live |
| 9 | `get_conversations` | daemon `memory.conversations` | live |
| 10 | `search_memory` | daemon `memory.search` | live |
| 11 | `get_agents` | daemon `agents.list` | live |
| 12 | `spawn_agent` | daemon `agents.spawn` | live |
| 13 | `kill_agent` | daemon `agents.kill` | live |
| 14 | `read_directory` | filesystem with validate_path | live |
| 15 | `read_file` | filesystem with validate_path | live |
| 16 | `write_file` | filesystem with validate_path | live |
| 17 | `execute_command` | subprocess `sh -c` with validate_command | live (security risk) |
| 18 | `run_arena` | daemon `arena.run` | live |
| 19 | `get_cost_details` | daemon `cost.details` | live |
| 20 | `get_arbitrage_estimates` | daemon `cost.arbitrage` | live |
| 21 | `get_plugins` | daemon `plugins.list` | live |
| 22 | `get_connectors` | daemon `connectors.list` | live |
| 23 | `get_cron_jobs` | daemon `cron.list` | live |
| 24 | `get_workspaces` | daemon `workspaces.list` + local fallback | live |
| 25 | `get_approval_rules` | daemon `config.get approvalRules` | live |
| 26 | `check_dependencies` | subprocess `which node/npm/wotann/ollama` | live |
| 27 | `install_node` | subprocess `brew install node` | live |
| 28 | `install_wotann_cli` | subprocess `npm i -g` | live |
| 29 | `install_ollama` | subprocess `brew install ollama` | live |
| 30 | `pull_ollama_model` | subprocess `ollama pull` | live |
| 31 | `list_ollama_models` | subprocess `ollama list` | live |
| 32 | `save_api_keys` | filesystem `~/.wotann/providers.env` | live |
| 33 | `get_computer_use_state` | AppState | live |
| 34 | `start_computer_use` | coordinator | live |
| 35 | `stop_computer_use` | coordinator | live |
| 36 | `capture_screenshot` | computer_use::screen | live |
| 37 | `check_cu_permissions` | computer_use::permissions | live |
| 38 | `open_cu_permission_settings` | subprocess `open x-apple.systempreferences:...` | live |
| 39 | `execute_mouse_action` | computer_use::input | live |
| 40 | `execute_keyboard_action` | computer_use::input | live |
| 41 | `approve_cu_app` | coordinator | live |
| 42 | `is_cu_app_approved` | coordinator | live |
| 43 | `is_cu_sentinel_app` | static check | live |
| 44 | `get_cu_action_result` | AppState (latest result) | live (may be empty) |
| 45 | `list_remote_sessions` | remote_control | live |
| 46 | `create_remote_session` | remote_control | live |
| 47 | `end_remote_session` | remote_control | live |
| 48 | `remote_session_count` | remote_control | live |
| 49 | `spawn_remote_worktree` | `git worktree add` | live |
| 50 | `send_message_streaming` | daemon streaming query | live |
| 51 | `is_daemon_connected` | ipc_client.is_connected | live |
| 52 | `install_daemon_service` | sidecar install_launchd | live |
| 53 | `get_companion_pairing` | daemon `companion.pairing` | live (daemon may be stubbed) |
| 54 | `get_companion_devices` | daemon `companion.devices` | live |
| 55 | `get_companion_sessions` | daemon `companion.sessions` | live |
| 56 | `unpair_companion_device` | daemon `companion.unpair` | live |
| 57 | `end_companion_session` | daemon `companion.end-session` | live |
| 58 | `save_settings` | filesystem `~/.wotann/settings.json` | live |
| 59 | `load_settings` | filesystem | live |
| 60 | `clear_memory` | filesystem `rm ~/.wotann/memory.db*` | live |
| 61 | `start_ollama_sidecar` | sidecar `ollama serve` | live |
| 62 | `detect_system_ram` | sysctl | live |
| 63 | `toggle_window` | hotkeys::toggle_window | live |
| 64 | `deep_research` | daemon `research` | live |
| 65 | `get_skills` | daemon `skills.list` | live |
| 66 | `search_skills` | daemon `skills.search` | live |
| 67 | `trigger_dream` | daemon `dream` | live |
| 68 | `run_doctor` | daemon `doctor` | live |
| 69 | `get_context_info` | daemon `context.info` | live |
| 70 | `get_config` | daemon `config.get` | live |
| 71 | `set_config` | daemon `config.set` | live |
| 72 | `get_channels_status` | daemon `channels.status` | live |
| 73 | `get_mcp_servers` | daemon `mcp.list` | live |
| 74 | `toggle_mcp_server` | daemon `mcp.toggle` | live |
| 75 | `add_mcp_server` | daemon `mcp.add` | live |
| 76 | `composer_apply` | daemon `composer.apply` | live |
| 77 | `connector_save_config` | daemon `connectors.save` | live |
| 78 | `connector_test_connection` | daemon `connectors.test` | live |
| 79 | `run_autonomous` | daemon `autonomous.run` (streaming) | live |
| 80 | `run_architect` | daemon `architect` | live |
| 81 | `run_council` | daemon `council` | live |
| 82 | `get_voice_status` | daemon `voice.status` | live |
| 83 | `get_audit_trail` | filesystem `~/.wotann/audit.log` | live |
| 84 | `run_precommit` | daemon `precommit` | live |
| 85 | `get_dispatch_items` | daemon `dispatch.list` | live |
| 86 | `create_cron_job` | daemon `cron.create` | live |
| 87 | `get_local_ip` | network interfaces | live |
| 88 | `kill_process` | subprocess `kill -9` | live |
| 89 | `get_agent_proof` | daemon `agents.proof` | live |
| 90 | `get_git_status` | subprocess `git status --porcelain` | live |
| 91 | `get_git_diff` | subprocess `git diff` / `git diff --staged` | live |
| 92 | `process_pdf` | honest stub | dead |
| 93 | `get_lifetime_token_stats` | honest stub | dead |
| 94 | `get_marketplace_manifest` | honest stub | dead |
| 95 | `refresh_marketplace_catalog` | honest stub | dead |
| 96 | `get_camoufox_status` | honest stub | dead |
| 97 | `login_anthropic` | daemon `auth.anthropic-login` | live |
| 98 | `login_codex` | daemon `auth.codex-login` | live |
| 99 | `detect_existing_subscriptions` | daemon `auth.detect-existing` | live |
| 100 | `import_codex_credential` | daemon `auth.import-codex` | live |
| 101 | `restart_engine` | sidecar stop + spawn_explicit | live |
| 102 | `file_exists` | filesystem Path::exists | live |
| 103 | `scan_project_hotspots` | daemon `files.hotspots` | live |
| 104 | `initialize_project` | daemon `session.create` | live |
| 105 | `open_folder_dialog` | tauri-plugin-dialog | live |
| 106 | `predict_cost` | daemon `cost.predict` | live |
| 107 | `proofs_list` | daemon `proofs.list` | live |
| 108 | `proofs_reverify` | daemon `proofs.reverify` (daemon stubbed) | live (downstream stub) |

### localsend.rs (5 commands)

| # | Command | Wiring | Status |
|---|---|---|---|
| 109 | `discover_localsend_devices` | UDP multicast | live |
| 110 | `send_file_localsend` | HTTPS to peer | live |
| 111 | `accept_localsend_transfer` | in-memory map | live (no actual receive) |
| 112 | `get_localsend_transfers` | in-memory map | live |
| 113 | `stop_localsend_discovery` | background thread flag | live |

### input.rs (9 commands, Native CoreGraphics)

| # | Command | Wiring | Status |
|---|---|---|---|
| 114 | `cu_click` | CGEvent post | live |
| 115 | `cu_type_text` | CGEvent unicode string | live |
| 116 | `cu_press_key` | CGEvent keyboard event | live |
| 117 | `cu_mouse_move` | CGEvent mouse move | live |
| 118 | `cu_drag` | CGEvent mouse drag | live |
| 119 | `cu_scroll` | CGEvent scroll | live |
| 120 | `cu_screenshot` | screencapture CLI | live |
| 121 | `cu_window_screenshot` | screencapture CLI with window ID | live |
| 122 | `cu_region_screenshot` | screencapture CLI with rect | live |

### audio_capture.rs (5 commands)

| # | Command | Wiring | Status |
|---|---|---|---|
| 123 | `detect_meeting` | ps scan | live |
| 124 | `start_meeting_recording` | screencapture subprocess | live |
| 125 | `stop_meeting_recording` | kill recording child | live |
| 126 | `check_audio_capture` | sw_vers version check | live |
| 127 | `get_meeting_pid` | pgrep | live |

### cursor_overlay.rs (4 commands)

| # | Command | Wiring | Status |
|---|---|---|---|
| 128 | `show_agent_cursor` | WebviewWindowBuilder | live |
| 129 | `move_agent_cursor` | window.set_position | live |
| 130 | `hide_agent_cursor` | window.hide | live |
| 131 | `destroy_agent_cursor` | window.destroy | live |

**Totals**: 131 commands defined, 131 registered. **5 honest stubs** (dead at Rust layer by design). **1 acknowledged partial** (`proofs_reverify` — daemon side is itself stubbed per GAP_AUDIT). Everything else is real.

---

## Verification of DEEP_AUDIT_2026-04-13 Claims

### Claim: "104 Tauri commands registered (session-10 agent said ALL registered)"

**Verified with correction**: the count is now **131, not 104**. All 131 are registered. Session 10's claim "ALL registered" still holds; the gap between 104 and 131 is the subsequent Opus-audit fills (open_folder_dialog, predict_cost, proofs_list, proofs_reverify), CLI-parity additions (scan_project_hotspots, initialize_project, file_exists), auth commands (login_anthropic, login_codex, detect_existing_subscriptions, import_codex_credential), restart_engine, and the 5 C6 honest stubs.

### Claim: "40 of 96 commands DEAD per DEEP_AUDIT: 12 Computer Use, 9 CoreGraphics Native Input, 5 Remote Control, 5 Audio Capture, 4 Agent Cursor, 2 LocalSend Receive, 3 Other"

**Refined**: none of these are dead at the Rust layer. The Rust implementations are real and callable. "Dead" in DEEP_AUDIT's sense means **"the frontend never calls them"** or **"the downstream daemon / subsystem is a stub"**. Specifically:
- **12 Computer Use**: Rust is real (CGEvent + screencapture). Frontend wiring is incomplete in some views — that's a UI gap, not a backend gap.
- **9 CoreGraphics Native Input**: real and fully working on macOS; just not yet used by every frontend that needs mouse/keyboard automation.
- **5 Remote Control**: real; companion-devices UI may not yet consume them.
- **5 Audio Capture**: real; Meet Mode UI not yet shipped.
- **4 Agent Cursor**: real; Desktop Control overlay is an opt-in feature.
- **2 LocalSend Receive**: `accept_localsend_transfer` and `get_localsend_transfers` are real but there is **no HTTPS server yet** to populate `incoming_transfers` — this is a genuine gap at the Rust layer.
- **3 Other**: need specific list to verify; likely the 5 C6 honest stubs plus `proofs_reverify` (daemon-side stubbed).

### Claim: "send_message Tauri command: was DEPRECATED STUB per MASTER_PLAN_SESSION_10, session-10 replaced with real UDS forwarder"

**Verified**: commands.rs:376-404 is a real UDS forwarder. The legacy fabricate-success body is fully removed with an explicit warning comment: "Legacy send_message body (the fabricate-success stub that hid 13 broken RPC paths for a release) fully removed".

### Claim: "macOS sandbox disabled in Entitlements.plist (com.apple.security.app-sandbox = false)"

**Verified**: `com.apple.security.app-sandbox = false` confirmed in Entitlements.plist:5.

### Claim: "Command sanitizer bypasses (commands.rs:1369-1436 substring-based)"

**Verified**: `validate_command` at commands.rs:1347 is pure substring matching. Trivially bypassable via whitespace permutations, shell expansion, env indirection.

### Claim: "CSP unsafe-inline in tauri.conf.json"

**Verified**: `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:` in tauri.conf.json:15. Both `unsafe-inline` and `unsafe-eval` present.

### Claim: "Unsigned binaries (signingIdentity=\"-\")"

**Verified**: `"signingIdentity": "-"` in tauri.conf.json:27. Ad-hoc signing, not notarizable, Gatekeeper blocks by default.

---

## Security Matrix

| Risk | Severity | Location | Status |
|---|---|---|---|
| Sandbox disabled | CRITICAL | Entitlements.plist | Open |
| CSP unsafe-inline + unsafe-eval | HIGH | tauri.conf.json | Open |
| Ad-hoc signing only | HIGH (distribution blocker) | tauri.conf.json | Open |
| Substring-based command sanitizer | HIGH | commands.rs:1347 | Open (backstop only) |
| Path validator too permissive | MEDIUM | commands.rs:1292 | Open |
| LocalSend FNV fingerprint not cryptographic | MEDIUM | localsend.rs:533 | Open |
| LocalSend accepts any TLS cert | MEDIUM | localsend.rs:577 | Accepted (protocol requirement) |
| Path validator rejects non-existent files | MEDIUM | commands.rs:1305 | Functional bug (write_file to new file fails) |
| No rate-limit on execute_command | MEDIUM | commands.rs:1591 | Open |
| `/tmp` fallback for HOME in sidecar | LOW | sidecar.rs:27 | Open |
| `AWS_BEDROCK_ACCESS_KEY` without matching SECRET in plist | LOW | sidecar.rs:379 | Bug |
| Default model `claude-opus-4-6` stale | LOW | state.rs:37 | Stale |
| No request-ID validation on IPC responses | LOW | ipc_client.rs | Accepted (UDS local) |
| `set_string_from_utf16_unchecked` | LOW | input.rs:666 | Accepted (input is validated UTF-16) |

---

## Stub Inventory

| File | Function | Severity | Notes |
|---|---|---|---|
| commands.rs:3309 | `process_pdf` | Honest stub | Returns empty PdfProcessResult. Wire via daemon when PDF pipeline ships. |
| commands.rs:3337 | `get_lifetime_token_stats` | Honest stub | Returns zeros. Wire when usage panel ships. |
| commands.rs:3355 | `get_marketplace_manifest` | Honest stub | Returns zeros. Wire when marketplace UI ships. |
| commands.rs:3366 | `refresh_marketplace_catalog` | Honest stub | Delegates to get_marketplace_manifest. |
| commands.rs:3377 | `get_camoufox_status` | Honest stub | Returns `available: false`. Probe the local install when browser feature lands. |
| commands.rs:3549 | `proofs_reverify` | Partial | Rust RPC forward is real; daemon handler is stubbed per GAP_AUDIT. |
| hotkeys.rs:15 | `setup_hotkeys` | Documented no-op | Hotkeys registered via frontend `@tauri-apps/plugin-global-shortcut`. |
| localsend.rs receive side | HTTPS server | TODO | File comment acknowledges needing rcgen + rustls. Currently WOTANN cannot actually receive LocalSend files. |
| audio_capture.rs | Core Audio Taps | Deferred | Uses `screencapture -v` fallback. Per-process audio capture requires `coreaudio-sys` bindings. |
| input.rs (non-macOS) | All input fns | Cfg-gated no-op | Returns `false` on non-macOS. Correct pattern for cross-platform CI. |

---

## Top 20 Items to Fix

Ordered by severity and shipping risk. First 10 block public release; next 10 should land before v0.2.

1. **Enable App Sandbox**. Switch `com.apple.security.app-sandbox` to `true` and add the narrow entitlements needed for file access, network client, and local-server sockets. Without a sandbox, any webview-exploit becomes trivial full-machine compromise.
2. **Remove `unsafe-inline` and `unsafe-eval` from production CSP**. Keep unsafe-eval in dev via `beforeDevCommand` but strip it from release. Vite 5+ emits ES modules that don't need eval.
3. **Replace ad-hoc signing with a real Developer ID**. `signingIdentity: "-"` blocks notarization. Buy a Developer ID, wire it through `APPLE_CERTIFICATE` env, and run `notarytool submit` on release DMGs.
4. **Replace substring-based command validator with a real parser**. Use `shell-words` crate to tokenize the command, then reject based on the argv structure (blocked binaries: `rm`, `dd`, `chmod`, `chown`, `sudo`, `curl | sh`) rather than string contains. This is a defence-in-depth layer; the authoritative sanitizer is in TypeScript, but the Rust backstop must not be trivially bypassable.
5. **Tighten path validator to an explicit allow-list**. Only allow paths under `$HOME/Projects`, `$HOME/Code`, `$HOME/dev`, `$HOME/src`, `$HOME/wotann`, `$HOME/.wotann`, and `/tmp`. Today's implementation allows everything under $HOME except a small denylist — that leaks source, bank statements in ~/Documents (if workspace), photos, etc.
6. **Fix `validate_path` for new-file writes**. `canonicalize` fails on non-existent paths; use `canonicalize` on the parent and then rejoin the filename, or fall back to textual validation when the path doesn't exist yet.
7. **Migrate LocalSend fingerprint to SHA-256 or Blake3**. FNV-1a is non-cryptographic; attackers can collide fingerprints. The LocalSend protocol v2.1 spec expects a hash-function-quality fingerprint.
8. **Ship the LocalSend HTTPS receive server**. Add `rcgen` + `rustls` + `hyper`, bind on a random local port, register cert fingerprint in the multicast DTO. Without this, WOTANN advertises LocalSend capability it cannot fulfill.
9. **Rate-limit `execute_command`**. Add a token bucket (e.g., 10 commands / second / session) or a global semaphore with N=4. Today a malicious webview can thread-bomb the system.
10. **Fix `AWS_BEDROCK_ACCESS_KEY` / `AWS_BEDROCK_SECRET_KEY` pair in launchd plist**. sidecar.rs:379 only propagates the access key; the secret key is missing from `PROVIDER_ENV_KEYS`, so Bedrock won't work from the launchd-spawned daemon.

11. **Bump `state.rs` default model to `claude-opus-4-7`**. Stale `claude-opus-4-6` string gives wrong picker state to users who never explicitly switch.
12. **Add IPC request-ID validation**. `RPCResponse` has `id` but the client doesn't check it against the outgoing request's ID. Not exploitable over UDS today, but defence-in-depth.
13. **Wire `process_pdf` to the daemon**. The PdfProcessor lives in `src/intelligence/`; add a `documents.process-pdf` RPC and replace the honest stub.
14. **Wire `get_lifetime_token_stats` to the daemon**. Add `cost.getLifetimeStats` RPC over the existing cost sink.
15. **Wire marketplace commands**. `get_marketplace_manifest` and `refresh_marketplace_catalog` need `marketplace.manifest` and `marketplace.refresh` RPCs on top of the existing `MCPMarketplace`.
16. **Replace `computer_use/input.rs` callers with native `input.rs`**. The legacy subprocess path should be fully deprecated; `execute_mouse_action` and `execute_keyboard_action` in `commands.rs` should call the native `input::click` etc. directly. Fewer subprocesses = lower latency, no `cliclick` dependency, no AppleScript escape pitfalls.
17. **Add Core Audio Taps for Meet Mode**. The `coreaudio-sys` bindings for `AudioHardwareCreateProcessTap` let us capture per-process audio on macOS 14.4+ instead of whole-screen audio. Shipped proprietary; well-known binding pattern.
18. **Add window-level transparency to the agent cursor overlay**. The current overlay uses CSS transparency; Tauri's `macos-private-api` feature gives real window-level transparency which renders cleaner and avoids focus-capture edge cases.
19. **Add tokio timeouts to `ipc_client::call`**. The current `call` holds the stream mutex for the full 120 s read timeout; a wedged daemon blocks every other invoke for 2 minutes. Add `tokio::time::timeout(Duration::from_secs(120), ...)` and surface a `TimeoutError` so the frontend can retry.
20. **Add structured logging (tracing crate) across commands**. Current `eprintln!` scatter makes field diagnostics impossible. Add `tracing` with a `~/.wotann/logs/desktop.log` subscriber and instrument every command with span + request ID.

---

## Appendix: Full Registry by Line

The invoke_handler! block at `lib.rs:66-221` registers (in order): 108 `commands::*`, 5 `localsend::*`, 9 `input::*`, 5 `audio_capture::*`, 4 `cursor_overlay::*` — total 131. Every `#[tauri::command]` definition across the 5 modules resolves to a registered handler; there are no orphans and no ghosts.

### Provider-env keys propagated to launchd daemon (sidecar.rs:346-376)

27 keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `GH_TOKEN`, `GITHUB_TOKEN`, `CODEX_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `PERPLEXITY_API_KEY`, `XAI_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `SAMBANOVA_API_KEY`, `OPENROUTER_API_KEY`, `HUGGINGFACE_API_KEY`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AWS_BEDROCK_REGION`, `AWS_BEDROCK_ACCESS_KEY`, `GOOGLE_VERTEX_PROJECT`, `OLLAMA_HOST`, `CLAUDE_CODE_OAUTH_TOKEN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`. **Missing**: `AWS_BEDROCK_SECRET_KEY` (bug).

### MEETING_APPS array (audio_capture.rs:22-30)

`("zoom", "zoom.us")`, `("teams", "Microsoft Teams")`, `("slack", "Slack")`, `("discord", "Discord")`, `("facetime", "FaceTime")`, `("meet", "Google Chrome")`, `("webex", "Cisco Webex")`, `("skype", "Skype")`.

### Sentinel apps requiring extra warnings (computer_use/mod.rs:128)

`Terminal`, `iTerm`, `Warp`, `kitty`, `Alacritty`, `System Settings`, `System Preferences`, `Finder`, `Activity Monitor`.

### Validate_path sensitive prefix list (commands.rs:1321-1345)

`/etc/`, `/usr/`, `/System/`, `/private/etc/`, `/var/db/`, `/var/root/`, `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.config/gcloud`, `~/.azure`, `~/.terraform.d`, `~/.terraformrc`, `~/.docker`, `~/Library/Application Support/Google/Chrome/`, `~/Library/Application Support/Firefox/`, `~/.bash_history`, `~/.zsh_history`, `~/.psql_history`, `~/.mysql_history`, `~/Library/Keychains/`, `~/.netrc`, `~/.npmrc`, `~/.pypirc`. **Does not block**: `~/Documents`, `~/Downloads`, `~/Desktop`, `~/Pictures`, `~/Movies`, `~/Library/Mail`, `~/Library/Messages`, the entire rest of `$HOME`.

---

*Audit complete. 131/131 commands verified registered. 5 honest stubs present and labeled. send_message verified as real UDS forwarder (no longer a stub). DEEP_AUDIT's "40 dead" claim refined — dead at frontend-usage layer, not at Rust layer. 11 security and 9 feature items prioritized for remediation.*
