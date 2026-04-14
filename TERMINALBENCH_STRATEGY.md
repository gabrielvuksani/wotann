# WOTANN TerminalBench Optimization Strategy
## How to Make Any Model Score Higher Through Harness Engineering

### Executive Summary

Based on extensive research (arxiv 2603.05344, LangChain blog, Cursor architecture, 
SWE-bench Pro analysis), the agent harness contributes 15-30% of benchmark performance 
independently of the model. Here's how WOTANN implements every known technique.

---

## 1. PROVEN TECHNIQUES (Implemented in WOTANN)

### 1.1 Reasoning Sandwich (src/middleware/reasoning-sandwich.ts)
**Impact**: +5-8% on complex tasks
**How**: Asymmetric thinking budget allocation:
- Planning phase: HIGH reasoning (10K thinking tokens)
- Execution phase: MODERATE reasoning (2K tokens)
- Verification phase: HIGH reasoning (10K tokens)
- The "xhigh-high-xhigh" pattern from LangChain's research

**WOTANN Implementation**: `ReasoningSandwich` detects the current phase 
(planning/execution/verification) and adjusts the thinking token budget 
automatically. For non-thinking models, it injects "think step by step" 
prompts proportional to the phase.

### 1.2 Pre-Completion Checklist (src/hooks/benchmark-engineering.ts)
**Impact**: +5-8% on LangChain's Terminal Bench improvement
**How**: Before the agent claims "done", automatically verify:
- Were types checked after code changes?
- Were tests run?
- Are there TODO/FIXME markers in the output?
- Are there stub implementations?

**WOTANN Implementation**: `preCompletionChecklist()` hook fires on Stop events.
If verification hasn't been run, it injects a reminder to verify first.

### 1.3 Per-File Edit Tracking (src/hooks/benchmark-engineering.ts)
**Impact**: Prevents doom loops (saves 3-5 wasted cycles per session)
**How**: Track how many times each file is edited. If a file hits 4 edits,
warn the agent to try a different approach. At 8 edits, block and force 
strategy change.

**WOTANN Implementation**: `PerFileEditTracker` with configurable thresholds.
Integrated into the hook engine via PreToolUse events on Write/Edit.

### 1.4 Mandatory Planning Enforcement (src/intelligence/amplifier.ts)
**Impact**: +15-30% on complex tasks (per multiple studies)
**How**: For tasks that touch 3+ files or involve refactoring, force the model 
to create a plan before executing. Models that plan before coding consistently 
outperform those that dive straight in.

**WOTANN Implementation**: `IntelligenceAmplifier.amplify()` classifies task 
complexity and injects planning preambles for moderate/complex/expert tasks.

### 1.5 Environment Bootstrap (src/middleware/local-context.ts)
**Impact**: -2-3 wasted turns per session (discovering environment)
**How**: At session start, inject working directory, Node.js version, Git branch,
package manager, test framework, TypeScript status. Prevents the agent from 
wasting turns running `node --version` and `which npm`.

**WOTANN Implementation**: `LocalContextMiddleware` gathers and injects this 
automatically on the first turn.

### 1.6 DoomLoop Detection (src/hooks/doom-loop-detector.ts)
**Impact**: +3-5% from LangChain's improvement (prevents wasted cycles)
**How**: Detect repeating patterns:
- Exact repetition: A, A, A
- Alternating: A, B, A, B
- Cycling: A, B, C, A, B, C
- Similarity: outputs >90% similar (trigram Jaccard)

**WOTANN Implementation**: `DoomLoopDetector` with both consecutive and 
sequence detection. In autonomous mode, it triggers strategy escalation.

### 1.7 Tool Call Correction (src/hooks/benchmark-engineering.ts)
**Impact**: -1-2 failed tool calls per session
**How**: Models commonly misname parameters (path→file_path, text→content,
cmd→command) or use relative paths. Auto-correct these before execution.

**WOTANN Implementation**: `correctToolCall()` normalizes parameter names 
and converts relative paths to absolute.

### 1.8 System Reminders (src/context/window-intelligence.ts)
**Impact**: Counteracts instruction fade-out in long sessions
**How**: In long conversations, models gradually "forget" system prompt 
instructions. Event-driven system reminders inject targeted guidance at 
decision points (every 5 turns for verification, on high context pressure).

**WOTANN Implementation**: `ContextWindowIntelligence.getActiveReminders()` 
returns applicable reminders based on turn count and context pressure.

---

## 2. CONTEXT ENGINEERING TECHNIQUES

### 2.1 5-Stage Progressive Compaction (src/context/window-intelligence.ts)
1. Remove unused tool schemas
2. Evict old conversation messages
3. Truncate tool outputs to summaries
4. Offload working memory to disk
5. Aggressively summarize remaining conversation

### 2.2 Provider-Aware Context Budget
Each provider has different context limits:
- Claude Opus 4.6: 1,000,000 tokens (no surcharge)
- GPT-5.4: 1,000,000 tokens (surcharge above 272K)
- Gemini 3.1 Pro: 1,000,000 tokens
- Ollama (Qwen 3.5): 256,000 tokens (KV cache q8_0 doubles this)
- Copilot: 128,000 tokens

The harness automatically adjusts compaction thresholds per provider.

### 2.3 Dynamic Context Discovery (Cursor pattern)
Only pull files that are actually needed:
- On Write/Edit: auto-read imports and references
- On Grep: only load matching files
- On architecture tasks: use LSP for symbol references

### 2.4 Lazy Tool Discovery
At startup, load only tool names (~10 tokens each).
Full schemas loaded on first use (~100-500 tokens each).
Saves 5,000-10,000 tokens on sessions that don't use most tools.

---

## 3. ORCHESTRATION TECHNIQUES

### 3.1 Fresh Context Per Subagent
Each subagent gets a fresh context window. The parent agent stays clean.
Prevents the #1 cause of quality degradation: accumulated context noise.

### 3.2 Write-Excluded Planning Subagents
Planning subagents cannot write files. This prevents accidental destructive 
actions during the planning phase. Only execution agents have write access.

### 3.3 Strategy Escalation (src/orchestration/autonomous.ts)
8 strategies tried in order when the agent is stuck:
1. direct → 2. decompose → 3. research-first → 4. minimal-change
5. revert-and-retry → 6. fresh-context → 7. different-model → 8. ask-for-help

### 3.4 Wave-Based Parallelism
Independent tasks executed in parallel waves. Each wave gets fresh context.
The parent aggregates results. Reduces total time by 2-4x for multi-file tasks.

---

## 4. SELF-VERIFICATION LOOP

### 4.1 Forced Verification After Writes
After every Write/Edit tool call, automatically queue:
1. TypeScript typecheck (`tsc --noEmit`)
2. Relevant tests (`vitest run [pattern]`)
3. Lint check (if configured)

Models that self-verify catch 40-60% more bugs than those that don't.

### 4.2 Semantic Entry-Point Discovery
Before editing a file, force reading:
1. The file itself (current state)
2. Files that import it
3. Files it imports
4. Recent test files for it

This prevents the #1 error: wrong assumptions about existing code.

---

## 5. CAPABILITY AUGMENTATION (Provider-Agnostic)

### 5.1 Tool Calling for Non-Tool Models
Models that don't support native tool calling get XML-injected tool definitions.
The harness parses the XML response and dispatches the tool call.
This means ANY model (including small local models) can use all tools.

### 5.2 Thinking for Non-Thinking Models
Models without extended thinking get "think step by step" prompts.
The thinking depth is proportional to task complexity.

### 5.3 Vision for Non-Vision Models
Screenshots are converted to structured text (OCR + accessibility tree).
Any text model can then process the "visual" information.

---

## 6. METRICS WE TRACK

- Tokens used per task (input, output, cached)
- Cost per provider/model
- Time to completion
- Number of tool calls
- Number of file edits (per file)
- Compaction events
- DoomLoop triggers
- Strategy escalations
- Verification pass/fail rates

---

## 7. EXPECTED IMPACT ON TERMINALBENCH

Based on the research:

| Technique | Expected Improvement |
|-----------|---------------------|
| Reasoning sandwich | +5-8% |
| Pre-completion checklist | +5-8% |
| DoomLoop prevention | +3-5% |
| Environment bootstrap | +1-2% |
| Planning enforcement | +3-5% (complex tasks) |
| Tool call correction | +1-2% |
| System reminders | +1-3% |
| **Total harness contribution** | **+15-25%** |

This means a base model scoring 50% could score 65-75% with the WOTANN harness.
A frontier model at 77% could score 85-90%.

The harness IS the architecture. The model is just the reasoning engine.
