# 20 — Competitor screenshots and study URLs

Source: `wotann/docs/COMPETITOR_EXTRACTION_LANE4_UX.md` + `wotann/docs/COMPETITOR_EXTRACTION_LANE8_STRATEGIC.md` + `wotann/docs/UNKNOWN_UNKNOWNS.md`.

Claude Design should NOT clone any competitor pixel-for-pixel. This document tells Claude Design **what to study, which frame, which lesson** — then design something better.

For each competitor, three artifacts are required:
1. **URL**: direct link to the product or landing page,
2. **Specific UI frame to study**: which view, which state, which interaction,
3. **Lesson to extract**: what design insight WOTANN should port.

## Tier A — Apple Design Award (MATCH / BEAT on polish)

### Glass (glassapp.dev)

- **URL**: `https://glassapp.dev`
- **Study**: the top bar + tab chrome; the sidebar gutter; the floating inspector panel.
- **Frame**: Glass's homepage hero animation (tab switching) shows their HUD.
- **Lesson**: layered translucency with 2+ blur radii creating parallax depth; noise-grain 2% overlay; specular sheen sweep on hover.
- **Do NOT copy**: keyboard-shortcut density (Glass is 3/10 vs WOTANN 9/10 TUI — we stay).

### Superhuman

- **URL**: `https://superhuman.com`
- **Study**: the keyboard-shortcut cheatsheet (⌘⌃`), the "Done" state animation when archiving.
- **Frame**: their typography on the inbox — especially the 13px `sans` regular / 15px semibold hierarchy.
- **Lesson**: 4-stop purple→violet gradient on brand mark; motion as reward for keyboard shortcuts; micro-bounces calibrated to 180-240ms not 400ms.

### Linear

- **URL**: `https://linear.app`
- **Study**: the tab underline slide motion; the inline-modal Cmd+K palette; the context-meter radial dial.
- **Frame**: the Project view → switching between "Active issues" / "Backlog" / "Triage" tabs (the underline slides).
- **Lesson**: accent underline slide under tabs (`cubic-bezier(0.16, 1, 0.3, 1)`, 320ms); command palette as a ~38% viewport-down card (not full-screen); typography hierarchy using only 3 sizes on most views.

### Raycast

- **URL**: `https://raycast.com`
- **Study**: the launcher palette; the extension model; the category headers in results.
- **Frame**: Raycast's default launcher → type anything → observe "SUGGESTIONS / APPS / CALCULATIONS / WEB" grouping.
- **Lesson**: row-right keyboard hint (⌘N right-aligned on every row); MRU pinning (last 3 float to top); monospace for keyboard keys, sans for labels.

### Things 3

- **URL**: `https://culturedcode.com/things/`
- **Study**: the Today view; the checkmark motion; the date picker.
- **Frame**: tapping a checkbox on a task → 240ms scale + green flash → 160ms fade.
- **Lesson**: ruthlessly consistent 4/8 pt grid; inline date picker (not modal); celebration motion that's earned.

## Tier B — Agent / IDE peers (MATCH / BEAT)

### Cursor 3 (Apr 2 2026)

- **URL**: `https://cursor.com` (see `UNKNOWN_UNKNOWNS.md` discovery 3)
- **Study**: Canvases, Agents Window, Design Mode, cloud↔local handoff.
- **Frame**: Cursor's Agent output rendering a data explorer canvas — INTERACTIVE React components, not markdown.
- **Lesson**: WOTANN Workshop + Editor should render structured agent output as Canvases — PR reviews, eval dashboards, data explorers. The markdown era is over.
- **Port target**: `CanvasView.tsx` (exists on WOTANN desktop but unspecified).

### Gemini for Mac

- **URL**: `https://gemini.google.com/mac`
- **Study**: Liquid Glass HUD, ⌥Space global hotkey, blob-as-status.
- **Frame**: the macOS system bar on Gemini's hero screenshot.
- **Lesson**: blob HUD that pulses with activity but doesn't steal focus; ⌥Space as a universal summon hotkey.

### Claude Code TUI

- **URL**: `https://claude.com/claude-code`
- **Study**: `/help`, `/focus`, `/rollback`, `/compact` commands.
- **Frame**: Anthropic's docs for Claude Code + any YouTube demo video.
- **Lesson**: the slash command pattern; `/focus` as a 3-line collapse; `/rollback` with per-turn UI.
- **Do NOT copy**: 4/10 motion, 2/10 block-based — these are gaps in Claude Code.

### Warp

- **URL**: `https://warp.dev`
- **Study**: Blocks, Workflows, Drive notebooks, OSC 133 integration.
- **Frame**: Warp's landing page has a terminal recording showing Block boundaries.
- **Lesson**:
  - OSC 133 sequences (`\e]133;A/B/C/D`),
  - Block right-click contextual menu (Copy / Share / Rerun / Bookmark / Delete / AI-ize),
  - `.warp.md` notebook format (WOTANN = `.wotann.md`),
  - In-terminal env-var manager (prevents keys in shell history).

### Zed

- **URL**: `https://zed.dev`
- **Study**: ACP host, keyboard-first IDE, multi-buffer editor, tab choreography.
- **Frame**: Zed's agent integration demo + multibuffer screenshot.
- **Lesson**: ACP 0.3+ compatibility (WOTANN is on 0.2.0 — must upgrade); multibuffer as unified view across search hits + diagnostics + agent edits.

### Conductor.build

- **URL**: `https://conductor.build`
- **Study**: comment-on-diff, @terminal mention, context-meter radial dial.
- **Frame**: Conductor's agent workspace with a diff open and a hover-active context meter.
- **Lesson**:
  - @ live terminal output as typed mention,
  - Context-meter hover-reveal breakdown by category,
  - Reset-to-previous-turn via sidebar UI.
- **Composite score**: 7.2 / 10 (per `UI_UX_AUDIT.md` §1.2) — above WOTANN's 6.7.

### Perplexity Computer (Feb 25 2026)

- **URL**: `https://perplexity.ai/computer` (scrape via Chrome MCP; WebFetch returns 403)
- **Study**: 19-model orchestration, 400+ app connectors, cloud↔local Personal Computer bridge.
- **Frame**: Perplexity's product page + TechCrunch launch article.
- **Lesson**: Model Council as first-class "second opinion" button (WOTANN has `/council`); per-task-type routing (20 task classes).

## Tier C — niche lessons (LEARN)

### Arc (The Browser Company)

- **URL**: `https://arc.net` (product-shutdown notice may apply)
- **Study**: spatial / playful UX, space-color tinting.
- **Lesson**: each workspace/space can tint the chrome slightly — WOTANN adapt for multi-project users.

### Jean (coollabsio/jean)

- **URL**: `https://github.com/coollabsio/jean`
- **Study**: `codex_max_agent_threads` (1-8 clamp), per-worktree isolation.
- **Lesson**: expose `max-workers` as 1-8 tunable in `wotann.yaml`.

### OpenClaw

- **URL**: `https://github.com/BasedHardware/openclaw` (via `research/` directory)
- **Study**: `HEARTBEAT.md` proactive standing-orders file, 24-channel messaging, soul/identity system.
- **Lesson**: `.wotann/HEARTBEAT.md` as a user-authored cron file that the daemon iterates.

### Claude Design (Anthropic Labs, Apr 17 2026)

- **URL**: `https://claude.ai/design`
- **Study**: the handoff bundle format, prompt-to-prototype flow, Canva/PDF/PPTX/HTML export.
- **Frame**: Claude Design's hero screen + any YouTube demo.
- **Lesson**: design→code loop as a single `/handoff` command. This is what we're using Claude Design FOR.

## Specific sub-lessons (cross-competitor)

### Typography lesson

All Tier A (Glass, Superhuman, Linear, Raycast, Things 3) share:
- **Inter Variable** or **SF Pro Text** as body,
- **JetBrains Mono Variable** or **SF Mono** as mono,
- **Sizes 11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 / 32** — no unusual sizes,
- **Weights 400 / 500 / 600 only** — no 700 except display,
- **-0.011em tracking** on body, **-0.02em** on display.

WOTANN already has this right (`wotann-tokens.css:79-87`). Claude Design must preserve.

### Motion lesson

All Tier A share:
- **Four canonical eases** — productive, standard, pop, out-expo,
- **Durations clustered at 80/150/240/400/600** — not 300ms or 500ms,
- **Stagger ~18-24ms** for list entrance,
- **`prefers-reduced-motion: reduce` respected**.

### Glass lesson

Glass app = 10/10 glass. Conductor = 9/10. Key differentiators vs WOTANN's 6/10:
1. Per-theme glass tokens (WOTANN missing — see `UI_UX_AUDIT.md` §3.1 item G1),
2. Noise-grain overlay (WOTANN missing — item G4),
3. Specular sheen (WOTANN missing — item G5),
4. Layered translucency (WOTANN ships single-layer).

### Keyboard lesson

Raycast = 10/10. Claude Code TUI = 10/10. WOTANN TUI = 9/10, Desktop = 7/10. Target: desktop to 9/10 by:
- `?` cheatsheet overlay (20-minute fix),
- All primary actions reachable by keyboard (Cmd+3/4 already shipped),
- Inline keyboard hints in palette rows.

## Claude Design task

For each of the 3 surfaces (TUI / desktop / iOS), produce three variants. Each variant must explicitly cite:

- Which competitor pattern it borrows from,
- Which specific frame/view inspired the decision,
- What the difference is from the competitor (WOTANN is not a clone — it must innovate on the copied pattern).

Output example for desktop variant 1:

```
Variant 1 — "Linear-forward"
Inspired by:
  - Linear (tab underline slide)
  - Superhuman (keyboard cheatsheet)
  - Glass (layered translucency)

Differences:
  - Tab underline is gold (hearthgold) not blue (Linear's signature)
  - Keyboard hints shown inline in every palette row (like Raycast, Superhuman only shows them in Cmd+⌃`)
  - Glass uses per-theme tokens (Glass theme-agnostic)
```

Every variant in the handoff bundle needs this `competitor_inspirations` metadata in `manifest.json`.

---

*End of 20-competitor-screenshots.*
