# 18 — Data visualization

Source: `wotann/src/ui/components/ContextHUD.tsx` + `wotann/desktop-app/src/components/layout/StatusBar.tsx` + `wotann/src/telemetry/*.ts` + `wotann/desktop-app/src/components/intelligence/*.tsx`.

WOTANN has four kinds of data to visualize: **cost**, **context window**, **provider status**, and **memory**. Each has a canonical component. This file defines the target design for each.

## 1. Cost meter

### TUI — inline in StatusBar + ContextHUD

- Session: `$0.04`
- Per-turn live: `ᚠ $0.02/turn` (updates every 250ms during streaming)
- Today: `$0.18 today`
- All values use **tabular numerals** (`font-variant-numeric: tabular-nums`).

### Desktop — bottom-right corner of StatusBar

Layout:
```
[ Session: $0.04 ] [ Today: $0.18 ] [ ᚠ 0.02/turn live ]
```

On hover → tooltip shows:
- Per-provider breakdown (Anthropic $0.08 / OpenAI $0.04 / Ollama $0.00),
- Token count (12.4K in / 3.8K out),
- Budget (if set): `Today $0.18 of $2.00`.

On click → opens CostDashboard.

### Desktop — CostDashboard (2 tabs today → keep 2 but rename per TD-9.3)

- Tab 1: **Today** — 24h bar chart (hourly), per-provider stacked.
- Tab 2: **Providers** — ArbitrageDashboard cost matrix (which provider best for which task type).

**Target design**: 300px-wide chart with:
- X-axis: hour of day,
- Y-axis: cost (linear, log toggle for outliers),
- Colors: one shade per provider (Anthropic purple, OpenAI green, Google blue, Groq orange, Ollama moss),
- Tooltip on hover: exact value + provider + task description.

### iOS — CostWidget (home screen)

Small widget (2×2):
```
┌─────────┐
│  $0.18  │
│  today  │
│         │
│  ▆▇▆▃▂  │  ← 7-day sparkline
└─────────┘
```

Medium widget (4×2):
```
┌──────────────────────────────┐
│  Today $0.18    Budget $2.00 │
│  ▆▇▆▃▂                        │
│                              │
│  Opus $0.14 · Gemma $0.00    │
└──────────────────────────────┘
```

## 2. Context window meter

### TUI — ContextHUD.tsx (existing, 98 LOC)

Current: text-only `0.0K / 200K · 40%`.

**Target**: 10-cell horizontal meter + text:

```
████░░░░░░ 40% ctx (82K/200K)
```

Zones:
- **Moss (green)**: <50% (<100K of 200K)
- **Gold**: 50-80% (100-160K)
- **Blood (red)**: >80% (>160K)

Pulsing red glow when >95% — compaction imminent.

### Desktop — inline in StatusBar

Same 10-cell meter, 120px wide.

On hover → ContextSourcePanel overlays showing breakdown:
- System prompt (4K)
- Loaded skills (8K)
- Message history (42K)
- Attached files (18K)
- Memory snippets (10K)
- **Total** (82K / 200K — 40%)

### Radial dial alternative (per Conductor.build)

From `COMPETITOR_EXTRACTION_LANE8_STRATEGIC.md` P9 item 12:
- 48px circle with stroked arc,
- Arc fills proportionally to context usage,
- Arc color matches zone (moss / gold / blood),
- Click to open full breakdown.

Claude Design: deliver both linear + radial variants; Gabriel picks.

## 3. Provider status

### Provider chip (every assistant message)

From `CapabilityChips.tsx` (exists, not consumed).

Canonical format:

```
[ Opus ◈ 1M ]  [ 🜂 vision ]  [ 🜃 thinking ]  [ 🜄 tools ]  [ $0.04 ]  [ ⚒ 7a3f2 ]
```

- `[ Opus ◈ 1M ]` — provider + model + context window. Gold stroke for paid, moss for local.
- `[ 🜂 vision ]` — augmentation chips using alchemical sigils: 🜂 fire = vision, 🜃 earth = thinking, 🜄 air = tools, 🜁 water = memory.
- `[ $0.04 ]` — cost chip in hearthgold (or `$0 (Ollama)` in moss).
- `[ ⚒ 7a3f2 ]` — shadow-git SHA (truncated 5 chars) with scrubber affordance.

All 5-6 chips in a single horizontal strip at the top of every assistant Block.

### Settings > Providers — provider card grid

From `ProviderConfig.tsx`.

Per provider:
- **Status dot** (top-left): Connected (moss) / Disconnected (blood) / Not configured (muted).
- **Provider logo** (16px SVG).
- **Provider name** (16px semibold).
- **Model count** ("19 models available").
- **Today's cost** ("$0.04").
- **Configure** button (opens OAuth or API key form).
- **Test** button (sends a hello roundtrip).

Grid: 3 columns at 1200px+, 2 at 900px, 1 at 600px.

### Provider arbitrage display

From `ArbitrageDashboard.tsx`.

Table with rows = task types (code-write, code-review, long-context, fast-draft, vision) and columns = providers. Each cell shows relative cost + quality score.

**Target design**: heatmap. Cell color = value. Hover reveals exact numbers.

## 4. Memory palace

### TUI — MemoryInspector.tsx

Current: searchable list.

**Target**: filter chips at top, list below:

```
┌──── Memory ─────────────────────────────────────────────────────┐
│  [ All ] [ case ] [ pattern ] [ decision ] [ feedback ] [ proj ] │
│                                                                   │
│  ᚨ 14:23  case / hooks                                           │
│     EPIPE from hooks: pre-compact.js called process.exit(0)...   │
│                                                                   │
│  ᚲ 13:08  pattern / memory                                       │
│     When saving: use mem_save with topic_key matching domain.    │
│                                                                   │
│  ᚱ 12:45  decision / architecture                                │
│     Chose SQLite FTS5 over Pinecone for memory — zero-config.    │
└──────────────────────────────────────────────────────────────────┘
```

- `ᚨ` Ansuz for decisions,
- `ᚲ` Kenaz for discoveries,
- `ᚱ` Raidho for patterns,
- `ᛏ` Tiwaz for proofs,
- `ᛒ` Berkano for new / growth.

### Desktop — MemoryInspector sidebar

Same content, sidebar presentation. Plus:
- Chart at top: memory growth over time (line chart, 30 days),
- Tag cloud of most-frequent topic_keys,
- "Dream now" button (triggers `runtime.getCrossSessionLearner().dream()`).

### iOS — MemoryBrowserView

Same content, mobile-adapted.

Filter chips as scrollable horizontal strip.

List rows with:
- Type icon (rune) leading,
- Timestamp + topic_key,
- Preview text (2 lines, truncated),
- Swipe actions: Edit / Archive / Delete.

## 5. Agent fleet

### AgentFleetDashboard.tsx (desktop)

Grid of running agents. Each card:
- Agent type (coder / researcher / reviewer / auditor),
- Current task (1-line title),
- Model (chip),
- Elapsed time,
- Status (running / waiting-on-approval / error / done),
- Cost-so-far chip,
- Stop button.

**Target design**: 3 columns, sorted by status (running first, waiting next, errored at top of errored, done at bottom).

### iOS — AgentsView

Vertical scroll list with same fields. Watch mirrors a condensed version.

## 6. Workflow DAG

### Desktop — WorkflowBuilder (exists)

DAG nodes + edges for multi-step workflows. Each node:
- Label (1 line),
- Agent / skill used,
- Inputs / outputs,
- Status indicator.

**Target**: `dag-layout.ts` uses dagre or similar. Auto-layout with manual override. Zoom / pan. Minimap.

## 7. Heat indicators

Runtime intelligence dashboards (`IntelligenceDashboard.tsx`):

- **HealthGauge**: semicircle gauge 0-100 of "system health".
- **PWRStepper**: Plan → Work → Review cycle visualizer.
- **AccuracyTrend**: 7-day trend of accuracy-boost metric.

All use the same visual language: moss / gold / blood zone coloring.

## 8. Liquid Glass as a visualization substrate

Glass surfaces carry one affordance the competition lacks: **tinted translucency** shows what's beneath.

Example:
- Settings modal over ChatView → user sees a blurred echo of their conversation.
- CommandPalette over Editor → user sees blurred code.

This is not just decoration — it anchors the user spatially. "I'm in Settings, but Chat is still behind me."

Claude Design: preserve this behaviour. Never use opaque modals except for genuinely full-screen transitions (OnboardingView).

## What Claude Design should deliver

For each of the 8 visualization types above:
1. **Wireframe** (pixel-approximate layout, all states),
2. **Component spec** (props, variants, interactions),
3. **Data contract** (what API / RPC feeds it — cross-reference to `desktop-app/src-tauri/src/commands.rs`),
4. **Accessibility notes** (VoiceOver reading, keyboard nav, color alternatives for colorblind).

---

*End of 18-data-visualization.*
