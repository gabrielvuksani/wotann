/**
 * WOTANN ↔ Claude bridge dep assembler — V9 GA-02 closure (2026-04-25).
 *
 * `runtime.ts` previously called `startBridge({ deps: {} })` — every
 * `WaveDeps` slot defaulted to undefined, so every Claude SDK hook ran
 * the "honest stub" allow path with a warning. The 8 capabilities the
 * bridge advertises (memory, skills, permission, observer, reflector,
 * shadow-git, WAL, cost) were already alive on `WotannRuntime` — they
 * just weren't being threaded through.
 *
 * `assembleClaudeBridgeDeps(runtime)` is the missing wire. Each dep
 * adapts the runtime's existing public API to the `WaveDeps` shape
 * declared in `claude/types.ts`. The adapter is a pure function — no
 * module-level singletons, no hidden state. Per QB #7 every call returns
 * a fresh `WaveDeps` object, and the inner closures only capture the
 * `runtime` reference.
 *
 * Quality bars
 *   - QB #6 honest stubs: every closure handles "subsystem unavailable"
 *     by returning a bridge-shaped no-op decision (e.g. memoryRecall →
 *     `{ contextBlock: "", hits: 0 }`) instead of throwing. The bridge
 *     layer above never sees an unhandled rejection from a missing
 *     capability.
 *   - QB #7 per-session state: deps are produced once per bridge boot
 *     so two concurrent bridges (test + prod) get independent closures.
 *   - QB #13 grep-verifiable claim: this module is the single, exclusive
 *     source of `WaveDeps` produced from a `WotannRuntime` — runtime.ts
 *     calls `assembleClaudeBridgeDeps(this)`, no other site fabricates
 *     deps.
 *   - QB #14 commit messages are claims: changes to this file should be
 *     paired with the bridge-deps test that actually fires each closure
 *     (`tests/claude/bridge-deps.test.ts`).
 */

import type { WotannRuntime } from "../core/runtime.js";
import { matchSkillsByTrigger } from "../skills/wotann-skills-registry.js";
import { classifyRisk, resolvePermission } from "../sandbox/security.js";
import type { WaveDeps, PostToolUsePayload, StopPayload } from "./types.js";

/**
 * Build a `WaveDeps` view onto the live runtime. Every closure is bound
 * to the runtime instance passed in; reusing a deps object across two
 * runtimes is an anti-pattern (QB #7 per-session state).
 *
 * The resulting object has ALL eight `WaveDeps` slots populated. Hooks
 * that observe `deps.memoryRecall === undefined` have been the V9 GA-02
 * smoking gun — under no condition does this assembler hand back an
 * empty record.
 */
export function assembleClaudeBridgeDeps(runtime: WotannRuntime): WaveDeps {
  return {
    memoryRecall: async (prompt, _sessionId) => {
      // 10 hits at minConfidence 0.3 mirrors the runtime's default
      // assistant-side memory injector. Falls back to an empty
      // contextBlock when the unified knowledge fabric returns no rows
      // (e.g. memory disabled, fresh repo).
      try {
        const hits = await runtime.searchUnifiedKnowledge(prompt, 10, 0.3);
        if (hits.length === 0) {
          return { contextBlock: "", hits: 0 };
        }
        const lines: string[] = ["## Relevant memory"];
        for (const r of hits) {
          // Trim each retrieved chunk to a sane prefix so the hook reply
          // stays well under Claude's payload cap.
          const trimmed = r.content.length > 400 ? `${r.content.slice(0, 397)}...` : r.content;
          lines.push(`- (${r.source}, score=${r.score.toFixed(2)}) ${trimmed}`);
        }
        return { contextBlock: lines.join("\n"), hits: hits.length };
      } catch {
        return { contextBlock: "", hits: 0 };
      }
    },

    skillDispatch: async (prompt) => {
      // Trigger-match against the curated WOTANN_SKILLS registry first
      // (cheap, in-memory). For each matched id, attempt to load the
      // full skill content from the runtime's SkillRegistry — that's
      // where the .md files actually live. Honest fallback: skills that
      // can't be loaded are still surfaced by id with a one-line
      // description so the model knows they exist.
      try {
        const matches = matchSkillsByTrigger(prompt, 3);
        if (matches.length === 0) {
          return { skillIds: [], contextBlock: "" };
        }
        const registry = runtime.getSkillRegistry();
        const ids: string[] = [];
        const blocks: string[] = ["## Skills available"];
        for (const m of matches) {
          ids.push(m.id);
          const loaded = registry.loadSkill(m.id);
          if (loaded && loaded.content.length > 0) {
            const head =
              loaded.content.length > 600 ? `${loaded.content.slice(0, 597)}...` : loaded.content;
            blocks.push(`### ${m.id}\n${head}`);
          } else {
            blocks.push(`### ${m.id}\n${m.description}`);
          }
        }
        return { skillIds: ids, contextBlock: blocks.join("\n\n") };
      } catch {
        return { skillIds: [], contextBlock: "" };
      }
    },

    resolvePermission: async (toolName, input, _sessionId) => {
      // Risk-classify the tool, then map (mode × risk) → decision via
      // the canonical sandbox matrix. Mode comes from the runtime's
      // mode cycler so user-set permission modes (acceptEdits / plan /
      // bypass) flow through.
      try {
        const risk = classifyRisk(toolName, input);
        const mode = runtime.getModeName();
        // Project the WotannMode union onto the PermissionMode the
        // sandbox matrix expects. Modes that don't gate tool use map
        // back to "default" (most restrictive). Mirrors the canonical
        // permissionMode field on each MODE_CONFIGS entry — kept inline
        // because the upstream map isn't exported.
        const permMode =
          mode === "auto"
            ? "auto"
            : mode === "plan"
              ? "plan"
              : mode === "acceptEdits"
                ? "acceptEdits"
                : mode === "bypass" || mode === "autonomous" || mode === "guardrails-off"
                  ? "bypassPermissions"
                  : "default";
        const decision = resolvePermission(permMode, risk);
        if (decision === "allow") {
          return { verdict: "allow" };
        }
        // For "deny" the matrix returns when risk + mode disallow the
        // call. Surface as the bridge's "approval" verdict so the user
        // gets a confirmation prompt rather than a silent block.
        return {
          verdict: "approval",
          reason: `risk=${risk}, mode=${permMode}`,
        };
      } catch {
        // Fail-closed: any classifier exception denies the call. Better
        // to over-prompt than to silently allow an unclassified action.
        return { verdict: "approval", reason: "classifier failure" };
      }
    },

    observe: async (event: PostToolUsePayload) => {
      // Funnel PostToolUse events into the per-session Observer buffer
      // so drift detection and reflector judges see real tool activity.
      // The Observer expects user/assistant text — we synthesize a
      // compact pair that records the tool call and its truncated
      // output, preserving toolCallId for cross-reference.
      try {
        const observer = runtime.getObserver();
        const userMsg = `tool:${event.toolName} input=${JSON.stringify(event.input).slice(0, 400)}`;
        const outputStr =
          typeof event.output === "string" ? event.output : JSON.stringify(event.output ?? "");
        const assistantMsg = outputStr.length > 400 ? `${outputStr.slice(0, 397)}...` : outputStr;
        observer.observeTurn({
          sessionId: event.sessionId,
          userMessage: userMsg,
          assistantMessage: assistantMsg,
          completedAt: event.timestamp,
        });
      } catch {
        // Observer must never block the bridge — swallow extractor
        // errors here; the observer's own honest-failure path already
        // surfaces them via observeTurn's ObserveErr return.
      }
    },

    reflect: async (payload: StopPayload) => {
      // Run one reflector cycle against the session's pending
      // observations. Honest mapping:
      //   - judge ok + 0 demoted              → complete=true
      //   - judge ok + N demoted              → complete=false (work
      //                                         remains low-confidence)
      //   - judge ok with 0 observations      → complete=true (nothing
      //                                         to verify, but no
      //                                         outstanding doubt)
      //   - reflector unavailable / ok=false  → complete=true so Stop
      //                                         doesn't loop forever on
      //                                         a missing judge
      try {
        const reflector = runtime.getReflector();
        if (!reflector) {
          return { complete: true, reason: "reflector not enabled" };
        }
        const result = await reflector.reflect(payload.sessionId);
        if (!result.ok) {
          return { complete: true, reason: `reflector error: ${result.error}` };
        }
        if (result.demoted > 0) {
          return {
            complete: false,
            reason: `${result.demoted} observation(s) demoted; verify before stopping`,
            hint: "Re-run the failing case or reload context — at least one observation could not be supported.",
          };
        }
        return {
          complete: true,
          reason: `reflector verdicts: promoted=${result.promoted} kept=${result.kept} demoted=${result.demoted}`,
        };
      } catch (err) {
        return {
          complete: true,
          reason: `reflector threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },

    shadowGitWrite: async (filePath, _content, _sessionId) => {
      // Each PostToolUse(Edit|Write) requests a checkpoint. ShadowGit
      // already commits the entire workspace, so we ignore the per-file
      // content snapshot and use it only as the checkpoint label.
      try {
        const shadow = runtime.getShadowGit();
        await shadow.createCheckpoint(`claude-bridge: ${filePath}`);
      } catch {
        // Shadow-git failures are non-fatal — the user can still
        // recover via the parent repo's standard git.
      }
    },

    walSave: async (sessionId, approxTokens) => {
      // PreCompact write-ahead-log: persist a session_summary marker so
      // post-compaction recovery has something durable to read. We use
      // captureEvent (auto_capture table) rather than insert() because
      // the marker is high-volume per session and shouldn't pollute
      // core_blocks.
      try {
        const store = runtime.getMemoryStore();
        if (!store) return;
        store.captureEvent(
          "session_summary",
          `WAL pre-compact at ~${approxTokens} tokens`,
          "claude-bridge",
          sessionId,
        );
      } catch {
        // WAL failures are advisory — the bridge already swallows them
        // upstream so compaction is never blocked.
      }
    },

    recordCost: async (_sessionId, tokens) => {
      // Translate the bridge's per-event delta into a CostTracker entry.
      // Provider/model are pinned to the Claude subscription path since
      // this dep only fires from the claude-cli bridge.
      try {
        const tracker = runtime.getCostTracker();
        tracker.record("anthropic", "claude-subscription", tokens.input ?? 0, tokens.output ?? 0);
      } catch {
        // Cost tracking is observability — never block the hook reply.
      }
    },
  };
}
