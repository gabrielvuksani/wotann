# WOTANN Desktop UI Redesign — Design Reference (NOT Definitive)

> **IMPORTANT FOR CLAUDE CODE**: This document is a DESIGN REFERENCE, not a pixel-perfect spec.
> The user approved the structural decisions but is NOT fully satisfied with the visual execution
> in the mockups. Use this as architectural guidance and apply your best judgment for the visual
> polish. Specifically: text contrast needs to be higher (some text was invisible against backgrounds
> in mockups), and many UI elements need refinement. Treat this as the skeleton — the user wants
> the final result to feel like a premium macOS-native app, not a copy of these mockups.

## Source Materials
- Interactive mockup: `.superpowers/brainstorm/25804-1775688061/content/interactive-v3.html`
- Design research: 10 DESIGN.md files analyzed (Cursor, Linear, Raycast, Claude, Apple, Vercel, Stripe, Notion, xAI, OpenCode)
- T3 Code sidebar analysis, Apple Design Award patterns 2020-2025
- Current app: `desktop-app/src/` (87 component files, 66 .tsx files)
- Depth design spec: `.wotann/DESIGN.md` (still canonical for color tokens)

---

## Approved Structural Decisions

### 1. Navigation Architecture

**Header pills: Chat | Editor** (only two views that replace main content)
- Chat = full conversation view
- Editor = file tree + Monaco code + tabs

**Toggle buttons in header toolbar** (NOT pills — these are icon buttons):
- Terminal icon → toggles bottom panel (VS Code / Cursor 3 pattern)
- Diff/Changes icon → toggles right side panel (Codex pattern)
- Both work independently on either Chat or Editor view
- Both can be open simultaneously
- Icon highlights with accent color when panel is active

**Removed from header**: The 4-tab space switcher (Chat/Editor/Workshop/Exploit) is eliminated.
Exploit mode is accessed via command palette or settings. Workshop is replaced by the worker pill.

### 2. Sidebar Architecture — Project Groups (T3 Code inspired)

**No more space sub-tabs** (Threads/Files/Workers/Findings tabs are removed from sidebar).
**No more files section in sidebar** (files live in Editor view only).

**Sidebar structure top to bottom:**
1. Brand row: W logo + "WOTANN" + New Chat button + Settings gear
2. Search bar with Cmd+K hint
3. Project groups (collapsible):
   - Each project: colored icon (first letter) + project name + chat count + collapse chevron
   - Under each project: conversation list with status dots + title + time
   - Active conversation: thin violet left bar (2-3px) with glow shadow
   - Status dots: blue pulsing = working, green = done, near-invisible = idle
   - Optional preview text on active conversation
4. Divider
5. Worker pill (floating, compact):
   - Colored dots showing active worker count
   - "N workers" label + cost
   - Click to expand into workshop/worker details (this IS the workshop entry point)

### 3. Worker Pill = Workshop Entry Point

The worker pill at the bottom of the sidebar IS how users access Workshop functionality.
- Default: compact pill showing dot indicators + count + cost
- On click: expands into a panel/overlay showing full worker details (progress bars, model, kill button)
- This replaces the dedicated Workshop view — workers are ambient, not a destination

### 4. Terminal — Bottom Panel

- Opens below the current view (Chat or Editor) like VS Code
- Has its own header with "Terminal" label + close button
- Persistent cwd across commands
- Command history (up/down arrows)
- Command input with directory prompt

### 5. Diff/Changes — Right Side Panel

- Opens to the right of the current view like Codex
- Has its own header with "Changes" label + close button
- Shows file-by-file diffs with green/red line highlighting
- Accept/Reject buttons per file or per hunk
- File name + stats header (+N -N)

### 6. Tool Calls — Minimal Inline

Tool calls in chat are NOT bulky collapsible blocks. They are minimal single-line indicators:
```
● edit_file · src/middleware.ts +3 -1
● read_file · tests/auth.test.ts
```
- Tiny violet dot (2-3px, low opacity)
- Tool name in monospace
- Separator dot
- Details in monospace, dimmer

### 7. Message Bubbles

- User messages: subtle accent-tinted background, rounded, left-aligned
- Assistant messages: no background (or barely-there surface), content-focused
- WOTANN avatar: small gradient violet circle with W
- Token/cost metadata: tiny, below assistant messages, near-invisible until you look
- Actions (copy, retry, fork, edit): appear on hover only

---

## Visual Direction (Reference, Not Definitive)

### What the user liked:
- Glass/translucent sidebar with ambient violet glow
- Project groups with colored icons (T3 Code pattern)
- Minimal tool call indicators (dots, not blocks)
- Worker pill as ambient presence
- Overall dark, minimal, premium feel
- Chat + Editor as the only two "views"
- Terminal at bottom, Diff on right as toggles

### What the user did NOT like:
- Text contrast too low (some text invisible against dark backgrounds)
- Some specific UI element choices in the mockups
- Overall visual execution needs more polish
- "Not fully a fan" of the mockup styling — use it as skeleton only

### Design principles to follow:
- **macOS native feel** — should feel like a native Mac app, not a web app
- **Minimallistically powerful** — maximum information with minimum visual noise
- **No emojis** — SVG icons only, stroke width 1.2-1.5px
- **One accent color** — violet (#8b5cf6), used sparingly (active indicator, send button, focus ring)
- **Text must be readable** — ensure WCAG AA contrast ratios. When in doubt, make text lighter.
- **Whisper borders** — borders at very low opacity, never heavy
- **8px spacing grid** — all spacing values on the grid
- **Inter + JetBrains Mono** — no other fonts
- **prefers-reduced-motion** — all animations must respect this

### Color guidance from `.wotann/DESIGN.md` (still canonical):
- Background: `#08080c`
- Text primary: `#fafafa` (MUST be readable)
- Text secondary: `#a1a1aa` (MUST be readable)
- Text muted: `#71717a` (should be readable on dark backgrounds)
- Accent: `#8b5cf6`
- Surfaces: white-alpha at 0.025 / 0.045 / 0.07

---

## Files to Modify

### Layout restructure:
- `components/layout/AppShell.tsx` — Remove 4-tab header, restructure for Chat|Editor pills + toggle buttons
- `components/layout/Header.tsx` — Replace space tabs with Chat|Editor pills + Terminal/Diff toggle icons
- `components/layout/Sidebar.tsx` — Replace with project groups, remove files/workers/findings sub-tabs
- `components/layout/StatusBar.tsx` — Keep as-is (already cleaned up)

### New components needed:
- `components/layout/TerminalPanel.tsx` — Bottom panel wrapper (toggle open/close, header, content)
- `components/layout/DiffPanel.tsx` — Right side panel wrapper (toggle open/close, header, content)
- `components/layout/WorkerDrawer.tsx` — Expanded worker details (replaces WorkshopView partially)

### Components to modify:
- `components/chat/MessageBubble.tsx` — Simplify tool call rendering to minimal dots
- `components/workshop/WorkshopView.tsx` — May be absorbed into WorkerDrawer
- `store/index.ts` — Add `terminalPanelOpen`, `diffPanelOpen` booleans; restructure view types

### Components to potentially remove:
- `components/layout/Breadcrumb.tsx` — Already unused
- Space sub-tab logic in Sidebar — Replace entirely with project groups

---

## Workshop Upgrade Notes

The worker pill at the sidebar bottom should:
1. Show a compact summary (dots + count + cost) by default
2. On click, expand into a drawer/overlay showing:
   - Each worker as a card: name, model tag, progress bar, duration, kill button
   - New task button
   - Cost summary
3. This drawer could slide up from the bottom or appear as a popover above the pill
4. When no workers are running, the pill shows "No workers" in dim text or disappears entirely

---

## Implementation Priority

1. Sidebar restructure (project groups, remove sub-tabs)
2. Header restructure (Chat|Editor pills, Terminal/Diff toggles)
3. Terminal as bottom panel
4. Diff as right panel
5. Tool call visual simplification
6. Worker pill + drawer
7. Visual polish pass (contrast, spacing, shadows)

---

## Reference Mockups

All mockups saved in `.superpowers/brainstorm/25804-1775688061/content/`:
- `interactive-v3.html` — Final interactive mockup (Chat, Editor, Terminal toggle, Diff toggle)
- `option-e-minimal-power.html` — Sidebar "minimal power" concept
- `project-1-and-3-full.html` — Project dropdown vs project groups comparison
- `final-redesign.html` — Earlier full redesign attempt
- `both-mockups.html` — Option A vs B comparison

## What NOT to do:
- Don't copy the mockup pixel-for-pixel — it's a reference
- Don't make text so dim it's unreadable
- Don't add emojis
- Don't use onMouseEnter/onMouseLeave for hover states
- Don't add back the 4-tab header
- Don't put files in the sidebar
