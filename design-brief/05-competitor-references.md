# 05 — Competitor references: what to match, beat, learn from

Source: `wotann/docs/COMPETITOR_EXTRACTION_LANE4_UX.md` + `wotann/docs/COMPETITOR_EXTRACTION_LANE8_STRATEGIC.md` + `wotann/docs/UNKNOWN_UNKNOWNS.md` + `wotann/docs/UI_UX_AUDIT.md` §1.2 competitor table.

Every competitor has a verdict — **MATCH** (reach parity), **BEAT** (exceed), or **LEARN** (absorb one specific pattern). Each has a study focus.

## Tier A — Apple Design Award tier (BEAT on motion; MATCH on polish)

### Glass (glassapp.dev) — Zed fork with Liquid Glass

- **What to study**: the Liquid Glass HUD, layered translucency (2+ blur radii for depth parallax), noise-grain overlay (2% SVG noise), specular sheen on hover.
- **Verdict**: MATCH on glass fidelity. WOTANN is 6/10 glass today; Glass is 10/10.
- **URL**: `https://glassapp.dev`.
- **Specific ports**:
  - Layered translucency (two+ `backdrop-filter` layers with different blur radii),
  - Noise-grain: `class="bg-glass-grain"` = 2% SVG noise overlay,
  - Specular sheen hover: gold 20% opacity, 380ms sweep,
  - Dynamic tint sampling: `saturate(1.5+)` + `contrast()`.

### Superhuman — email, but the polish bar for craft

- **What to study**: typography hierarchy, micro-interactions, keyboard density, motion as reward.
- **Verdict**: MATCH on typography + motion craft.
- **URL**: `https://superhuman.com`.
- **Specific ports**:
  - 4-stop gradient on brand mark (purple-to-violet with inner glow),
  - "Done" state motion — the small lift + accent flash when an item is archived,
  - Keyboard shortcut surfacing in every menu row.

### Linear — project management, but the typography + motion bar

- **What to study**: typographic hierarchy, tab-to-tab underline slide motion, context-meter radial dial.
- **Verdict**: MATCH on typography + BEAT on keyboard (Linear is 9/10, WOTANN TUI is 9/10 — tie; desktop should catch up).
- **URL**: `https://linear.app`.
- **Specific ports**:
  - Active tab: accent underline slides between tabs (380ms, ease-out-expo),
  - Inline modal: command palette as ~38% viewport-down card, not full-screen,
  - Icon-label pairing: 16px icon + 13px label, 8px gap.

### Raycast — macOS launcher, the command-palette gold standard

- **What to study**: palette density, MRU ordering, icon ergonomics, extension model.
- **Verdict**: MATCH on palette. WOTANN's desktop palette has 137 entries with category headers — good. Missing: MRU reorder, inline keyboard-binding display on each row.
- **URL**: `https://raycast.com`.
- **Specific ports**:
  - Row-right keyboard hint: `⌘N` at every row that has a dedicated shortcut,
  - MRU pinning: last 3 commands float to top of palette,
  - Category grouping: `SESSION / NAVIGATION / MEMORY / SKILLS / …` headers.

### Things 3 — task manager, Apple Design Award 2017+2018+2019+2020

- **What to study**: colour / spacing / type perfection; the "Today" view; celebration motion.
- **Verdict**: MATCH on spacing + color palette craft.
- **URL**: `https://culturedcode.com/things/`.
- **Specific ports**:
  - 4-pt / 8-pt grid used ruthlessly,
  - Date-picker as inline calendar (not modal),
  - Checkmark motion: tap → 240ms scale + green flash → 160ms fade.

### Cursor 3 — Agent-first IDE (launched Apr 2 2026) — BEAT on agent UX

- **What to study**: Canvases (React-rendered interactive agent output), Agents Window, Design Mode, cloud↔local handoff.
- **Verdict**: BEAT. WOTANN's Workshop tab should render Canvases for structured agent output — charts, PR reviews, eval dashboards. Cursor is ahead today; our plan closes the gap.
- **URL**: `https://cursor.com` (see `UNKNOWN_UNKNOWNS.md` discovery 3).
- **Specific ports**:
  - Canvases — agent output as interactive React components, not markdown,
  - Agents Window — primary surface becomes the agent, not the editor,
  - Inline PR review canvas.

## Tier B — Agent harness peers (BEAT)

### Gemini for Mac (April 2026) — Liquid Glass HUD + ⌥Space hotkey

- **What to study**: the blob-as-status HUD, the ⌥Space global hotkey, floating-pill aesthetics.
- **Verdict**: BEAT. The Gemini blob HUD is pretty but shallow. WOTANN's StatusRibbon + FloatingAsk on iOS + Runering on desktop should deliver the same "always present, never in the way" feel with deeper interaction.
- **URL**: `https://gemini.google.com/mac` (see `COMPETITOR_EXTRACTION_LANE4_UX.md`).
- **Specific ports**:
  - ⌥Space global hotkey — summons Ask from anywhere,
  - Blob-as-status — a pulsing glyph that hints at activity without stealing focus,
  - Minimalist first-launch — no form, just a prompt.

### Claude Code — SWE-bench king (BEAT on harness UX)

- **What to study**: the `/help` command, `/focus` view, `/rollback` semantics, slash-command pattern.
- **Verdict**: BEAT. Claude Code's TUI is a benchmark but has 0 block-based rendering and 5/10 motion. WOTANN can match the density and beat on craft.
- **URL**: `https://claude.com/claude-code`.
- **Specific ports**:
  - `/focus` — 3-line collapse: last-prompt / 1-line tool summary / final response,
  - Credential pool + rate guard (from Hermes-adjacent),
  - PreCompact hook support (v2.1.105) — hooks can block compaction.

### Warp — OSC 133 block terminal (MATCH)

- **What to study**: OSC 133 semantic prompt markers, Block UI, Workflows, Drive notebooks.
- **Verdict**: MATCH. WOTANN has `Block.tsx` built; must adopt OSC 133 shell init snippets.
- **URL**: `https://warp.dev`.
- **Specific ports**:
  - OSC 133 sequences: `\e]133;A` (prompt start), `\e]133;C` (command start), `\e]133;D` (output end),
  - Block right-click contextual menu: Copy / Share / Rerun / Bookmark / Delete / AI-ize,
  - `.wotann.md` notebook format (Warp Drive equivalent),
  - In-TUI env-var manager (prevents keys leaking via history).

### Zed — ACP host (MATCH)

- **What to study**: the Agent Client Protocol (ACP), keyboard-first IDE, multi-buffer editor, tab choreography.
- **Verdict**: MATCH. WOTANN already ships ACP stdio via `wotann acp --stdio`; must upgrade from 0.2.0 to 0.3+ for current Zed.
- **URL**: `https://zed.dev`.
- **Specific ports**:
  - ACP version compatibility 0.3+,
  - Multibuffer — single editable view across search hits / diagnostics / agent edits,
  - Theme Builder webapp (2,200 LOC ambition) — live preview + inspector + color-linking.

### Conductor.build — git-worktree-per-agent (LEARN)

- **What to study**: comment-on-diff, @terminal mention, context-meter radial dial.
- **Verdict**: LEARN. Conductor's glass fidelity is 9/10 — study their layered glass, study their @ mention composer.
- **URL**: `https://conductor.build` (see `COMPETITOR_EXTRACTION_LANE8_STRATEGIC.md`).
- **Specific ports**:
  - @ mention live terminal output as typed mention in composer,
  - Context-meter radial dial — hover-reveal breakdown by category,
  - Reset-to-previous-turn (`/undo-turn`) — sidebar UI + slash command.

### Perplexity Computer (Feb 25 2026) — 19-model orchestration (BEAT)

- **What to study**: model routing, 400+ app connectors, Personal Computer (cloud↔local bridge), Model Council.
- **Verdict**: BEAT. WOTANN has 19 providers and Council mode as first-class UI; Perplexity has polish.
- **URL**: `https://perplexity.ai/computer`.
- **Specific ports**:
  - Per-task-type routing YAML (`.wotann/routing.yaml`) with 20 task classes,
  - Model Council as first-class "second opinion" button (already in WOTANN via `/council`).

## Tier C — niche but stealable (LEARN)

### Warp's WarpTerm for iOS / Raycast iOS

- **What to study**: typographic monospace on mobile, command density on touch.
- **Specific ports**: how they mount a monospace font at mobile sizes without losing legibility.

### Arc (The Browser Company) — before shutdown

- **What to study**: spatial / playful UX, command palette with typing, color-coded spaces.
- **Specific ports**: space-color tinting (each workspace gets a palette).

### Jean (coollabsio/jean) — multi-CLI desktop

- **What to study**: `codex_max_agent_threads` (1-8), worktree-per-chat isolation.
- **Specific ports**: max-worker tunable via `wotann.yaml` (current default 3, target ceiling 8).

## Competitor scorecard snapshot

From `wotann/docs/UI_UX_AUDIT.md` §1.2:

| Bar | WOTANN | Glass | Superhuman | Linear | Raycast | Things 3 | Cursor 3 | Claude Code TUI | Conductor |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Typography | 7 | 9 | 9 | 9 | 9 | 10 | 8 | 7 | 7 |
| Spacing | 7 | 8 | 9 | 9 | 9 | 10 | 7 | 6 | 8 |
| Color | 7 | 9 | 8 | 8 | 8 | 9 | 7 | 6 | 8 |
| Motion | 7 | 9 | 9 | 8 | 8 | 9 | 6 | 4 | 8 |
| Loading | 7 | 9 | 9 | 8 | 8 | 9 | 7 | 4 | 7 |
| Empty | 7 | 8 | 9 | 9 | 7 | 9 | 6 | 4 | 7 |
| Error | 7 | 8 | 8 | 9 | 7 | 8 | 6 | 6 | 7 |
| Glass/depth | 6 | 10 | 5 | 5 | 6 | 6 | 4 | n/a | 9 |
| Block-based | 0 | n/a | n/a | n/a | n/a | n/a | 3 | 2 | 0 |
| Keyboard | 9 | 3 | 8 | 9 | 10 | 7 | 7 | 10 | 5 |
| **Composite** | **6.7** | **7.7** | **8.2** | **8.1** | **7.8** | **8.5** | **6.3** | **5.5** | **7.2** |

Reading: WOTANN ties Zed; beats Cursor 3 / Claude Code TUI / Codex; trails Apple-ADA tier by 1.0-1.5 points.

## How Claude Design should use this

For each of the three surfaces (TUI / desktop / iOS), pick three competitors to steal from explicitly:

- **TUI**: Raycast (palette), Claude Code (slash), Warp (Blocks).
- **Desktop**: Linear (motion), Glass (fidelity), Superhuman (type).
- **iOS**: Things 3 (color), Superhuman (rhythm), Gemini (HUD).

Every variant Claude Design produces must explicitly call out which competitor pattern it borrows from and why. In the handoff bundle's `manifest.json`, include a `competitor_inspirations` array — one entry per variant per surface.

---

*End of 05-competitor-references.*
