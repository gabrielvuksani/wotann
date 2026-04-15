---
name: canvas-mode
description: Real-time collaborative editing with split-screen working copy, original reference, and chat. Use when the user wants to co-edit code or documents with live diff visibility.
---

# Canvas Mode — Real-Time Collaborative Editing

Use when: the user wants to collaboratively edit a document or code file with
real-time visibility of changes, similar to Google Docs or Cursor's Canvas.

## Concept
Canvas mode creates a split-screen view where:
- LEFT: The agent's working copy (editable, with diff highlights)
- RIGHT: The user's original (read-only reference)
- BOTTOM: Chat for discussing changes

## Features
1. **Inline Edit Proposals** — Agent proposes changes inline with green/red highlighting
2. **Accept/Reject per Hunk** — User can accept or reject individual change hunks
3. **Real-Time Preview** — For HTML/CSS/React: live preview in browser
4. **Undo Stack** — Granular undo per change hunk, not per edit session
5. **Voice Narration** — Agent explains each change via TTS as it makes them

## Activation
- `/canvas <file>` — Open canvas mode for a specific file
- Auto-activates when editing a file and user says "show me the changes"

## Protocol
1. Load the target file into the canvas view
2. Agent proposes changes one hunk at a time
3. Each hunk is displayed as a unified diff
4. User can: Accept (✓), Reject (✗), Modify (✎), or Skip (→)
5. Accepted hunks are applied immediately
6. After all hunks: run verification (tests, typecheck)
7. On verification failure: highlight the problematic hunk

## Integration Points
- TUI: Ink-based split pane with diff coloring
- WebChat: Monaco editor with inline diff decorations
- Voice: Narrate diff hunks, accept by saying "yes/no/skip"
