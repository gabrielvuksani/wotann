# 07 — Surface: Ink TUI (terminal)

Source: `wotann/src/ui/App.tsx` (2,979 lines) + 15 components under `wotann/src/ui/components/`.

## Launch path

- Command: `wotann start` (from `wotann/src/index.ts`).
- Binary: `node dist/index.js start` or `npx tsx src/index.ts start`.
- Runtime: Node.js 20+, Ink (React for CLI).
- Minimum terminal: 80×24 characters. Target: 120×40.

## Layout anatomy

The TUI is a single `<Box flexDirection="column">` rooted in `App.tsx`:

```
┌─ StartupScreen (conditional on !ready) ──────────────────────────┐
│  WOTANN logo + version + "Press any key"                         │
└──────────────────────────────────────────────────────────────────┘
┌─ ContextHUD (always mounted, fixed at top) ──────────────────────┐
│  provider · model · cost $ · context 0.0K / 200K · mode · turn N │
└──────────────────────────────────────────────────────────────────┘
┌─ Main pane (flexGrow=1) — EXACTLY ONE of: ───────────────────────┐
│                                                                   │
│  ChatView (default)                                               │
│    or DiffViewer (when activePanel=="diff")                       │
│    or AgentStatusPanel (when activePanel=="agents")               │
│    or ContextSourcePanel (when showContextPanel)                  │
│    or HistoryPicker (when showHistoryPicker)                      │
│    or MessageActions (when showMessageActions)                    │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
┌─ StatusBar (always mounted, fixed at bottom) ────────────────────┐
│  $ cost · context% · reads N · edits M · bash calls K · mode     │
└──────────────────────────────────────────────────────────────────┘
┌─ PromptInput (always mounted, fixed below StatusBar) ────────────┐
│  > Ask WOTANN anything...                                         │
└──────────────────────────────────────────────────────────────────┘
```

## The 15 Ink components (canonical list)

Source: `wotann/src/ui/components/`:

1. **StartupScreen.tsx** — splash / version / any-key-continue.
2. **ChatView.tsx** — message stream (user + assistant + tool calls).
3. **StatusBar.tsx** — session-level cost + context + mode + turn count.
4. **ContextHUD.tsx** — 98 LOC — header-level context meter.
5. **PromptInput.tsx** — 212 LOC — composer with slash autocomplete.
6. **DiffViewer.tsx** — inline diff with hunk accept/reject.
7. **AgentStatusPanel.tsx** — subagent grid.
8. **HistoryPicker.tsx** — session rewind + fork.
9. **MessageActions.tsx** — per-message menu (copy, fork, save-as-skill).
10. **ContextSourcePanel.tsx** — "what's in context" breakdown.
11. **MemoryInspector.tsx** — searchable memory feed.
12. **DiffTimeline.tsx** — per-commit scrubber.
13. **DispatchInbox.tsx** — cross-channel task list.
14. **PermissionPrompt.tsx** — tool-call approval.
15. **ProofViewer.tsx** — sealed scroll rendering.

## Current-state screenshot

**None.** No TUI screenshot in the inventory. From `UI_REALITY.md`: "Ink TUI — fully functional (verified `node dist/index.js --help` returns 43 top-level commands), 15 Ink components, not shown in any screenshot."

**Claude Design must draft TUI wireframes as ASCII art** (below) and **request a future agent to capture actual PNGs** of the interactive TUI once redesign lands.

## Redesign targets

### 1. Command palette (NEW) — ⌃P or backtick

The biggest single-item gap per `UI_UX_AUDIT.md` §6.3 P1.

**Current**: `PromptInput.tsx:177-181` shows a single-match slash autocomplete hint when typing `/`. Users type `/help` for a 40-line ASCII table of 50+ slash commands.

**Target**: a full-screen overlay with:
- Fuzzy search over all 50+ slash commands, themes (65 themes in `themes.ts`), recent memory topics, active sessions.
- Category headers (`SESSION / NAVIGATION / MEMORY / SKILLS / PROVIDERS / ARENA / COUNCIL / ...`).
- MRU surfacing: last 3 commands float to top.
- Right-edge keyboard hints: `⌘N` / `⌘M` / etc.
- Escape = close.

**Wireframe** (120 cols):

```
╔═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
║ ᚨ  What would you have me do?                                                                        esc close ║
║═══════════════════════════════════════════════════════════════════════════════════════════════════════════════║
║ SESSION                                                                                                        ║
║   › /new       Start a new conversation                                                              ⌘N        ║
║   › /fork      Fork at this turn                                                                               ║
║   › /undo      Rewind to previous turn                                                                         ║
║ NAVIGATION                                                                                                     ║
║   › /focus     Collapse to 3-line focus view                                                                   ║
║   › /panel     Cycle diff / agents / memory panel                                                              ║
║ PROVIDERS                                                                                                      ║
║   › /model     Switch model (gpt-5 → opus → gemma)                                                 ⌘M        ║
║   › /council   Run top-3 models in parallel                                                                    ║
║ SKILLS (86 loaded)                                                                                             ║
║   › /skills    Browse all skills                                                                               ║
║   › /research  Multi-source research                                                                           ║
║ MEMORY                                                                                                         ║
║   › /memory    Search persistent memory                                                                        ║
║   › /dream     Trigger dream pipeline                                                                          ║
║ 12 results                                                                                              Tab↕    ║
╚═══════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
```

### 2. Block-based chat rendering — REPLACE free-text ChatView

From `UI_UX_AUDIT.md` §4.4 P1 items 1.7 + 1.8.

**Current**: `ChatView.tsx` renders each message as a `<Box>` with user/assistant prefix, tool calls as inline text blocks.

**Target**: every turn (user prompt, assistant response, tool call) renders as a `<Block>`:

```
┌─ ᛗ user · 14:23:01 ──────────────────────────────────────────────────┐
│  Refactor the auth middleware to use PASETO tokens.                   │
└──────────────────────────────────────────────────────────────────────┘

┌─ ᛒ opus · 14:23:02 ──────────────────── $0.04 ─ 1.2s ─ [ ⎘ ↻ ↗ ] ──┐
│  I'll plan the migration first, then implement.                       │
│                                                                       │
│  Plan:                                                                │
│  1. Audit current auth flow                                           │
│  2. Add PASETO dependency                                             │
│  3. Draft token issuer + verifier                                     │
│  4. Migrate middleware                                                │
│  5. Verify tests                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌─ 🜄 tool · ripgrep · 14:23:04 ─────── 0.3s ─ [ ⎘ ↻ ] ─ ✓ ──────────┐
│  $ rg "authenticate\(" --type ts                                      │
│  src/auth/middleware.ts:47:export function authenticate(              │
│  src/auth/guard.ts:12:export async function authenticate(             │
│  2 matches in 2 files                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

Features:
- Left gutter 3-char rule (`│`) colored by status (moss for success, blood for error, rune for running),
- Status at top-right (`✓` / `✗` / `…`),
- Actions inline (`[ ⎘ copy, ↻ rerun, ↗ share ]`),
- Per-block timing + cost,
- Keyboard nav: `j` / `k` to move active block, `⏎` to copy active, `r` to rerun.

### 3. Status bar — per-turn cost ticker

From `UI_UX_AUDIT.md` §6.3 P3.

**Current** (`StatusBar.tsx`): shows session total ($0.00) and today total ($0.00).

**Target**: add per-turn live cost + context meter:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│  opus ◈ 1M  ·  $0.00  ·  ᚠ $0.04/turn  ·  ████░░░░░░ 40% ctx (82K/200K)  ·  ᛗ 12 turns  ·  build │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- `ᚠ $0.04/turn` — runes its, live-updating during streaming,
- `████░░░░░░ 40% ctx` — 10-cell horizontal meter, colored by zone (moss <50%, gold 50-80%, blood >80%),
- `ᛗ 12 turns` — turn count with Mannaz rune.

### 4. Thinking indicator — RuneForge

From `UI_DESIGN_SPEC_2026-04-16.md` §6 item 2 + `UI_UX_AUDIT.md` §8 tier-2 item 2.5.

Replace the three-dot `...` spinner with three Elder Futhark glyphs (ᚠ ᛉ ᚹ) that:
- Stroke-dash from 0 → 100% in sequence (320ms each),
- Fill with `--wotann-accent-rune` for 120ms,
- Un-stroke in reverse.
- Infinite loop while streaming.
- Accessibility: `aria-label="WOTANN is thinking"`.

In Ink, this is a `<Text>` that swaps between 3 pre-rendered runes at 120ms cadence.

### 5. Theme cycle

Current: 65 themes in `themes.ts`. **10+ contain purple** — anti-pattern violation.

Action items:
- Purge purple from Ink defaults per `UI_UX_AUDIT.md` §5.4.
- Add 5 named themes: mimir, yggdrasil, runestone, bifrost, valkyrie (from `wotann-tokens.css`).
- `/theme <name>` slash command.
- Theme preview in palette.

### 6. Diff view

`DiffViewer.tsx` exists. Redesign target:
- Left-right side-by-side on wide terminals (≥120 cols),
- Unified view on narrow terminals (<120 cols),
- Per-hunk accept/reject (`a` / `r` keys),
- Proof-seal indicator when all hunks accepted.

### 7. Context source panel

`ContextSourcePanel.tsx` exists. Redesign target:
- Tree-style breakdown: `System (4K) | Skills (8K) | Messages (42K) | Files (18K) | Memory (10K) | Total 82K/200K`.
- Sorted by size descending.
- Collapsible: press `⏎` to expand a node.

### 8. Memory inspector

`MemoryInspector.tsx` exists. Redesign target:
- Filter chips: `case` / `pattern` / `decision` / `feedback` / `project` / `reference`.
- Hit list with timestamp + topic_key + 1-line preview.
- `o` to open full observation, `r` to delete, `p` to pin.

## Wiring notes (do NOT break)

- `WotannRuntime` is the god object — every user action calls `runtime.*`. Source: `src/core/runtime.ts`.
- 50+ slash commands dispatch dynamically — e.g., `/mcp` dynamically imports `MCPRegistry`, `/audit` imports `queryWorkspaceAudit`. Do not hardcode lists; introspect from runtime.
- `App.tsx` uses React `useState` reducers, not an external store. Keep this pattern.
- StatusBar needs `runtime.getContextBudget()`, `runtime.getEditTracker()`, etc. — do not fabricate.

## States to design

| State | Description | Current |
|---|---|---|
| First-run | No config, no sessions yet | StartupScreen → "Press any key" |
| Connected | Engine running, provider set | ChatView |
| Disconnected | Daemon offline | Banner + reconnect hint |
| Streaming | Assistant generating | RuneForge spinner |
| Awaiting approval | Tool call needs permission | `PermissionPrompt` overlay |
| Focus mode | Collapsed to 3 lines | No current UI — ship `/focus` |
| Palette open | ⌃P overlay | NEW |
| Diff review | Hunk-by-hunk | `DiffViewer` |
| Rewind | Session fork | `HistoryPicker` |

Claude Design must produce a wireframe for each state.

---

*End of 07-surface-tui.*
