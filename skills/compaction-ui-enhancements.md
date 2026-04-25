---
name: compaction-ui-enhancements
description: Improvements to /compact UX — token bar, save-WAL prompt, recap-on-resume.
type: cognitive-framework
source: openclaw
---

# Compaction UI Enhancements — Better /compact UX

Compaction is the most context-disrupting operation an agent performs.
Done badly, the user loses confidence and the next session feels broken.
This skill encodes the THREE UX improvements that turn compaction from a
disruptive event into a smooth handoff.

The three improvements: a visible token bar, a WAL-save prompt before
compaction, and a recap on resume.

## When to invoke

- The user is approaching the compaction threshold (60%, 75%, 90%)
- The user invokes `/compact` manually
- The auto-compact threshold fires (system-initiated compaction)
- A new session resumes after a previous compaction
- The agent detects context-budget pressure proactively

## The Three Improvements

```
1. TOKEN BAR          — always-visible context-budget gauge
2. WAL-SAVE PROMPT    — save critical state BEFORE compaction begins
3. RECAP-ON-RESUME    — summarize the lost context on the post-compact session
```

## Process

### Improvement 1 — Token Bar

A persistent in-TUI gauge that shows context usage with thresholds:

```
[████████░░░░░░░░░░] 41% / 200K tokens   normal
[██████████████░░░░] 73% / 200K tokens   warning — consider compaction
[██████████████████] 92% / 200K tokens   CRITICAL — auto-compact imminent
```

Color and severity escalate at:
- 60% — green → amber transition
- 75% — amber, "consider compaction" hint
- 90% — red, "auto-compact will fire soon" warning

The bar is always present in the TUI footer (or HUD overlay). The user
never has to ask "where am I in the context budget?".

### Improvement 2 — WAL-Save Prompt

Before any compaction (manual OR auto), the agent runs the WAL protocol:

1. Identify critical state that has not been saved
2. Display the user a brief checklist:
   ```
   About to compact. WAL-save these items?
     [x] Active task: "implement /humanizer end-to-end"
     [x] Open file: src/humanize/index.ts (12 unsaved lines)
     [x] Decision: chose Bun over Node for the runtime
     [ ] Conversation summary (last 30 minutes)
   ```
3. Default ALL to checked. User can uncheck items they don't need.
4. Save checked items to memory + disk via the WAL protocol
5. Proceed with compaction

For AUTO-compaction (no user in loop), the agent runs WAL-save unattended
with all defaults checked. WAL is mandatory in autonomy mode.

### Improvement 3 — Recap-on-Resume

The first message after compaction is a structured recap:

```
## Resumed from compaction at 2026-04-25 14:32

**Active task**: implement /humanizer end-to-end

**Recent work** (last 30 minutes before compaction):
- Wrote handler for /humanizer at src/magic/handlers/humanizer.ts
- Added 4 test cases at tests/magic/humanizer.test.ts
- Discovered: prompt phrasing matters — "remove em-dashes" caused over-correction; switched to "neutralize stylistic AI tells"

**Saved to memory**:
- decisions/humanizer-prompt-shape (topic_key)
- cases/humanizer-overcorrection (topic_key)

**Next step**: run vitest, fix any failures, integrate into CLI command-resolver.

Type 'continue' to resume, or 'restart' to start over.
```

The recap is generated from WAL-saved state — not from compacted context.
This means it survives compaction with high fidelity.

## Configuration

```yaml
compaction:
  ui:
    token_bar: { visible: true, position: "footer" }
    wal_prompt:
      auto_check_all: true
      timeout_ms: 5000          # auto-proceed if user idle in autopilot
    recap_on_resume:
      include_decisions: true
      include_open_files: true
      include_next_step: true
  thresholds:
    warning: 0.60
    critical: 0.85
    auto_compact: 0.95
```

## Examples

### Example — manual compaction with WAL prompt

User types `/compact`. The TUI shows:

```
About to compact. WAL-save these items?
  [x] Active task: "fix the build error in providers/router.ts"
  [x] 3 unsaved decisions
  [x] Last 12 minutes of conversation
Continue? [Y/n]
```

User presses Enter. The agent:
1. Saves the 3 decisions via `mem_save` with appropriate topic_keys
2. Writes the conversation chunk via `mem_session_summary`
3. Records the active task to disk for the recap
4. Then runs the actual compaction

After compaction, the next message is the structured recap (Improvement 3).

### Example — auto-compaction in autopilot mode

Token usage hits 95%. Auto-compact fires.

The agent runs the WAL protocol unattended (no user prompt) with all
defaults. After compaction, the next agent loop sees the recap and
continues from where the previous loop left off — with no human in the
loop.

## Anti-patterns

- Hiding the token bar to "not bother the user" — uncertainty about budget is worse than knowledge
- Skipping WAL save in auto-compact ("the user isn't watching") — exactly when they need it MOST
- Generating the recap from the post-compact (lossy) context — use WAL-saved state instead
- Rendering the WAL prompt mid-action without a clear "this is happening because..." preface
- Letting the auto-compact threshold fire silently — the user must always know it happened

## Stopping criteria

- Token bar is visible
- WAL save runs before every compaction (manual or auto)
- Recap appears as the first message of the resumed session
- Recap is high-fidelity (built from saved state, not from lossy context)

## Provenance

OpenClaw's compaction-ui-enhancements skill. Pairs with WOTANN's
context-engine and elite-longterm-memory skills. The token-bar threshold
values are tuned for Claude Sonnet 4.6 at 200K tokens.
