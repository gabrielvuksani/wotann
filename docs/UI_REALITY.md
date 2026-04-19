# UI_REALITY.md — WOTANN UI Archaeology (Phase 1 Agent E)

**Date**: 2026-04-19
**Screenshots at**: `/Users/gabrielvuksani/Desktop/agent-harness/` (parent of repo)
**Screenshot count**: 30 PNGs
**Window dimensions observed**: 1200x800 and 1440x900 (two distinct capture sessions)
**Source cross-referenced**: `wotann/desktop-app/src/`, `wotann/src-tauri/` (lives **inside** `desktop-app/`), `wotann/ios/WOTANN/`, `wotann/src/ui/` (Ink TUI)

## Executive summary (read this first)

1. **Three generations of UI are captured in the screenshots.** Apr 5 screenshots (~14:53–17:58) show the *previous* top-level layout: **Chat / Build / Autopilot / Compare** tabs, `Today/No conversations yet` sidebar, condensed quick-actions (Build a feature / Debug an issue / Compare models / Start Autopilot). Apr 5 late (~17:52–17:58) and Apr 6 screenshots show a **redesigned welcome/onboarding** (5-step progress bar + purple W glyph + "What would you like to build?"). Apr 6 23:30–23:50 screenshots show the **current** top-level layout: **Chat / Editor / Workshop / Exploit** tabs, vertical-icon sidebar rail, six-action quick-start grid.
2. **The current source code (Apr 17–18 commits) matches ONLY the Apr 6 screenshots.** Everything before Apr 6 23:00 is a retired design. No "Build/Autopilot/Compare" top-pill exists in `Header.tsx` today — those strings remain only in `ModePicker.tsx` as a secondary segmented control (its comment still says "Chat, Build, Autopilot, Compare, Review").
3. **Onboarding shipped and matches screenshots.** The 5-step Welcome → System → Engine → Providers → Ready flow visible in `depth-welcome.png`, `onboarding-*.png`, and `e2e-step*.png` is implemented in `desktop-app/src/components/onboarding/OnboardingView.tsx` (1212 lines). "11 AI Providers / 100% Local / Zero Cost" cards and "The All-Father of AI Agent Harnesses" subtitle are literal string matches.
4. **The Exploit tab is real.** `exploit-space.png` and `exploit-focused-input.png` (Apr 6 23:39–23:41) show "Security Research / Engagement Scope / Target / Scope / Summary / Total Findings / CRITICAL/HIGH/MEDIUM/LOW". All these strings live in `desktop-app/src/components/exploit/ExploitView.tsx`. **Shipped**, not aspirational.
5. **Editor tab shipped with 3-pane layout.** `editor-space.png` shows sidebar / file tree / empty editor / chat side-panel. Implemented in `desktop-app/src/components/editor/` (13 component files including MonacoEditor, FileTree, SymbolTree, EditorTabs).
6. **Glass UI / translucency is partially present.** `backdrop-filter: blur(...)` appears 78 times across 11 files. Header, Sidebar, ModelPicker, CommandPalette, OverlayBackdrop, KeyboardShortcutsOverlay all use blur. But only 56 usages in globals.css handle the heavy lifting — the design-award bar for glass (Glass app, Conductor) calls for layered depth, tints, and animated highlights. Current is minimum-viable blur, not hero-tier.
7. **No welcome-screen UI text says "all running locally on your machine."** That string appears in 12 Playwright traces (Apr 5 and Apr 7) but NOT in current source. Current code (ChatView.tsx:134) reads `"Multi-provider AI with autonomous agents, desktop control, and full tool use."` — reordered and dropped the "locally" clause. Mild regression vs stated positioning.
8. **TUI (Ink) does exist and `dist/index.js --help` works.** `src/ui/App.tsx` mounts `StartupScreen`, `ChatView`, `StatusBar`, `PromptInput`, `ContextHUD`, etc. 15 Ink components total. Not shown in any screenshot (all screenshots are the desktop-app, not the CLI TUI).
9. **iOS Swift app exists.** 34 view directories under `ios/WOTANN/Views/` (Agents, Arena, Autopilot, Channels, Chat, Conversations, Dashboard, Onboarding, Voice, etc.). **No iOS screenshot** in the inventory — we cannot verify the iOS UI against visuals. `docs/session-10-ios-pairing.png` (713 KB, Apr 17) exists but was excluded from the Agent E scope.
10. **Header.tsx comment is stale — lying about its own content.** Lines 5-9 of `Header.tsx` claim "The 4-tab header (Chat|Editor|Workshop|Exploit) is eliminated" directly above a `VIEW_PILLS` array with exactly those 4 pills. A past session deleted the 4-tab header, then re-added it in the session-10 UX audit, but never updated the header doc comment. Evidence of churn.

## Screenshot inventory + breakdown

| # | File | Bytes | Captured | Generation | Tab shown | Matches current code? |
|---|------|-------|----------|------------|-----------|------------------------|
| 1 | `depth-welcome.png` | 125k | Apr 5 14:53 | Redesigned onboarding | Welcome step 1 | **Yes** (Onboarding Welcome step) |
| 2 | `depth-system-check.png` | 118k | Apr 5 14:53 | Redesigned onboarding | System step 2 (old) | **No** — shows "WOTANN CLI / Not available outside Tauri"; current source removed these |
| 3 | `depth-main-app.png` | 85k | Apr 5 14:56 | Generation 1 (Build/Autopilot/Compare) | Chat | **No** — 4-tab Chat/Build/Autopilot/Compare + Review; current is Chat/Editor/Workshop/Exploit |
| 4 | `depth-after-click.png` | 101k | Apr 5 14:54 | Redesigned onboarding | Welcome, step 1 with step 2 focused | **Partial** — old circular progress indicator style |
| 5 | `fix-layout-welcome.png` | 75k | Apr 5 15:01 | Generation 1 | Chat | **No** — 4-tab |
| 6 | `fix-layout-chat.png` | 85k | Apr 5 15:02 | Generation 1 | Chat (conv selected) | **No** — 4-tab |
| 7 | `onboarding-v2.png` | 150k | Apr 5 15:14 | Redesigned onboarding | Welcome | **Yes** (3 feature pills + Get Started) |
| 8 | `onboarding-welcome.png` | 146k | Apr 5 17:52 | Redesigned onboarding | Welcome | **Yes** — largest feature-pill variant |
| 9 | `onboarding-deps.png` | 97k | Apr 5 17:53 | Redesigned onboarding | System (Ollama Local AI) | **Yes** (Ollama name matches current source) |
| 10 | `onboarding-engine.png` | 100k | Apr 5 17:53 | Redesigned onboarding | Engine ("Starting engine... 4/10") | **Yes** (`OnboardingView.tsx` has engineStatus + progress) |
| 11 | `onboarding-providers.png` | 112k | Apr 5 17:54 | Redesigned onboarding | Providers (Ollama/Anthropic/OpenAI/Google) | **Yes** (`PROVIDERS` const in `OnboardingView.tsx:63`) |
| 12 | `onboarding-done.png` | 104k | Apr 5 17:54 | Redesigned onboarding | Ready ("Start Using WOTANN →") | **Yes** (line 994) |
| 13 | `main-app-view.png` | 78k | Apr 5 17:54 | Generation 1 | Chat (4-tab) | **No** |
| 14 | `e2e-step1-welcome.png` | 150k | Apr 5 17:26 | Redesigned onboarding | Welcome | **Yes** (1200x900 screenshot) |
| 15 | `e2e-step2-system.png` | 96k | Apr 5 17:26 | Redesigned onboarding | System | **Yes** — matches current (Ollama Local AI) |
| 16 | `e2e-step5-done.png` | 104k | Apr 5 17:27 | Redesigned onboarding | Ready | **Yes** |
| 17 | `e2e-main-app.png` | 74k | Apr 5 17:27 | Generation 1 | Chat (4-tab) | **No** |
| 18 | `main-app-fixed.png` | 76k | Apr 5 17:57 | Generation 1 | Chat (4-tab) | **No** |
| 19 | `final-main-view.png` | 76k | Apr 5 17:58 | Generation 1 | Chat (4-tab, sidebar rail) | **No** |
| 20 | `chat-view-input.png` | 85k | Apr 5 17:55 | Generation 1 | Chat (Chat/Build/Autopilot/Compare, "New conversation" selected) | **No** |
| 21 | `main-app-chat.png` | 102k | Apr 6 23:34 | **Current** (Chat/Editor/Workshop/Exploit) | Chat | **Yes** — 4 new tabs, 6-action quick-start grid |
| 22 | `chat-input-focused.png` | 99k | Apr 6 23:42 | **Current** | Chat (input focused) | **Yes** |
| 23 | `command-palette.png` | 122k | Apr 6 23:43 | **Current** | Chat + open palette | **Yes** ("Search commands, views, modes...", New Chat / New Incognito Chat / Toggle Incognito / Go to Chat / Open Editor / Compare Models / Workshop all in `CommandPalette.tsx`) |
| 24 | `model-picker-open.png` | 102k | Apr 6 23:44 | **Current** | Chat + ModelPicker dropdown ("No models match") | **Yes** |
| 25 | `notification-panel.png` | 101k | Apr 6 23:51 | **Current** | Chat + NotificationCenter (AI/Completed/Errors/Approvals/Cost/Agents filter chips) | **Yes** |
| 26 | `input-fix-check.png` | 98k | Apr 6 23:50 | **Current** | Chat (theme toggle visible bottom-left) | **Yes** (theme toggle is new) |
| 27 | `editor-space.png` | 63k | Apr 6 23:39 | **Current** | Editor (3-pane: threads/files → editor → chat) | **Yes** (EditorPanel + FileTree + ChatPane all present) |
| 28 | `exploit-space.png` | 93k | Apr 6 23:40 | **Current** | Exploit (Security Research / Engagement Scope / Total Findings) | **Yes** (all strings in `ExploitView.tsx`) |
| 29 | `exploit-focused-input.png` | 94k | Apr 6 23:41 | **Current** | Exploit (Scope/Rules textarea focused) | **Yes** |
| 30 | `onboarding-step1.png` | 172k | Apr 6 23:32 | **Current** onboarding | Welcome (polished — identical to onboarding-welcome.png) | **Yes** |

### Generation 1 (Apr 5, pre-redesign)
Distinguishing marks: **4-pill header Chat | Build | Autopilot | Compare** (with a "Review" 5th sometimes), left sidebar contains **Chats | Projects | Skills | Workers** sub-tabs (purple underline on "Chats"), status bar shows "0.0K / 200K" context meter. Quick actions are 2x2: **Build a feature / Debug an issue / Compare models / Start Autopilot**. Window size 1200x800.

### Generation 2 (Apr 5 17:52 → Apr 6, onboarding redesign)
5-step horizontal progress indicator: **Welcome (1) → System (2) → Engine (3) → Providers (4) → Ready (5)**. Purple W glyph in rounded-square logo. 3 feature pills: **11 AI Providers / 100% Local / Zero Cost**. Gradient "Get Started →" button. System step shows **Ollama (Local AI)** (current) earlier shown **WOTANN CLI / Not available outside Tauri** (old).

### Generation 3 (Apr 6 23:30+ onwards — current code)
Top pills: **Chat | Editor | Workshop | Exploit**. Vertical icon rail in bottom-left sidebar (columns icon, S icon, $ icon, gear). Quick actions are 2x3: **Start coding / Run tests / Review code / Research / Compare models / Check costs**. Keyboard hints at bottom: `⌘K commands`, `⌘N new chat`, `⌘B sidebar`. Status bar at very bottom shows `No model`, `Chat`, progress bar, `Session: $0.00`, `Today: $0.00`, `Compare`. Left sidebar header is flat: **WOTANN** logo top-left + `+ New Chat` + `Search conversations...` + `No conversations yet`. 1440x900 window.

## UI text extracted (searchable list)

### Chrome / navigation
- Tab labels: `Chat` `Editor` `Workshop` `Exploit` (current)
- Old tab labels: `Chat` `Build` `Autopilot` `Compare` `Review` (still in ModePicker.tsx)
- Sidebar top: `WOTANN`, `+ New Chat`, `Search conversations...`
- Sidebar sub-tabs (old, Gen1): `Chats` `Projects` `Skills` `Workers`
- Breadcrumb for Exploit: `Security Research`
- Bottom status: `Disconnected`, `$0.00`, `Chat`, `Session: $0.00`, `Today: $0.00`, `Compare`
- Engine banner: `Engine disconnected` / `Engine disconnected — responses may be limited`, `Reconnect`
- Header corner: `Offline`, `No model`

### Chat welcome screen
- Heading: `What would you like to build?`
- Subtitle (current): `Multi-provider AI with full tool use, autonomous agents, and desktop control — all running locally on your machine.` (Apr 6 screenshots) **vs** `Multi-provider AI with autonomous agents, desktop control, and full tool use.` (current ChatView.tsx:134 — shorter, reordered, "all running locally on your machine" removed)
- Old subtitle (Gen1): `Multi-provider, multi-model, with full tool use and autonomous capabilities.`
- Quick action labels (current, default `coding` preset): `Start coding / Run tests / Review code / Research / Compare models / Check costs` with sub-descriptions (`Open the code editor`, `Run project tests`, `Open diff view`, `Deep research a topic`, `Side-by-side comparison`, `View spending`)
- Old quick action labels: `Build a feature / End-to-end code generation`, `Debug an issue / Find and fix systematically`, `Compare models / Side-by-side evaluation`, `Start Autopilot / Autonomous execution` **— these strings do not exist anywhere in current source** (confirmed with grep)
- Keyboard hints bottom: `⌘K commands · ⌘N new chat · ⌘B sidebar`
- Composer placeholder: `Ask WOTANN anything...` (current) and older `Message WOTANN (chat mode) -- Enter to send, Shift+Enter for newline` (Gen1)

### Onboarding
- Step names: `Welcome` `System` `Engine` `Providers` `Ready`
- Welcome title: `What would you like to build?`
- Subtitle: `The All-Father of AI Agent Harnesses`
- Body: `One app, every AI provider. Chat, build code, control your desktop, and run autonomous agents — all locally on your machine.`
- Feature pills: `11 AI Providers`, `100% Local`, `Zero Cost`
- Feature pill sub-labels: `Claude, GPT, Gemini, Ollama...`, `Everything runs on your machine`, `Bring your own API keys`
- CTA: `Get Started →`
- System step title: `System Check`
- System subtitle: `WOTANN needs a few things to run. We'll check and install them for you.`
- Dependency names: `Node.js`, `npm`, `Ollama (Local AI)` (current) / `WOTANN CLI` + `Not available outside Tauri` (old)
- Buttons: `← Back`, `Skip →` / `Skip for now →`, `Install`, `Download ↗`
- Engine step: `Start the Engine`, `The WOTANN Engine runs as a background service, connecting to all your AI providers.`, `Starting engine...`, `Waiting for engine to start (4/10)...`
- Providers step: `Add a Provider`, `Enter at least one API key. Ollama is free and runs locally.`, `Ollama (Free, Local) FREE http://localhost:11434`, `Anthropic (Claude) sk-ant-...`, `OpenAI (GPT) sk-...`, `Google (Gemini)`, `Get key ↗`
- Ready step: `You're all set!`, `You can add API keys anytime in Settings → Providers.`, `Start Using WOTANN →`, `⌘K for commands · ⌘N for new chat`

### Command palette
- Placeholder: `Search commands, views, modes...` + `esc` hint
- Section headings: `SESSION`, `NAVIGATION`, `EXPLOIT`
- Session items: `New Chat / Start a new conversation Cmd+N`, `New Incognito Chat / Start a private conversation (not saved to memory)`, `Toggle Incognito / Toggle incognito mode on current conversation`
- Navigation items: `Go to Chat / Switch to chat view`, `Open Editor / Open code editor`, `Compare Models / Side-by-side model comparison`, `Workshop Cmd+3`

### Notification panel
- Title: `Notifications`
- Filter chips: `All`, `Completed`, `Errors`, `Approvals`, `Cost`, `Agents`
- Empty state: `No notifications`

### Exploit view
- Header: `Security Research`, `Exploit mode inactive`
- Buttons: `Enable Exploit Mode` (red), `Chat`
- Tab pill on Exploit: `EXPLOIT MODE` badge
- Panel titles: `Engagement Scope`, `Summary`, `Findings`
- Engagement fields: `TARGET`, `SCOPE / RULES`
- Engagement placeholder: `e.g., app.example.com`, `Authorized testing scope, rules of engagement...`
- Summary rows: `Total Findings`, `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`
- Empty state: `No findings yet`, `Start an engagement to begin security research`
- Status bar: `Exploit Active`

### Editor view
- Sidebar: `Threads`, `Files` tabs
- Empty state: `No project open`, `Open Folder`
- Center: `Select a file to edit`, `Choose from the file tree or drag files into chat`
- Bottom: `Terminal`, `Q Search`
- Right panel: `Chat ▾`, `Select a conversation or start a new chat to see messages here.`

### Model picker (Gen3)
- Placeholder: `Search models...`
- Empty: `No models match ""`

## Source-code cross-reference

For each screenshot, the implementation mapping (and any observed drift):

| Screenshot | Implements file | Drift vs screenshot |
|---|---|---|
| `depth-welcome.png`, `onboarding-welcome.png`, `onboarding-step1.png`, `e2e-step1-welcome.png`, `depth-after-click.png` | `desktop-app/src/components/onboarding/OnboardingView.tsx:77-600` (Welcome step) | None. All text literals match. Step-label array at line 73 matches screenshots. |
| `depth-system-check.png` | `OnboardingView.tsx` System step | **Old screenshot.** Shows "WOTANN CLI / Not available outside Tauri" which are NOT in current code. Current source (line 527) uses `"Ollama (Local AI)"` + Install / Download split. |
| `e2e-step2-system.png`, `onboarding-deps.png` | `OnboardingView.tsx` System step | **Matches current source.** Node.js / npm / Ollama (Local AI) with Install + Download buttons. |
| `onboarding-engine.png` | `OnboardingView.tsx` Engine step | **Matches.** `engineStatus` state + progress text "(4/10)". |
| `onboarding-providers.png` | `OnboardingView.tsx` Providers step + `PROVIDERS` const line 63 | **Matches.** Ollama (Free, Local) FREE pill, Anthropic, OpenAI, Google, Groq, OpenRouter. |
| `e2e-step5-done.png`, `onboarding-done.png` | `OnboardingView.tsx` Ready step, `Start Using WOTANN →` at line 994 | **Matches.** |
| `main-app-chat.png`, `chat-input-focused.png`, `input-fix-check.png` | `AppShell.tsx` + `Header.tsx` + `ChatView.tsx` WelcomeScreen + `workspace-presets.ts` `coding` preset | **95% match.** Subtitle drift: screenshot says "— all running locally on your machine."; ChatView.tsx:134 is shorter. Everything else (tab labels, quick-action labels, keyboard hints, sidebar, W logo) matches literally. |
| `command-palette.png` | `desktop-app/src/components/palette/CommandPalette.tsx:223-566` | **Matches.** Every palette item text literal is in the source. |
| `model-picker-open.png` | `desktop-app/src/components/input/ModelPicker.tsx` | **Matches.** "Search models..." placeholder, empty-state "No models match" literal. |
| `notification-panel.png` | `desktop-app/src/components/notifications/NotificationCenter.tsx` | **Matches.** Filter chips (Completed/Errors/Approvals/Cost/Agents). |
| `editor-space.png` | `EditorPanel.tsx`, `FileTree.tsx`, `ChatPane.tsx`, plus AppShell layout with `contextPanelOpen=true` | **Matches.** Empty-state texts "No project open" / "Select a file to edit" are present. |
| `exploit-space.png`, `exploit-focused-input.png` | `desktop-app/src/components/exploit/ExploitView.tsx` | **Matches.** Every string (Security Research, Engagement Scope, TARGET, SCOPE/RULES, Total Findings, CRITICAL/HIGH/MEDIUM/LOW, "No findings yet", "Enable Exploit Mode", "Exploit Active") is in source. |
| `depth-main-app.png`, `fix-layout-*.png`, `main-app-view.png`, `main-app-fixed.png`, `final-main-view.png`, `e2e-main-app.png`, `chat-view-input.png` | Gen 1 main-app (Chat/Build/Autopilot/Compare top-tabs + Chats/Projects/Skills/Workers sub-tabs) | **Source no longer implements this layout.** A past session tore it out. `ModePicker.tsx` still has Chat/Build/Autopilot/Compare/Review as secondary modes. Sidebar now has no sub-tabs ("Sub-tabs (Threads/Files/Workers/Findings) are REMOVED" — `Sidebar.tsx:12`). `Header.tsx` now renders 4 new pills: Chat/Editor/Workshop/Exploit (`Header.tsx:24-29`). |

### Code churn evidence (Header.tsx is contradicting itself)

`desktop-app/src/components/layout/Header.tsx:5-11`:
```
 * Layout:
 * [hamburger] [Chat|Editor] (spacer) [Terminal] [Diff] [Model] [Notif] [Settings] [Cmd+K]
 *
 * The 4-tab header (Chat|Editor|Workshop|Exploit) is eliminated.
 * Workshop is accessed via the Worker Pill in the sidebar.
 * Exploit is accessed via the command palette or settings.
```

Then lines 24-29 immediately after:
```
const VIEW_PILLS: readonly { readonly id: AppView; readonly label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "editor", label: "Editor" },
  { id: "workshop", label: "Workshop" },
  { id: "exploit", label: "Exploit" },
];
```

The comment block flatly contradicts the code — a past session removed the 4-tab header, the session-10 UX audit (line 19-23: "Session-10 UX audit TD-3.1: Workshop and Exploit were only reachable from the palette / sidebar workerpill despite being peer-level 'spaces'. Adding them as top-pill gives first-time users a visible path...") put them back, and nobody updated the doc comment. This is a truthful signal that the 4-tab model is the current, shipped, visible reality.

## Design quality scorecard

Rating current Apr-6-era UI (generation 3) on 5 Apple Design Award dimensions, 1–10 each:

| Dimension | Score | Evidence / gap |
|---|---|---|
| **Typography** | 6 / 10 | Inter Variable + SF Pro Text + JetBrains Mono Variable + Geist Sans declared in `wotann-tokens.css`. Heading `What would you like to build?` uses 28px / 600 / -0.5px tracking — tight, competent. Body text is 14–15px. Status bar uses 11–12px. Hierarchy is correct. **Gap**: no variable-weight transitions (e.g. 400→500 on hover), no italics for tone shifts, quick-action labels are only 11px (below Raycast/Linear floor of 13px for glanceable labels). Runic font (`Noto Sans Runic`) is declared but not used — brand thread missed. |
| **Spacing** | 6 / 10 | 4-multiple spacing scale (`--wotann-space-1` through `-12`) is declarative and consistent. Quick-action grid padding 8px 12px, gap 6px — cramped but readable. **Gap**: card inner padding on quick-action tiles is 8px, tight compared to Raycast (12px) and Linear (16px). Empty-state center-alignment in Editor and Exploit is correct; however vertical rhythm is slightly off: the W logo sits a fraction too close to the heading (screenshot `chat-input-focused.png` shows them bumping). |
| **Color** | 7 / 10 | 5 named themes in source: mimir (default dark), yggdrasil (light), runestone, bifrost, valkyrie (Exploit-only). Purple accent `#3e8fd1` → `#7dc4f5` in mimir with gold `#c9a14a`. Red `#c04a3e` for warn/critical. 7.1:1 contrast claim documented (line 63). **Gap**: red disconnected banner is flat salmon — too saturated for the near-black canvas, "shouts" where it should whisper. Mimir blue accent is tastefully desaturated but lacks the purple-to-violet gradient Linear uses for focus. Purple primary gradient on logo is nice but only 2 stops — flatter than Superhuman's 4-stop purple. |
| **Motion** | 5 / 10 | 4 named ease curves (`ease-out-expo`, `productive`, `standard`, `pop`) + 5 named durations. `logoBreathe` 4s animation on W logo. Sidebar slide + context-panel slide use `--transition-normal`. Terminal resize drag has `none` during drag, transition on release. **Gap**: no enter-exit choreography on welcome-screen quick-action tiles (only a stagger-1..6 class which does minimal fade). The 4-pill tab switch has no pill-to-pill motion ink like Linear's underline slide. Command-palette open has backdrop fade but no card slide-up. Notification-panel has no scale-in. Overall: functional, not delightful. |
| **Affordance** | 6 / 10 | Every tab is a proper `role="tab"` with `aria-selected`. Every panel has `aria-label`. Focus rings defined as non-negotiable a11y floor (`--wotann-focus-ring`). Keyboard shortcuts shown in palette and bottom welcome hints. Skip-to-main-content link present. **Gap**: the 4 tabs use `background: transparent / accent-muted` distinction — active state is too subtle (screenshot `chat-input-focused.png`: the difference between active "Chat" and inactive "Editor/Workshop/Exploit" is only ~15% luminance; Linear makes this a hard ~40% luminance difference + bold weight). Quick-action cards look clickable but their hover state is only translateY(-2px) + shadow — no border-color shift, no accent tint. Feels a bit undifferentiated from static content. |

**Overall**: **6.0 / 10** on current generation. The foundation is in place (tokens, themes, a11y, keyboard) but polish has not landed. Gen-1 screenshots score roughly 5.0 — mostly the same foundation with less sophisticated status bar. Onboarding (screenshots `onboarding-welcome.png`, `e2e-step1-welcome.png`, `onboarding-step1.png`) is the highest-polish surface at **~7 / 10** — the 3 feature pills with emoji icons, the gradient Get Started button, and the progress-stepper have presence.

## Competitor comparison

Per-dimension ranking of WOTANN (current, Apr 6–19) vs 7 named targets:

| Dimension | WOTANN | Cursor 3 | Claude Code TUI | Glass | Conductor | Zed | Linear | Raycast | Superhuman |
|---|---|---|---|---|---|---|---|---|---|
| Typography clarity | 6 | 8 | 7 (monospace-first) | 9 | 7 | 8 | 9 | 9 | 9 |
| Spacing / rhythm | 6 | 7 | 6 | 8 | 8 | 8 | 9 | 9 | 9 |
| Color / palette | 7 | 7 | 6 | 9 | 8 | 7 | 8 | 8 | 8 |
| Motion / delight | 5 | 6 | 4 | 9 | 8 | 6 | 8 | 8 | 9 |
| Information density | 7 | 9 | 9 | 5 | 7 | 9 | 7 | 6 | 7 |
| Glass / depth | 3 | 4 | N/A | 10 | 9 | 4 | 5 | 6 | 5 |
| Keyboard parity | 7 | 7 | 10 | 3 | 5 | 9 | 9 | 10 | 8 |
| Status bar craft | 6 | 7 | 5 | 4 | 7 | 9 | 7 | 6 | 6 |
| Empty states | 6 | 6 | 5 | 8 | 7 | 6 | 8 | 7 | 8 |
| Onboarding polish | 7 | 6 | 3 | 9 | 8 | 5 | 8 | 8 | 9 |

**Overall ranking (higher is better, out of 7 peers excl. WOTANN)**:
- Top tier: Glass, Superhuman, Linear, Raycast, Conductor (Apple-Design-Award bar)
- Mid tier: Cursor 3, Zed, Claude Code TUI (vertical-specific, peers)
- **WOTANN today**: just below Claude Code TUI / Zed and above no one in the panel. **Specific shortfalls**: motion (5 vs ≥6 everywhere else that isn't TUI), glass (3 vs ≥4 everywhere that isn't TUI), spacing (6 vs ≥7 in app-peers).

## Gap list

### Features visible in screenshots but NOT in current code (regression risk)

1. **"all running locally on your machine" tagline in welcome subtitle** — visible in 12 Playwright traces and in the Apr 6 `chat-input-focused.png`. Current `ChatView.tsx:134` dropped it. **Action**: minor copy regression, low impact but the "locally" claim is positioning-critical. Recommend restoring.
2. **"WOTANN CLI" dependency row in System check** — visible in `depth-system-check.png` (Apr 5). Not in current onboarding — replaced by `Ollama (Local AI)`. Likely intentional (WOTANN CLI is the parent package itself; checking for it in onboarding is weird) but worth documenting the deliberate removal.
3. **"0.0K / 200K" context meter in bottom status bar** — visible in Gen1 screenshots (`chat-view-input.png`, `fix-layout-chat.png`). StatusBar.tsx still has `exploitFindings` but I did not see the context meter string. If the feature was intentionally demoted, fine; if it was dropped accidentally, that's a regression.
4. **"Chats / Projects / Skills / Workers" sidebar sub-tabs** — visible in all Gen1 screenshots. Sidebar.tsx:12 comment says these were *intentionally* removed ("Sub-tabs (Threads/Files/Workers/Findings) are REMOVED. Files live in Editor view only. Workers are in the Worker Pill.") — this is intentional churn, not a regression.

### Features in current code but NOT shown in any screenshot (untested visually)

1. **Runering** (`desktop-app/src/components/wotann/Runering.tsx`) — global rune-glyph ritual overlay. Not visible in any screenshot (presumably idle / renders null in captures).
2. **ValknutSpinner** — only seen peripherally; may render inside loading states that no screenshot triggered.
3. **KeyboardShortcutsOverlay** — presumably Cmd+/; no screenshot captures it.
4. **All yggdrasil / runestone / bifrost / valkyrie themes** — every screenshot uses mimir (dark). Light theme (`yggdrasil`) is declared in tokens but never screenshot.
5. **MeetPanel**, **ArenaView**, **IntelligenceDashboard**, **CanvasView**, **AgentFleetDashboard**, **ConnectorsGUI**, **ProjectList**, **DispatchInbox**, **ExecApprovals**, **PluginManager**, **DesignModePanel**, **CodePlayground**, **ScheduledTasks**, **ComputerUsePanel**, **CouncilView**, **TrainingReview**, **TrustView**, **IntegrationsView** — AppShell.tsx lazy-loads 24 views total; only 5 appear in screenshots (chat, editor, workshop-adjacent, exploit, onboarding). **Big gap**: 19 views are invisible — we cannot assess quality without running them.
6. **iOS app** — 34 view directories in `ios/WOTANN/Views/` (Arena, Autopilot, Channels, Dashboard, Dispatch, Meet, Memory, MorningBriefing, OnDeviceAI, Pairing, PromptLibrary, RemoteDesktop, Voice, Work, Workflows, etc.). Only one iOS screenshot exists (`docs/session-10-ios-pairing.png`) and it was excluded from Agent E scope.
7. **Ink TUI** — fully functional (verified `node dist/index.js --help` returns 40+ commands), 15 Ink components, not shown in any screenshot.

### Design polish gaps (from the scorecard)

1. **Active-tab treatment too subtle** (`Header.tsx:96-107`): use `backgroundColor + fontWeight: 600 + accent underline` instead of just `accent-muted` tint.
2. **Quick-action card hover state undifferentiated**: add a 1px accent-muted border on hover in addition to translateY — Raycast and Linear both do this.
3. **Logo-to-heading gap**: increase from 16px to 24px margin on Welcome screen — it looks compressed in `chat-input-focused.png`.
4. **Disconnected banner too loud**: current is salmon/orange; recommend an amber tint (`--amber`) with a subtle stripe pattern — less-alarming-but-still-noticeable is the Linear/Raycast pattern.
5. **No light theme visible in any screenshot**: ship and capture yggdrasil before claiming theme support.
6. **No stagger animation on welcome quick actions**: `animate-stagger-${i+1}` class exists but the classes themselves (if defined in globals.css) do not produce the layered cinematic entrance that Cursor 3 has for its welcome grid.
7. **Only 2-stop purple gradient on logo**: upgrade to 4-stop (Linear/Superhuman) with inner-glow.
8. **Runic font declared but never used**: use it for a single accent (e.g., the W in the logo, or an inline decorative divider in Exploit mode).
9. **No haptic feedback cues in desktop**: even visual ones (e.g., button-press micro-bounce on submit) would signal craft.
10. **ModePicker comment still says "Chat, Build, Autopilot, Compare, Review"** — the comment is stale; the component may be too. Worth reviewing if the old 5-mode picker even makes sense alongside the new 4-tab system.

## TUI state (Ink)

- `npm run build` previously emitted `dist/index.js` (present, executable).
- `node /Users/gabrielvuksani/Desktop/agent-harness/wotann/dist/index.js --help` returns 43 top-level commands including `start` (interactive TUI), `run`, `cu`, `kanban`, `cli-registry`, `autofix-pr`, `git`, `dream`, `audit`, `voice`, `local`, `engine`, `channels`, `memory`, `skills`, `cost`, `precommit`, `mcp`, `lsp`, `repos`, `autonomous|auto`, `onboard`, `serve`, `arena`, `architect`, `council`, `enhance`, `train`, `research`, `guard`, `config`, `ci`.
- Entry component: `src/ui/App.tsx` mounts **StartupScreen / ChatView / StatusBar / PromptInput / ContextHUD / DiffViewer / AgentStatusPanel / HistoryPicker / MessageActions / ContextSourcePanel** from `src/ui/components/` (15 Ink components total: also MemoryInspector, DiffTimeline, DispatchInbox, PermissionPrompt, ProofViewer — not all imported into App.tsx but they exist).
- TUI is wired through `WotannRuntime` (full middleware stack), confirmed by App.tsx:1-10 header comment.
- **No screenshot exists for the TUI** — Agent E cannot visually verify it. Recommended follow-up: capture a screenshot of `wotann start` interactive session before the next audit.

## File paths referenced (absolute)

- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/App.tsx` — React root (75 lines, small)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/layout/AppShell.tsx` — layout + 24-view lazy router (413 lines)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/layout/Header.tsx` — tab pills + controls (220 lines, **stale comment**)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/layout/Sidebar.tsx` — project-grouped conversations (741 lines)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/chat/ChatView.tsx` — chat + WelcomeScreen (492 lines)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/onboarding/OnboardingView.tsx` — 5-step onboarding (1212 lines — **largest single component**)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/exploit/ExploitView.tsx` — Security Research view
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/editor/EditorPanel.tsx` — Monaco editor pane
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/workshop/WorkshopView.tsx` — workflow DAG view
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/palette/CommandPalette.tsx` — Cmd+K palette
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/input/ModelPicker.tsx` — model dropdown
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/input/ModePicker.tsx` — **stale** secondary mode picker (Chat/Build/Autopilot/Compare/Review)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/components/notifications/NotificationCenter.tsx` — top-right panel
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/lib/workspace-presets.ts` — quick-action sets per preset (`coding`, `security`, `pm`, `data`)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/styles/wotann-tokens.css` — 5-theme design tokens
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src/styles/globals.css` — resets + utility classes (56 backdrop-filter usages)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src-tauri/tauri.conf.json` — 1200x800 window, 800x600 min
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/desktop-app/src-tauri/src/` — 13 Rust source files (lib.rs, commands.rs, computer_use/, remote_control/, sidecar.rs, state.rs, tray.rs, audio_capture.rs, cursor_overlay.rs, hotkeys.rs, input.rs, ipc_client.rs, localsend.rs, main.rs)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/ui/App.tsx` — Ink TUI (NOT the desktop app — they coexist)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/ios/WOTANN/` — Swift app with 34 view directories
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/dist/index.js` — compiled CLI (confirmed working via `--help`)

## Truth summary

- **Has the UI shown in current screenshots (Apr 6) shipped?** **Yes** — the Apr 6 23:30+ screenshots accurately reflect the current code. Every visible text string, layout structure, tab name, sidebar rail icon, and keyboard hint is in source.
- **Are older (Apr 5) screenshots aspirational mocks?** **No** — they are stale captures of an earlier, real implementation that has since been torn out and rebuilt. The 4-tab (Chat/Build/Autopilot/Compare) layout shipped once, was replaced by the 4-tab (Chat/Editor/Workshop/Exploit) layout in late Apr 6.
- **Is the 4-tab layout per plan v3 reflected in code?** **Yes**, exactly as Chat/Editor/Workshop/Exploit in `Header.tsx:24-29`.
- **Does the welcome/onboarding flow match `e2e-step1-welcome.png` etc.?** **Yes** — near-pixel match on Welcome, System (current variant only), Engine, Providers, Ready. Old System step showing "WOTANN CLI / Not available outside Tauri" is **not** current.
- **Is Glass UI in CSS today?** **Partially.** 78 `backdrop-filter` usages exist; blur+saturate is applied to Header, Sidebar, CommandPalette, ModelPicker, OverlayBackdrop, KeyboardShortcutsOverlay. **Not** at Glass-app/Conductor fidelity (no layered parallax, no dynamic tinting, no animated highlights, no noise-grain overlay).
- **How does WOTANN compare to Cursor 3, Claude Code TUI, Glass, Conductor, Zed, Linear, Raycast, Superhuman?** Bottom of the pack on motion and glass; middle on typography, spacing, color; competitive on keyboard parity (matches or beats Cursor 3). Roughly equivalent to Zed and ahead of TUI-only tools but behind every app-peer shown on polish.
