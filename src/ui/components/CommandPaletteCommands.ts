/**
 * R-09 — TUI Cmd+P palette command set.
 *
 * Registers the 19 commands from the V9 reach gap matrix (R-09):
 *   chat, editor, workshop, exploit, browse, studio, fleet, creations,
 *   settings, recipe, build, deploy, offload, sop, agentless, pr-check,
 *   magic, mode, voice
 *
 * Each command maps to either:
 *   1. A TUI-native action (voice capture, mode cycle) executed in-process.
 *   2. A CLI verb hint surfaced as a system message — the verb is real
 *      (registered in src/index.ts) but TUI cannot fork-and-takeover stdio
 *      mid-render, so we tell the user the exact `wotann <verb>` to run in
 *      another terminal. This is honest: the dispatch is documented, not
 *      faked.
 *   3. The `magic` palette opens a sub-palette listing the 15 magic
 *      handlers (e.g. .investigate-issue) — the keyword "issu" matches
 *      "Investigate Issue" first because the label starts with the
 *      relevant token (CommandRegistry fuzzy puts substring matches at
 *      the front).
 *
 * Kept out of App.tsx so the registration site stays surgical (one
 * `registerR09Commands(...)` call) and the command text is testable in
 * isolation against a CommandRegistry without rendering Ink.
 */

import type { Command, CommandRegistry } from "../command-registry.js";
import { MAGIC_COMMANDS } from "../../magic/magic-commands.js";

/**
 * App-side wiring the command handlers need to interact with TUI state.
 * Passed at registration time so the commands close over the live setters
 * — same pattern used by the existing palette.* builtins in App.tsx.
 */
export interface R09CommandDeps {
  /** Append a system message (typically: hint to run a CLI verb). */
  readonly appendSystemMessage: (content: string) => void;
  /** Trigger the TUI voice capture controller. */
  readonly onVoiceCapture: () => void;
  /** Cycle the WOTANN execution mode (default → plan → acceptEdits → ...). */
  readonly onCycleMode: () => void;
  /** Open the magic-commands sub-palette (registers + displays). */
  readonly onOpenMagic: () => void;
}

/** Descriptor for one R-09 command — built from a verb name + label. */
interface R09Spec {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly keywords: readonly string[];
  readonly handler: () => void;
}

/**
 * Build the 19 R-09 command specs. Pure function so callers can inspect
 * the list without registering against a registry (tests rely on this).
 */
export function buildR09Commands(deps: R09CommandDeps): readonly Command[] {
  const verbHint =
    (verb: string, summary: string): (() => void) =>
    () => {
      deps.appendSystemMessage(`→ Run \`wotann ${verb}\` in your shell. ${summary}`);
    };

  const specs: readonly R09Spec[] = [
    {
      id: "r09.chat",
      label: "Chat",
      description: "Open a fresh chat — clears the current conversation",
      keywords: ["chat", "conversation", "talk", "new"],
      handler: () => {
        deps.appendSystemMessage(
          "→ Press Ctrl+K to clear the current chat, then type to start a new one.",
        );
      },
    },
    {
      id: "r09.editor",
      label: "Editor",
      description: "Open the side-by-side code editor (desktop app)",
      keywords: ["editor", "code", "files", "monaco"],
      handler: verbHint(
        "editor",
        "Editor lives in the desktop app — `wotann engine start` then open the desktop UI.",
      ),
    },
    {
      id: "r09.workshop",
      label: "Workshop",
      description: "Agent workshop — spawn local file tasks",
      keywords: ["workshop", "agents", "workers", "background", "local"],
      handler: verbHint("workshop", "Workshop runs background workers in parallel."),
    },
    {
      id: "r09.exploit",
      label: "Exploit",
      description: "Security research / red-team mode",
      keywords: ["exploit", "security", "research", "red-team", "cvss"],
      handler: verbHint("exploit", "Exploit mode — engagement tracking, CVSS, ROE."),
    },
    {
      id: "r09.browse",
      label: "Browse",
      description: "Browse-mode agent for autonomous web research",
      keywords: ["browse", "web", "research", "scrape"],
      handler: verbHint("browse", "Browse spawns a research agent against a URL or query."),
    },
    {
      id: "r09.studio",
      label: "Studio",
      description: "Design studio — visual canvas for design work",
      keywords: ["studio", "design", "canvas", "visual"],
      handler: verbHint(
        "design mode list",
        "Studio canvases live under ~/.wotann/canvases. Use `wotann design mode create <name>` to start one.",
      ),
    },
    {
      id: "r09.fleet",
      label: "Fleet",
      description: "Agent fleet dashboard — running workers + dispatches",
      keywords: ["fleet", "agents", "dashboard", "workers"],
      handler: verbHint(
        "daemon status",
        "Fleet view lives in the desktop app. `wotann daemon status` shows running workers in the CLI.",
      ),
    },
    {
      id: "r09.creations",
      label: "Creations",
      description: "Browse agent-crafted outputs (code, docs, diffs)",
      keywords: ["creations", "outputs", "artifacts", "diffs"],
      handler: () => {
        deps.appendSystemMessage(
          "→ Tab to the Diff panel (right side) or open the desktop app for the full Creations browser.",
        );
      },
    },
    {
      id: "r09.settings",
      label: "Settings",
      description: "Open the settings — providers, themes, shortcuts",
      keywords: ["settings", "config", "preferences", "providers"],
      handler: () => {
        deps.appendSystemMessage(
          "→ Edit ~/.wotann/config.yaml to change providers/themes. `wotann providers` lists current providers.",
        );
      },
    },
    {
      id: "r09.recipe",
      label: "Recipe",
      description: "Goose-style recipe management (V9 T12.4)",
      keywords: ["recipe", "goose", "template", "workflow"],
      handler: verbHint("recipe list", "Recipes are saved workflows under .wotann/recipes/."),
    },
    {
      id: "r09.build",
      label: "Build",
      description: "Agent writes code — build mode",
      keywords: ["build", "code", "implement", "write"],
      handler: verbHint("build", "Build mode tells the agent to write code per a spec."),
    },
    {
      id: "r09.deploy",
      label: "Deploy",
      description: "Deploy a target (Vercel, Fly, Coolify, Dokploy, ...)",
      keywords: ["deploy", "ship", "release", "vercel", "fly"],
      handler: verbHint(
        "deploy",
        "Deploy supports 6 targets. Run `wotann deploy --help` for options.",
      ),
    },
    {
      id: "r09.offload",
      label: "Offload",
      description: "Offload a task to a remote worker",
      keywords: ["offload", "remote", "cloud", "worker"],
      handler: verbHint("offload", "Offload routes a task to a remote runner (T11)."),
    },
    {
      id: "r09.sop",
      label: "SOP",
      description: "Spec-of-Process — turn an idea into a structured plan",
      keywords: ["sop", "spec", "plan", "process"],
      handler: verbHint("sop", "SOP turns a free-form idea into a structured implementation spec."),
    },
    {
      id: "r09.agentless",
      label: "Agentless",
      description: "Agentless mode — pure model, no tool calls",
      keywords: ["agentless", "no-tools", "pure", "model"],
      handler: verbHint(
        "agentless",
        "Agentless skips the tool layer and queries the model directly.",
      ),
    },
    {
      id: "r09.pr-check",
      label: "PR Check",
      description: "Run pre-commit / pre-merge checks on the current branch",
      keywords: ["pr-check", "pr", "check", "precommit", "review"],
      handler: verbHint("pr-check", "PR check runs typecheck + tests + lint and reports diffs."),
    },
    {
      id: "r09.magic",
      label: "Magic Commands",
      description: "Open the magic dot-shortcut palette (.fix, .test, ...)",
      keywords: ["magic", "shortcut", "dot", "fix", "test"],
      handler: deps.onOpenMagic,
    },
    {
      id: "r09.mode",
      label: "Mode",
      description: "Cycle execution mode (default → plan → acceptEdits → ...)",
      keywords: ["mode", "cycle", "plan", "acceptEdits", "auto"],
      handler: deps.onCycleMode,
    },
    {
      id: "r09.voice",
      label: "Voice",
      description: "Push-to-talk voice prompt capture",
      keywords: ["voice", "talk", "speech", "ptt", "audio"],
      handler: deps.onVoiceCapture,
    },
  ];

  return specs;
}

/**
 * Build the magic-commands sub-palette commands. Each magic handler
 * (.fix, .test, .investigate-issue, ...) becomes a palette entry whose
 * label is a human-friendly version of the id and whose description
 * mirrors the dot-shortcut text.
 *
 * The label ordering matters: when the user types "issu", the registry
 * fuzzy puts substring matches first, so "Investigate Issue" surfaces
 * ahead of "Investigate Pr" / "Investigate Workflow" because "issu" is
 * a prefix of "Issue" within "Investigate Issue".
 */
export function buildMagicSubCommands(
  appendSystemMessage: (content: string) => void,
): readonly Command[] {
  return MAGIC_COMMANDS.map<Command>((mc) => ({
    id: `r09.magic.${mc.id}`,
    label: humanizeMagicId(mc.id),
    description: `${mc.trigger} — ${mc.description}`,
    keywords: [mc.id, mc.trigger.replace(/^\./, ""), mc.category],
    handler: () => {
      appendSystemMessage(
        `→ Type \`${mc.trigger} <args>\` at the prompt to invoke this magic command, ` +
          `or run \`wotann magic ${mc.id} <args>\` in your shell.`,
      );
    },
  }));
}

/**
 * Convert a magic id like "investigate-issue" to a Title-Case label
 * "Investigate Issue". Used both at registration time and by tests that
 * verify "issu" → "Investigate Issue" surfaces first.
 */
export function humanizeMagicId(id: string): string {
  return id
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(" ");
}

/**
 * Register the R-09 commands against a CommandRegistry. Returns the
 * unregister teardown function so the caller can roll back at unmount.
 */
export function registerR09Commands(registry: CommandRegistry, deps: R09CommandDeps): () => void {
  const commands = buildR09Commands(deps);
  for (const cmd of commands) registry.register(cmd);
  return () => {
    for (const cmd of commands) registry.unregister(cmd.id);
  };
}
