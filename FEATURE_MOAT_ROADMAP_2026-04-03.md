# NEXUS Feature Moat Roadmap
> Date: April 3, 2026
>
> Goal: competitor parity plus compound advantages that only exist when channels, autonomy, memory, context, and provider abstraction all reinforce each other.

## Product Thesis
The moat is not one killer feature. The moat is a unified harness that makes every model more useful:
- stronger memory than the model has on its own
- broader tools than the model has on its own
- safer and more provable autonomy than the model has on its own
- more delivery surfaces than the model has on its own
- better context discipline than the model has on its own

## 1. Dispatch
NEXUS should converge OpenClaw-style channels and Claude-style dispatch into one provider-agnostic control plane.

### Core idea
- Every inbound message becomes a routed dispatch event.
- Each route maps to its own runtime-backed session.
- The same dispatch system should work for Telegram, Slack, Discord, WebChat, voice, and future mobile or desktop nodes.

### Required upgrades
- route policies: per-sender, per-channel, per-workspace defaults
- pairing approval queue and trusted-sender registry
- device capability registry: which node can do voice, browser, desktop, or notifications
- inbox mode: triage, snooze, escalate, forward to worker agents
- dispatch audit trail: every channel event linked to runtime session ids

### Why it matters
- This turns channels from “bots” into a true always-on companion layer.
- It creates a single surface for personal assistant, coding assistant, and automation assistant workflows.

## 2. Context Virtualization
The right answer to long context is not “give 1M to every provider.” That is impossible in practice. The right answer is to make smaller windows behave like larger ones.

### Core idea
- separate working context from stored context
- retrieve only what matters
- aggressively summarize what no longer needs exact fidelity
- break work into fresh-context waves before the model gets saturated

### Required upgrades
- context shards: topic-based session pages instead of one monolithic conversation
- source-aware compaction: compact tool output before user intent or active plan
- retrieval ranking tuned for code tasks, not generic search
- context replay: reconstruct the relevant slice for a task from trace + memory + files
- context simulator in autonomous mode: estimate token burn before each cycle and downgrade plan breadth if necessary

### Result
- 128K models become usable for much longer sessions
- 1M-capable models stop wasting their window on junk

## 3. Memory vNext
Current memory is good architecture with partial live depth. The next leap is provenance and power, not another storage backend.

### Core idea
- every memory should say where it came from, why it exists, how fresh it is, and whether it is trusted

### Required upgrades
- provenance fields for every memory entry
- freshness scoring and confidence decay
- source verification against code and current workspace state
- codebase graph joins: symbols, files, tests, commits, decisions
- episodic memory for full task narratives
- memory garbage collection policies
- proactive memory pinning for recurring workflows

### Result
- memory becomes more trustworthy
- autonomous mode can rely on it without hallucinating stale project facts

## 4. Capability Equalization
OpenClaw’s philosophy is right: the harness should dumb down or proxy features for weaker models. NEXUS should push that further.

### Core idea
- provider choice changes quality and latency, not feature availability

### Required upgrades
- explicit capability contracts per provider and model
- emulated tool-calling fallback
- emulated vision fallback through OCR and layout extraction
- emulated computer-use fallback through text-mediated control
- mode-aware provider preference: local and open models for security work, cheap models for utility, deep models for review and planning

### Result
- provider switching becomes operationally safe
- users stop feeling like a feature disappears because they changed models

## 5. Proof-Oriented Autonomy
Autonomous mode should finish with evidence, not vibes.

### Core idea
- every autonomous success should be backed by machine-readable proof

### Required upgrades
- explicit success criteria on every autonomous run
- proof bundle output: tests, typecheck, diff summary, screenshots, logs
- screenshot and OCR verification integrated into verify phases
- failure taxonomy and recovery paths
- context-budget-aware cycle planner
- final-answer validator before completion

### Result
- autonomy becomes enterprise-ready
- users trust “done” because they can inspect the proof

## 6. Voice That Matters
Voice should not just be status and prompt capture.

### Core idea
- turn voice into a real live interface for dispatch, coding, and assistant tasks

### Required upgrades
- push-to-talk in the TUI
- streaming STT and TTS
- interruptible responses
- channel and dispatch integration: send voice output to the current route or device
- local-first backend selection: WhisperKit or faster-whisper plus Piper
- premium fallback: OpenAI Realtime or ElevenLabs when enabled

### Result
- NEXUS becomes a real companion layer, not just a terminal tool

## 7. Security Research Lane
Guardrails-off should be first-class, auditable, and intelligent.

### Core idea
- unrestricted does not mean unstructured

### Required upgrades
- explicit rules-of-engagement file
- mode-specific prompt framing with evidence and remediation
- provider preference for local or open models first
- red-team or exploit task templates
- proof logging and scope reminders
- sandbox exceptions that are explicit and recorded

### Result
- useful for security researchers without pretending hosted providers will behave like uncensored locals

## 8. UI Upgrades
The TUI is now meaningfully alive. It still needs to feel more like a premium control surface.

### High-value UI upgrades
- live dispatch inbox panel
- memory/retrieval inspector panel
- context source panel showing what is currently in-window and why
- proof bundle panel after autonomous runs
- route switcher for channels and devices
- better markdown rendering and code-block focus mode
- richer diff timeline, not only current patch

## 9. Immediate Build Priorities
1. Deepen Dispatch into a real inbox and route-policy system.
2. Add context virtualization primitives and fresh-context wave execution.
3. Strengthen memory provenance and verification.
4. Add hash-anchored editing for weaker local/open models.
5. Make voice a true first-class TUI and channel surface.
6. Add file freezing and route-aware inbox triage.
7. Add proof bundles and machine-readable autonomous completion reports.
8. Expand symbol-aware editing and code search quality.
9. Add browser-first workflow presets and faster browser backends.
10. Expand benchmark and eval loops so harness improvements are measurable.

## 10. What Not To Do
- Do not confuse more providers with a stronger product.
- Do not claim long-context support as a flat number when activation differs by provider.
- Do not add marketplace volume without eval, trust, and provenance.
- Do not build more autonomy before making success and failure proofs clearer.
