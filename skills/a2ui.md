---
name: a2ui
description: Build interactive UI panels, dashboards, and control surfaces that adapt to agent context and workflow state. Use when designing agent-driven user interfaces with state-aware components.
---

# A2UI — Adaptive Agent User Interface

Use when: building interactive UI panels, dashboards, or control surfaces that adapt
to the user's current context and workflow state.

## Concept
A2UI (Adaptive Agent UI) auto-generates UI components based on:
- Current agent state (mode, task, context pressure)
- Available actions (contextual command palette)
- Active channel (TUI vs WebChat vs voice)
- User's skill level (beginner gets more guidance, expert gets density)

## Components
1. **Context Panel** — Shows current context usage, active files, memory entries
2. **Action Bar** — Dynamic toolbar that shows relevant actions for current state
3. **Task Progress** — Real-time progress indicator for autonomous tasks
4. **Channel Status** — Connection health for all active channels
5. **Memory Browser** — Searchable, filterable view of all 8 memory layers
6. **Decision Log** — Timeline of agent decisions with rationale
7. **Cost Dashboard** — Real-time cost tracking per provider/model

## Rendering Modes
- **TUI (Ink)** — Terminal-based React components
- **WebChat** — HTML/CSS/JS served via local HTTP
- **Voice** — Audio descriptions of UI state changes
- **API** — JSON responses for programmatic access

## Adaptive Behavior
- In FOCUS mode: minimize UI to just target file + test results
- In AUTONOMOUS mode: maximize progress tracking + cost display
- In TEACH mode: add explanatory panels and learning resources
- In REVIEW mode: show diff viewer + severity indicators
