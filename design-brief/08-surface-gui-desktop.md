# 08 — Surface: Tauri desktop (GUI)

Source: `wotann/desktop-app/` — 134 TSX files + 13 Rust files in `src-tauri/` + 104 Tauri commands.

## Launch path

- Binary: Tauri app `wotann-desktop` (shell `npm run tauri dev` in `desktop-app/`).
- Minimum window: 800×600. Default: 1200×800. Max: unlimited.
- Runtime: Tauri v2 + Rust + React 18 + Vite + shadcn/ui.
- Styles: `globals.css` (2,253 lines) + `wotann-tokens.css` (230 lines) + `liquid-glass.css` (432 lines).

## Root structure

From `desktop-app/src/components/layout/AppShell.tsx`:

```
┌─ Header (top, 48px) ───────────────────────────────────────────────────┐
│  ☰  [Chat] [Editor] [Workshop] [Exploit]    model ▾  ⌘K   🔔   ⚙       │
└────────────────────────────────────────────────────────────────────────┘
┌─ Engine disconnected banner (conditional, amber) ──────────────────────┐
└────────────────────────────────────────────────────────────────────────┘
┌──Sidebar──┐┌─────────────── Main pane (lazy-router) ─────────────────┐
│ WOTANN    ││                                                           │
│ + New Chat││  one of 24 views:                                         │
│ search... ││  ChatView | EditorPanel | WorkshopView | ExploitView |   │
│           ││  MeetPanel | ArenaView | CouncilView | IntelligenceDash | │
│ Today     ││  AgentFleetDashboard | ConnectorsGUI | DispatchInbox |   │
│   No      ││  ComputerUsePanel | CanvasView | DesignModePanel |       │
│ convos    ││  CodePlayground | TrainingReview | TrustView |           │
│   yet     ││  IntegrationsView | PluginManager | ExecApprovals |      │
│           ││  ScheduledTasks | ProjectList | OnboardingView |         │
│ icon rail ││  SettingsView (16 sections)                              │
└───────────┘└───────────────────────────────────────────────────────────┘
┌─ StatusBar (bottom, 32px) ─────────────────────────────────────────────┐
│  model · $0.00 · ████░░ 40% · chat · Session $0.00 · Today $0.00 · Compare │
└────────────────────────────────────────────────────────────────────────┘
```

## The 4 primary tabs (from Header.tsx:24-29)

1. **Chat** (⌘1) — default welcome screen + conversation (`ChatView.tsx`, 492 lines).
2. **Editor** (⌘2) — 3-pane Monaco editor (`EditorPanel.tsx` + FileTree + EditorTerminal + ChatPane).
3. **Workshop** (⌘3) — 7-tab workflow dashboard (`WorkshopView.tsx`).
4. **Exploit** (⌘4) — security research with Valkyrie theme (`ExploitView.tsx`).

Pre-fix (per `SESSION_8_UX_AUDIT.md` TD-3.1), only Chat + Editor were visible as pills; Workshop + Exploit were palette-only. This is now fixed but the ModePicker (old 5-mode) is still in the codebase as dead.

## Views that NEED a redesign (24 lazy-loaded)

For each, claim design priority + current state:

### Tab-primary views (P0)

1. **ChatView** (492 lines) — Welcome screen + conversation. Current Welcome is the best-polished surface on desktop (7/10). Subtitle drift — restore "— all running locally on your machine." See `19-reference-screenshots/chat-input-focused.png`.

2. **EditorPanel** — 3-pane layout: file tree left, editor center, chat right. Current Monaco chrome is generic; needs Norse polish (custom tab icons, terminal as inline Block stream).

3. **WorkshopView** — 7 tabs (Active / Workers / Inbox / Scheduled / Playground / Workflows / Config). Audit finding TD-9.1: **violates Miller's law**. **Reduce to 4: Active / Workers / Inbox / Config** (moving Scheduled + Playground + Workflows into Active as filters).

4. **ExploitView** — Security Research mode with CVSS-scored findings. Current screenshots: `exploit-space.png`, `exploit-focused-input.png`. Redesign target: fully adopt Valkyrie theme when active.

### Overlay views (P0)

5. **CommandPalette** (137 entries, 1,235 lines). Add MRU + shortcut hints inline + 7-category grouping.

6. **ModelPicker** — dropdown with 137 models. Add search, provider-group headers, cost-per-1M-token hint.

7. **NotificationCenter** — filter chips: All / Completed / Errors / Approvals / Cost / Agents. Currently good (per `UI_REALITY.md`).

8. **KeyboardShortcutsOverlay** (⌘/). Currently present but under-styled. Target: layered glass sheet with category sections.

9. **OnboardingView** (1,212 lines — largest single component). 5-step: Welcome → System → Engine → Providers → Ready. Already 7/10 polish; target 9/10. See `onboarding-*.png` for current state.

### Workshop-adjacent (P0)

10. **DispatchInbox** — cross-channel task list.
11. **ExecApprovals** — tool-call approval queue.
12. **ComputerUsePanel** — 4-layer screen pipeline + cursor overlay.
13. **CouncilView** — multi-model parallel deliberation (needs iOS parity).

### Secondary views (P1)

14. **MeetPanel** — meeting assistant + audio waveform.
15. **ArenaView** — side-by-side comparison + voting (`~/.wotann/arena-votes.json`).
16. **IntelligenceDashboard** — runtime intelligence + accuracy boost + PWRStepper + HealthGauge.
17. **AgentFleetDashboard** — agent spawn + status grid.
18. **ConnectorsGUI** — Slack / Linear / Jira / Notion OAuth cards.
19. **PluginManager** — plugin marketplace.
20. **TrustView** — proof bundles + provenance viewer.
21. **TrainingReview** — autoDream + learning review.
22. **IntegrationsView** — cross-integration status.
23. **CanvasView** — collaborative hunk-level editor (future: Cursor-Canvases equivalent).
24. **DesignModePanel** — style inspector + browser preview (future).
25. **CodePlayground** — scratchpad (candidate to fold into Editor tab).
26. **ProjectList** — project grid.
27. **ScheduledTasks** — cron UI.

### Settings (16 sections)

`SettingsView.tsx` — sections in order:

1. General (workspace preset, auto-enhance, auto-verify, auto-select, launch at login, monthly budget)
2. Providers (ProviderConfig) [P0]
3. Appearance (theme, accent, font-size, code-font, Signature palette) [P0]
4. Keyboard Shortcuts (ShortcutEditor) [P0]
5. Notifications
6. Security & Guards (hook profile, exec approvals, archive preflight) [P0]
7. Linked Devices (pairing QR) [P0]
8. Voice (STT / TTS provider)
9. Memory (Engram + claude-mem inspector) [P0]
10. Connectors (GitHub / Linear / Notion / Slack OAuth)
11. Plugins (PluginManager)
12. Channels (Telegram / Discord / iMessage) [P0]
13. Knowledge & Learning (autoDream)
14. File Sharing
15. Automations (cron)
16. Advanced (env vars, debug flags)

Settings findings from `SESSION_8_UX_AUDIT.md`:
- TD-5.0: scrim lacks blur (add `backdrop-filter: blur(8px)`),
- TD-5.0.1: no search across sections (add `🔍 Search…` at top),
- TD-5.0.2: no "Back to Chat" affordance,
- TD-5.3.1: Signature palette vs base Theme relationship unclear.

## Header anatomy

`Header.tsx` — 4-pill tabs + model picker + notification bell + settings + ⌘K hint.

**Current issues** (per `UI_REALITY.md` + `UI_UX_AUDIT.md`):
- Active-tab luminance delta only 15% — should be 40% + bold weight + accent underline.
- Stale doc comment at lines 5-11 contradicting code at 24-29.
- "Cmd+K" hint competes with model picker visually.

**Redesign target**:
```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  ☰    [ Chat ] [ Editor ] [ Workshop ] [ Exploit ]       ◈ opus ▾   ⌘K    🔔   ⚙      │
│  sidebar ^                                          ^ accent bg + bold + underline       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Sidebar anatomy

`Sidebar.tsx` (741 lines). Current: WOTANN logo + New Chat button + search + conversation list + icon rail at bottom.

Current issues:
- Empty state "No conversations yet" is passive — add prominent CTA.
- Search box visible even when nothing to search.
- Icon rail (columns, S, $, gear) lacks labels on hover.

**Redesign target**: add conversation pinning, better empty state, icon rail with labels on hover, bottom "Cost today: $0.04" chip replacing the standalone $ icon.

## Status bar anatomy

`StatusBar.tsx` — bottom 32px bar.

Current: `No model | Chat | progress bar | Session: $0.00 | Today: $0.00 | Compare`.

Target additions (per `UI_UX_AUDIT.md` §6.3 P3):
- Per-turn live cost ticker (updates every 250ms during stream),
- Context meter with 3-zone color (moss <50%, gold 50-80%, blood >80%),
- Mode chip (chat / build / autopilot / compare / review).

## Welcome screen (ChatView.tsx)

Current:
- Logo (purple W with breathing animation 2% scale pulse),
- Heading: "What would you like to build?",
- Subtitle: "Multi-provider AI with autonomous agents, desktop control, and full tool use." **← restore "— all running locally on your machine."**
- 2x3 grid of 6 quick-action tiles (Start coding / Run tests / Review code / Research / Compare models / Check costs) from `WORKSPACE_PRESETS[coding]`,
- Incognito pill toggle,
- Composer input.

From `main-app-chat.png`. Gaps:
- Quick-action cards are 8px padding — too cramped vs Raycast (12px) / Linear (16px). Target 12px.
- Logo → heading gap is 16px — should be 24px (per `UI_REALITY.md` gap 3).
- No stagger animation on quick-action reveal.

## Glass / Liquid Glass status (from UI_UX_AUDIT §3)

**Already shipped** (29 desktop locations):
- Header (`Header.tsx:59-60` blur 40px saturate 1.5),
- Sidebar (`sidebar-container` blur 40px saturate 150%),
- CommandPalette (heavy blur),
- ModelPicker (dropdown blur),
- OverlayBackdrop (modal scrim),
- KeyboardShortcutsOverlay,
- AtReferences, ChatView, ChatPane (in-pane blur),
- NotificationToast.

**Gaps** (redesign must close):
- **Per-theme glass tokens** — today `--glass-bg` is theme-agnostic. Add `--wotann-glass-bg / --glass-stroke / --glass-tint` per theme.
- **Noise-grain overlay** — `.bg-glass-grain` class with 2% SVG noise.
- **Specular sheen** — gold 20% opacity, 380ms sweep on hover.
- **Settings scrim blur** — add `backdrop-filter: blur(8px)` (TD-5.0).

## Motion catalog (from `wotann-tokens.css:14-28`)

- 4 ease curves: `out-expo`, `productive`, `standard`, `pop`.
- 5 durations: `instant 80ms`, `fast 150ms`, `base 240ms`, `slow 400ms`, `deliberate 600ms`.

Current scored 5/10. Targets:
- Active-tab underline slide (Linear-style),
- Command palette backdrop fade + card slide-up,
- Notification panel scale-in,
- Quick-action tiles staggered entrance on Welcome,
- Streaming word-by-word fade-in (140ms each, 18ms stagger).

## Reference screenshots

All in `19-reference-screenshots/`:

- Welcome / chat: `chat-input-focused.png`, `chat-view-input.png`, `main-app-chat.png`, `main-app-fixed.png`, `main-app-view.png`, `final-main-view.png`, `fix-layout-chat.png`, `fix-layout-welcome.png`.
- Command palette: `command-palette.png`.
- Model picker: `model-picker-open.png`.
- Notifications: `notification-panel.png`.
- Editor: `editor-space.png`.
- Exploit: `exploit-space.png`, `exploit-focused-input.png`.
- Workshop: `workshop-space.png`.
- Onboarding: `onboarding-welcome.png`, `onboarding-deps.png`, `onboarding-engine.png`, `onboarding-providers.png`, `onboarding-done.png`, `onboarding-step1.png`, `onboarding-v2.png`, `depth-welcome.png`, `depth-system-check.png`, `depth-after-click.png`, `e2e-step1-welcome.png`, `e2e-step2-system.png`, `e2e-step5-done.png`, `e2e-main-app.png`.
- Settings: `settings-appearance.png`, `settings-page.png`, `settings-providers.png`, `input-fix-check.png`.
- Deprecated (Generation 1 — for negative reference, NOT to copy): `depth-main-app.png`, `main-app-view.png`.

## States to design

For each of the 24 views, Claude Design must produce wireframes for:

- **Default** — normal state,
- **Empty** — no data,
- **Loading** — fetching / streaming,
- **Error** — root cause + next action,
- **Success** — task complete, proof-sealed,
- **Disconnected** — engine offline,
- **Focus mode** — when `/focus` is active,
- **Permission-required** — tool call awaiting approval.

See `11-states-inventory.md` for the full state × view matrix.

## Rust / Tauri backend notes (do not redesign, but know it exists)

- `desktop-app/src-tauri/src/` — 13 Rust files, ~7,500 LOC (`UI_PLATFORMS_DEEP_READ_2026-04-18.md`).
- 104 Tauri commands in `commands.rs` (3,554 LOC).
- JSON-RPC over Unix socket to KAIROS daemon via `ipc_client.rs`.
- Real system integrations: NSVisualEffect vibrancy (macOS), launchd plist, CGEvent input, ScreenCaptureKit via CLI, Bonjour, LocalSend v2.1.
- Honest stubs: `process_pdf`, `get_lifetime_token_stats`, `get_marketplace_manifest`, `refresh_marketplace_catalog`, `get_camoufox_status` — return neutral payloads, never fake data.

Claude Design: the Rust layer is a peer, not a subordinate. The redesign may NOT assume "let the front-end fake it."

---

*End of 08-surface-gui-desktop.*
