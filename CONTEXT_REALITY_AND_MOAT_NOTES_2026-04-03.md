# Context Reality And Moat Notes
> Date: April 3, 2026

## Hard Truths
- It is not realistic to "give 1M context to every provider." The harness can virtualize context, but it cannot fabricate native window size.
- Long context must be tracked as:
  - documented limit
  - effective limit in the current session
  - activation path required to reach the documented limit
- Provider switching should change quality, latency, and cost, not whether core harness features exist.

## What NEXUS Should Optimize For
- Context virtualization over raw window claims:
  - shard conversation into topical pages
  - retrieve only task-relevant context
  - compact tool output before user intent or current plan
  - build fresh-context waves for long autonomous tasks
- Capability equalization:
  - emulate vision through OCR/layout extraction
  - emulate computer use through text-mediated control
  - emulate stricter tool calling and verification for weaker models
- Proof-oriented autonomy:
  - every autonomous result should emit a machine-readable proof bundle
  - completion should be backed by tests, traces, diffs, screenshots, and final checks
- Dispatch as a control plane:
  - channels, voice, devices, and background tasks should all converge on one route-aware runtime-backed inbox

## Highest-Leverage Next Features
1. Dispatch inbox:
   - triage queue
   - snooze/escalate/forward
   - per-route workspace + mode + provider policy
2. Memory provenance:
   - source file / command / session / timestamp for every memory
   - freshness and trust scoring before retrieval
3. Context source inspector:
   - show exactly what is in-window and why
   - show which items were recalled, compacted, or pinned
4. File freezing:
   - mark files as immutable for a run or route
   - block accidental edits from weaker models
5. Hash-anchored editing:
   - use content hashes to make open/local model edits safer
6. Voice as a dispatch surface:
   - route voice replies to the current active device
   - support interruptible output and streaming STT/TTS

## Product Positioning
- More providers is not the moat.
- The moat is a harness that:
  - makes smaller models safer and more useful
  - makes larger models more efficient and trustworthy
  - works through terminal, channels, voice, computer use, and automation without changing mental models
