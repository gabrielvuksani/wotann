# 17 — Copy and voice

Source: `02-brand-identity.md` + `04-design-principles.md` Principle 1 (Truth before beauty) + `wotann/CLAUDE.md`.

This file governs every word in the UI. If Claude Design writes copy that violates any rule below, the variant is rejected.

## The three pillars

### 1. Honest
### 2. Direct
### 3. Quiet

## Forbidden words / phrases

Claude Design must produce copy with **zero** occurrences of:

- "Sorry"
- "Oops"
- "Something"
- "We think"
- "Maybe"
- "Let me / I'll / I can help you..."
- "Our AI"
- "Awesome"
- "Great"
- "Amazing"
- "Fantastic"
- "Perfect"
- "!" (exclamation marks in any button, banner, or heading)
- "Please" (unless asking the user to take a specific irreversible action)
- "Experimental"
- "Beta" (unless the feature is genuinely pre-v1 — then use "in early testing")
- "This feature is coming soon"
- "Almost there"
- Any emoji in system UI (runes + alchemical sigils + custom SVGs are allowed)

## Required replacements

| Avoid | Use |
|---|---|
| "Sorry, something went wrong" | "Engine disconnected. [Reconnect]" — name what broke + next action |
| "Oops!" | (delete) |
| "Try again" | "Retry" (verb first) |
| "You'll need to..." | "Requires: [what]" |
| "Loading..." | "Reading memory" / "Streaming response" / specific action |
| "Successfully completed" | "Done" or "Sealed" |
| "Great job!" | (delete — celebrations are the Sealed Scroll, not a toast) |
| "Let me help you with that" | "I'll plan the migration." (direct, declarative) |
| "Our AI can..." | "Opus can..." / "WOTANN will..." |
| "Feature X is coming soon" | (delete feature from UI until it ships) |

## Register by surface

### TUI

Terse. Monospace. Full sentences rare. Abbreviations OK.

- `Engine offline · reconnect?`
- `$0.04/turn · 40% ctx`
- `12 results · Tab to cycle`

### Desktop

Conversational but disciplined. Verbs first. Nouns after.

- "Start coding" not "Start coding tasks"
- "Reconnect" not "Click to reconnect"
- "Sealed" not "Task completed successfully"

### iOS

Warmer for first-time users. Experienced users still get direct.

- Onboarding: "Link your Mac so WOTANN can run full tools" ✓
- Settings: "Add provider" ✓
- Error: "Mac disconnected — chat still works offline" ✓

## Copy for specific components

### Welcome screen (desktop + iOS)

- **Heading**: "What would you like to build?"
- **Subtitle (current drift)**: "Multi-provider AI with autonomous agents, desktop control, and full tool use." — **REGRESSION — restore the end clause: "— all running locally on your machine."**
- **Target subtitle**: "Multi-provider AI with autonomous agents, desktop control, and full tool use — all running locally on your machine."

### Onboarding steps

| Step | Label |
|---|---|
| 1 | Welcome |
| 2 | System |
| 3 | Engine |
| 4 | Providers |
| 5 | Ready |

- Step 1 subtitle: "The All-Father of AI Agent Harnesses." ✓
- Step 1 body: "One app, every AI provider. Chat, build code, control your desktop, and run autonomous agents — all locally on your machine."
- Step 2 body: "WOTANN needs a few things to run. We'll check and install them for you."
- Step 3 body: "The WOTANN Engine runs as a background service, connecting to all your AI providers."
- Step 4 body: "Enter at least one API key. Ollama is free and runs locally."
- Step 5 body: "You're all set. You can add API keys anytime in Settings → Providers."

### Engine disconnected banner

**Current**: Red, "Engine disconnected" + Reconnect.

**Target** (per TD-1.1):
- Colour: amber
- Copy: "Background engine paused — chat still works with cloud providers."
- Primary action: "Reconnect"
- Secondary action: "Run diagnostics"

### Cost display

- Default (free): `$0.00 (Ollama local)`
- Paid: `$0.04 today · $0.18 this session`
- Approaching budget: `$1.90 of $2.00 budget today`
- Over budget: `Over daily budget — [Raise ceiling] [Switch to local]`

### Provider chip

Format: `[ <model> ◈ <context> ]`

- `[ Opus ◈ 1M ]` — premium, gold stroke
- `[ Gemma 4 ◈ 128K ]` — local, moss stroke
- `[ GPT-5 ◈ 2M ]` — paid, blue stroke

Context abbreviations: `200K`, `1M`, `2M` (no decimals for round numbers).

### Quick-action tiles (default `coding` preset)

| Tile | Subtext |
|---|---|
| Start coding | Open the code editor |
| Run tests | Run project tests |
| Review code | Open diff view |
| Research | Deep research a topic |
| Compare models | Side-by-side comparison |
| Check costs | View spending |

No exclamation marks. Verbs. Concrete actions.

### Command palette (desktop)

- **Placeholder**: `Search commands, views, modes...` ✓
- **Section headings** (ALL-CAPS): `SESSION` / `NAVIGATION` / `PROVIDERS` / `MEMORY` / `SKILLS` / `EXPLOIT` / `COUNCIL` / ...
- **Row format**: `<verb> / <subtext> <shortcut-right-aligned>`
- **Example**: `New Chat / Start a new conversation · ⌘N`
- **Footer**: `esc close · Tab cycle`

### Model picker

- **Placeholder**: `Search models...` ✓
- **Empty state**: `No models match ""` ✓
- **Row format**: `<model> · <context> · <cost-per-1M-in> / <cost-per-1M-out>`
- **Example**: `opus-4.7 · 1M · $15/$75`
- **Group headings**: `ANTHROPIC`, `OPENAI`, `GOOGLE`, `GROQ`, `OLLAMA`, `OPENROUTER` (alphabetical — no vendor bias; Principle 12).

### Error messages (inline)

Rule: **name + action**.

- "Anthropic rate limited. Next attempt in 24s. [Retry now] [Switch provider]"
- "File too large (312MB). Max: 256MB. [Send anyway] [Compress]"
- "OAuth token expired. [Re-authenticate] [Use API key]"
- "Socket timeout. Daemon may be starting. [Wait] [Restart engine]"

### Permission prompt

- **Risk badge**: `SAFE` / `CAUTION` / `DESTRUCTIVE`
- **Tool description**: "Read file `src/auth/middleware.ts`" — name the target.
- **Options**: `Approve once` / `Approve always for this session` / `Deny` / `View context`

### Empty state CTAs

| View | Empty copy |
|---|---|
| Chat sidebar | "No conversations yet. [Start a new chat]" |
| Exploit findings | "No findings yet. Start an engagement to begin security research. [Set scope]" |
| Dispatch inbox | "No tasks yet. Tasks from Slack, GitHub, Telegram, and other channels appear here." |
| Memory inspector | "No memory yet. WOTANN saves decisions, bug fixes, and discoveries as you work." |
| Settings > Linked Devices | "No paired devices. [Scan QR] [Scan network]" |
| Skills browser | "No skills loaded. 86 built-in skills are available. [Browse]" |

### Success states

- Short: "Sealed" (for proof bundles)
- Medium: "Done — sealed with 4 proofs. [Open scroll]"
- Never: "Success!" or "Completed!"

### Celebration (rare, earned)

Only in 3 cases:
- First task completed (first Sealed Scroll ever),
- First API key added ("Hearthgold unlocked. Opus available. Local models still preferred when sufficient."),
- Major version upgrade.

## Voice style guide

### Never:
- Talk down to the user ("You might want to...")
- Celebrate routine actions ("You opened a file!")
- Ask rhetorical questions in UI ("Need help?" — if so, make it a button, not a question)
- Use weasel words ("perhaps", "kind of", "sort of")

### Always:
- Name what the thing is ("Engine" not "background service" — unless first-time user)
- Name what will happen next ("Retry" not "Please try again in a few moments")
- Honor the user's time (no "welcome back" on re-open)

## Microcopy examples — correct vs incorrect

✗ "Great! Your engine is now running!"
✓ "Engine running."

✗ "Oops! We couldn't find that."
✓ "No match."

✗ "Hit enter to submit your amazing query."
✓ "Enter to send."

✗ "Please wait while we fetch your data..."
✓ "Reading memory..."

✗ "You're all set and ready to go!"
✓ "Ready. [Start Using WOTANN →]"

## Internationalization

Current: English only. Future: 9 languages (zh, ja, ko, es, fr, de, ar, he, pt). Claude Design should:

- Design for **~2× text length** (German) and **~0.5× text length** (Chinese),
- Avoid idioms ("it's raining cats and dogs"),
- Use runes and sigils over translatable labels where visual meaning is universal,
- Avoid leading articles ("the", "a") that don't translate.

## What Claude Design should deliver

1. **A copy audit** of all existing UI strings — flag violations of the forbidden-words list.
2. **Copy-deck** for every new component Claude Design adds.
3. **Voice guide** reinforcing / extending this file (not replacing it).
4. **Translation-friendliness report** — flag strings that will be hard to localize.

---

*End of 17-copy-and-voice.*
