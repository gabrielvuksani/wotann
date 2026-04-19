# 10 — Interactions and flows

Source: `wotann/docs/UI_UX_AUDIT.md` + `wotann/docs/SESSION_8_UX_AUDIT.md` + `wotann/docs/UI_DESIGN_SPEC_2026-04-16.md` §7 onboarding hooks.

This document describes the critical user journeys. Each flow lists entry point, steps, success criteria, failure paths.

## Flow 1 — First-run onboarding (desktop)

**Entry**: user launches the Tauri app for the first time. `app.firstRun === true`.

**Steps** (5-step stepper from `OnboardingView.tsx`, 1,212 lines):

1. **Welcome** — WOTANN logo + "What would you like to build?" + "The All-Father of AI Agent Harnesses" subtitle + 3 feature pills (`11 AI Providers` / `100% Local` / `Zero Cost`) + `Get Started →` CTA.
2. **System Check** — "WOTANN needs a few things to run. We'll check and install them for you." + dependency rows for Node.js, npm, Ollama (Local AI). Each row has Install / Download split. Skip for now.
3. **Engine** — "Start the Engine. The WOTANN Engine runs as a background service, connecting to all your AI providers." + live `Starting engine... (4/10)` progress.
4. **Providers** — "Add a Provider. Enter at least one API key. Ollama is free and runs locally." + 4 provider cards (Ollama FREE `http://localhost:11434`, Anthropic `sk-ant-...`, OpenAI `sk-...`, Google) + Get-key links.
5. **Ready** — "You're all set! You can add API keys anytime in Settings → Providers." + `Start Using WOTANN →` CTA. Keyboard hints `⌘K for commands · ⌘N for new chat`.

**Success**: user lands on Chat tab with a working engine + at least one provider.

**Failure paths**:
- Engine fails to start → show retry with root cause; offer "Run diagnostics" link.
- No API keys entered → allow skip; Ollama must always be auto-probed and offered first.

**Current screenshots**: `e2e-step1-welcome.png`, `e2e-step2-system.png`, `onboarding-engine.png`, `onboarding-providers.png`, `e2e-step5-done.png`, `onboarding-welcome.png`, `onboarding-step1.png`, `onboarding-v2.png`, `depth-welcome.png`.

**Redesign target**: polish from 7/10 to 9/10. Specific:
- Add stagger animation on feature pills,
- Add `/tour` post-onboarding 3-screen walkthrough (CP-3 from session-8),
- Ship the Bifrost theme as the onboarding chrome (gradient visible, then drains to Mimir on step 5).

## Flow 2 — First message (desktop)

**Entry**: user is on Chat tab with Welcome screen.

**Steps**:
1. User sees 6 quick-action tiles (default `coding` preset): Start coding / Run tests / Review code / Research / Compare models / Check costs.
2. User either clicks a tile (pre-fills composer) or types directly into `Ask WOTANN anything…` composer.
3. User hits ⏎ → message sent via `send_message` Tauri command → forwarded to KAIROS daemon via UDS IPC.
4. Assistant streams back via `stream-chunk` event (emitted from `commands.rs::send_message_streaming`).
5. Each chunk renders inside a Block with RuneForge thinking indicator while streaming.
6. On complete: Block status → `success` (moss green), cost shown in-header.

**Success**: first response rendered in a Block within 2-5s (cloud) or 0.5-2s (local).

**Failure paths**:
- Engine disconnected → banner + "Reconnect" CTA.
- Provider rate-limited → toast with next-attempt-in.
- Network failure → honest error with next action.

**Redesign target**:
- Ship Block rendering on every turn (currently free-text).
- Add per-turn cost ticker live in status bar (currently only session total).
- On first message of a session, show "Sigil Stamp" animation (4×4 gold sigil blinks on the file-tab).

## Flow 3 — Tool call approval

**Entry**: assistant wants to run a bash command, write to a file, or call a tool that's gated by permission mode.

**Steps** (from `PermissionPrompt.tsx` in TUI, `ExecApprovals.tsx` in desktop):
1. Tool call intercepted by sandbox layer before execution.
2. Permission prompt overlays current view with:
   - Tool name (`bash`, `write-file`, etc.),
   - Full command / file path,
   - Risk classification: `SAFE` (moss) / `CAUTION` (gold) / `DESTRUCTIVE` (blood),
   - Options: `Approve once` / `Approve always for this session` / `Deny` / `View full context`.
3. User chooses → guard hook enforces + logs to `~/.wotann/audit.log`.

**Current**: `ExecApprovals.tsx` exists. iOS has no approval UI (must add — `SURFACE_PARITY_REPORT.md` §4.4).

**Redesign target**:
- Risk color coding consistent across surfaces,
- `Approve always` creates a new Guard rule visible in Settings > Security & Guards,
- iOS parity — swipe-to-approve card with haptic detents.

## Flow 4 — Council / Arena (multi-model deliberation)

**Entry**: user types `/council <query>` in TUI or clicks Council in desktop palette, or taps Council in iOS Home (new).

**Steps** (from `CouncilView.tsx`):
1. Query fans out to 3 or 4 providers simultaneously (default: Opus + Sonnet + GPT-5 + Gemini).
2. Conversation pane transforms into horizontal council table — N columns, each titled with provider chip.
3. Responses stream side-by-side at ~380ms offset.
4. Unified voting bar at the bottom shows convergence score (cosine similarity or LLM-judge).
5. Operator selects which response(s) to merge with number keys `1-4` OR drag-up gesture.
6. Dismissed responses fade to 32% opacity but remain in shadow-git log.

**Success**: operator has merged a consolidated response; proof bundle includes council vote metadata.

**Arena variant** (from `ArenaView.tsx`): single-blind comparison — responses labelled A / B; vote persists to `~/.wotann/arena-votes.json`. Used for human RLHF.

**Redesign target**:
- Valknut spinner while all 4 stream,
- Per-column cost chip (gold if paid, moss if local),
- iOS: MISSING — must add CouncilView.swift.

## Flow 5 — Editor / Diff review

**Entry**: user triggered a code change via chat OR opened Editor tab (⌘2) and made manual edit.

**Steps**:
1. Change produces a diff.
2. `InlineDiffPreview.tsx` renders per-hunk with Accept / Reject buttons.
3. Keyboard nav: `j`/`k` between hunks, `a`/`r` to accept/reject.
4. On accept: hunk slides right 16px then settles (elastic 380ms) + green flash (`rgba(79,163,127,0.3)` → transparent over 620ms).
5. On reject: hunk slides left 24px + fade 240ms + collapse 180ms.
6. When all hunks accepted: Sigil Stamp animation (shadow-git checkpoint).

**Redesign target**:
- Per-hunk review in desktop chat (currently Editor-only),
- TUI `DiffViewer` gets `j/k` + `a/r` bindings,
- iOS: MISSING — needs diff cards with swipe (Tinder-style, haptic detents at ±18°).

## Flow 6 — Workshop (scheduled / autopilot)

**Entry**: user opens Workshop tab (⌘3) or types `/workshop` in TUI.

**Steps** (from `WorkshopView.tsx`, 7 tabs currently — reduce to 4):
1. **Active** tab (default) — running tasks with live status.
2. **Workers** tab — spawned workers (subagents).
3. **Inbox** tab — dispatched tasks from channels (Slack message, GitHub issue).
4. **Config** tab (new — merged from Scheduled + Playground + Workflows + old Config).

User dispatches a task → `AutonomousExecutor.execute()` with prompt runner + real test runner (`execFileSync("npx", ["vitest", "run"])`) + typecheck runner (`execFileSync("npx", ["tsc", "--noEmit"])`).

**Redesign target**:
- Reduce 7 tabs to 4 (Miller's law — audit finding TD-9.1),
- Per-worker card with Block-based output stream,
- Dispatch inbox = unified view of all channel-originated tasks (Telegram + Slack + GitHub + iMessage + Email).

## Flow 7 — Exploit (security research) mode

**Entry**: user opens Exploit tab (⌘4) or types `/exploit`.

**Steps** (from `ExploitView.tsx`):
1. Banner: "Exploit mode inactive" + `Enable Exploit Mode` red CTA.
2. Upon enable: theme auto-switches to **Valkyrie** (red-accent, steel-gray).
3. Engagement Scope panel: TARGET field (e.g. `app.example.com`), SCOPE / RULES textarea.
4. Summary panel: Total Findings, CRITICAL, HIGH, MEDIUM, LOW counts.
5. Findings panel: CVSS-scored + MITRE ATT&CK technique linkage (source: `wotann/docs/UX_AUDIT_2026-04-17.md` "Exploit view").
6. Status bar: `Exploit Active` badge.

**Current screenshots**: `exploit-space.png`, `exploit-focused-input.png`.

**Redesign target**:
- Valkyrie theme fully adopted when active (not just accent),
- Finding card layout — severity chip, CVSS score, MITRE technique link,
- iOS parity — MISSING.

## Flow 8 — Pairing iOS ↔ desktop (ECDH)

**Entry**: user opens iOS app for the first time, or a paired device is lost.

**Steps** (from `PairingView.swift` + `ios/WOTANN/Networking/`):
1. iOS shows pairing view: WOTANN logo + "Open desktop on your Mac + Scan QR Code OR Scan Network."
2. User opens desktop → Settings > Linked Devices → QR code displayed.
3. iOS scans QR → parses `wotann://pair?id=<requestId>&pin=<pin>&host=<host>&port=<port>`.
4. PIN entry view (6-digit).
5. ECDH key exchange → AES-256-GCM session key derived via HKDF-SHA256.
6. `Bonjour` auto-discovery for `_wotann._tcp` populates auto-detected card.
7. Success → MainShell.
8. Fallback transports: NFC tap-to-pair, manual PIN+IP, Supabase Realtime relay if local WS drops.

**Success**: paired device stored in Keychain; iOS can make RPCs to KAIROS.

**Failure paths** (from `UX_AUDIT_2026-04-17.md`):
- QR scanner unavailable → fall back to Scan Network (Bonjour) or manual.
- Wrong PIN → honest error ("PIN mismatch. Try again.").
- ECDH exchange fails → retry; if persistent, surface "Reset pairing" action in Settings.

**Current screenshot**: `session-10-ios-pairing.png`.

**Redesign target**:
- Fix truncated "Scan or disc…" (iOS-1.1),
- Move AES-256-GCM footer to trust chip at top (iOS-1.2),
- Add "Explore without pairing" path (iOS-1.4 + IOS-DEEP-1).

## Flow 9 — Relay (phone → desktop task push)

**Entry**: user on iOS types a prompt and wants it to run on the desktop engine (for full tool use).

**Steps**:
1. iOS user types in ChatView or FloatingAsk.
2. Tap `Relay to Desktop` button (new affordance).
3. `Raven's Flight` animation (from `UI_DESIGN_SPEC_2026-04-16.md` §4.5): two raven silhouettes fly across a parabolic arc (800ms, `cubic-bezier(0.25, 0.1, 0.25, 1)`), disappear through gold portal top-right.
4. Request crosses via WebSocket (or Supabase relay) to desktop engine.
5. Desktop Engine runs → result streams back.
6. On completion: matching animation plays on desktop (sigil stamp on conversation tab).

**Redesign target**:
- Raven's Flight animation — new component `RavenFlight.tsx` + iOS `RavenFlightView.swift`,
- Visible "relaying" state in both surfaces while in-flight.

## Flow 10 — Proof bundle / Sealed Scroll (task completion)

**Entry**: any task completes (user prompt → assistant response → tool calls → final answer).

**Steps** (from `UI_DESIGN_SPEC_2026-04-16.md` §4.3 + `SealedScroll.tsx` exists):
1. `runtime.generateProofBundle()` invoked.
2. **Sealed Scroll** card unrolls from bottom of conversation (height 0→auto, 420ms).
3. 4 seals in a horizontal row:
   - **Tests** — state: empty circle (pending) / spinning rune (running) / solid gold (passed) / cracked red (failed).
   - **Typecheck** — same state model.
   - **Diff** — auto-generated diff summary.
   - **Screenshots** — captured visual evidence.
4. Rolled scroll icon at left edge.
5. Click → re-roll animation (scrollY 0 → -8px → 0 over 320ms).
6. Exports bundle as single markdown file with embedded SHA.

**Current**: `SealedScroll.tsx` exists. Not wired to `onTaskComplete` anywhere.

**Redesign target**: Wire SealedScroll into every task completion. Surface seals in a collapsible Proof panel in `TrustView.tsx`.

## Flow 11 — Focus mode

**Entry**: user types `/focus` in TUI or presses Cmd+Shift+G in desktop.

**Steps** (from `FocusView.tsx` on desktop + TUI slash `/focus`):
1. Chat collapses to 3 lines:
   - Last prompt (1 line),
   - 1-line tool summary with diff-stats (added X / removed Y),
   - Final response (1 line).
2. Everything else hidden.
3. Press `Escape` to exit.

**Redesign target**: add iOS FocusView parity.

## Flow 12 — Session rewind / fork

**Entry**: user wants to undo last 3 turns OR fork into parallel branch.

**Steps** (from `HistoryPicker.tsx` TUI + `MessageActions` desktop + iOS `MessageContextMenu`):
1. User hovers a turn → "..." menu appears with Actions: Copy / Fork from here / Save as skill / Delete.
2. Click Fork → `runtime.forkAtTurn(turnId)` creates a new conversation branched at that point.
3. New conversation opens in a new tab (desktop) or sheet (iOS).
4. Original conversation preserved read-only as `Branched from conv-42 at turn 12`.

**Redesign target**: iOS MISSING session rewind (only via context menu today).

## Critical edge cases

### Engine disconnected on first launch

**Current**: red banner at top of ChatView + Reconnect CTA. Copy is technical ("Engine disconnected"). Severity red.

**Target** (per TD-1.1 from session-8):
- Copy: "Background engine paused — chat still works with cloud providers. Reconnect to use local tools."
- Severity: amber with inline icon,
- Secondary action: "Run diagnostics" link,
- Six quick-action tiles remain enabled for cloud paths (Research, Compare models, Check costs).

### Stale stored provider selection

**Current**: ModelPicker snap-to-first-enabled on init if stored pair is invalid (fixed in session 7 — see `UX_AUDIT_2026-04-17.md` fix 2).

**Target**: surface snap as notification ("Provider no longer available — snapped to Ollama").

### Deep-link `wotann://chat` on iOS before pairing

**Current**: lands back on pairing view silently (IOS-DEEP-1).

**Target**: toast "Need to pair first — then wotann://chat will land here."

### Terminal OSC 133 not supported by user's shell

**Target**: `wotann init --shell` auto-installs zsh / bash / fish snippets. If the terminal doesn't support OSC 133, sequences are silently ignored (no downside).

---

*End of 10-interactions-and-flows.*
