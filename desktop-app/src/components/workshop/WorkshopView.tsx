/**
 * Workshop — unified task orchestration workspace.
 * 4 tabs: Active | Workers | Inbox | Scheduled
 */

import { useState, useCallback } from "react";
import { useStore } from "../../store";
import { spawnAgent } from "../../store/engine";
import { AgentFleetDashboard } from "../agents/AgentFleetDashboard";
import { TaskMonitor } from "../autonomous/TaskMonitor";
import { DispatchInbox } from "../dispatch/DispatchInbox";
import { ScheduledTasks } from "../tasks/ScheduledTasks";
import { CodePlayground } from "../playground/CodePlayground";
import { WorkflowBuilder } from "../workflow/WorkflowBuilder";
import { AgentConfigPanel } from "./AgentConfigPanel";
import { CanvasStream } from "../canvases/CanvasStream";
import { parseCanvasBlocks } from "../../lib/canvas-registry";
import type { WorkflowNodeDef } from "../workflow/dag-layout";

type WorkshopTab =
  | "active"
  | "workers"
  | "inbox"
  | "scheduled"
  | "playground"
  | "workflows"
  | "canvases"
  | "config";

const TABS: readonly { readonly id: WorkshopTab; readonly label: string }[] = [
  { id: "active", label: "Active" },
  { id: "workers", label: "Workers" },
  { id: "inbox", label: "Inbox" },
  { id: "scheduled", label: "Scheduled" },
  { id: "playground", label: "Playground" },
  { id: "workflows", label: "Workflows" },
  { id: "canvases", label: "Canvases" },
  { id: "config", label: "Config" },
];

export function WorkshopView() {
  const [activeTab, setActiveTab] = useState<WorkshopTab>("active");
  const [showNewTask, setShowNewTask] = useState(false);
  const [taskDescription, setTaskDescription] = useState("");
  const agents = useStore((s) => s.agents);
  const addNotification = useStore((s) => s.addNotification);

  const runningCount = agents.filter((a) => a.status === "running").length;
  const totalWorkers = agents.length;

  const badgeCounts: Record<WorkshopTab, number | null> = {
    active: runningCount > 0 ? runningCount : null,
    workers: totalWorkers > 0 ? totalWorkers : null,
    inbox: null,
    scheduled: null,
    playground: null,
    workflows: null,
    canvases: null,
    config: null,
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div
        className="flex items-center shrink-0"
        style={{
          padding: "0 16px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
        role="tablist"
        aria-label="Workshop tabs"
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = badgeCounts[tab.id];
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className="btn-press"
              style={{
                padding: "12px 16px",
                fontSize: "var(--font-size-sm)",
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                border: "none",
                borderBottom: isActive ? "2px solid var(--color-primary)" : "2px solid transparent",
                background: "transparent",
                color: isActive ? "var(--color-text-primary)" : "var(--color-text-muted)",
                transition: "color 200ms var(--ease-expo), border-color 200ms var(--ease-expo)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {tab.label}
              {count !== null && (
                <span
                  style={{
                    fontSize: "var(--font-size-2xs)",
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: "var(--radius-lg)",
                    background: isActive ? "var(--accent-muted)" : "var(--bg-surface)",
                    color: isActive ? "var(--color-primary)" : "var(--color-text-dim)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden" role="tabpanel">
        {activeTab === "active" && (
          <div className="h-full flex flex-col">
            <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
              <button
                className="btn-press"
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  background: "#1C1C1E",
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--border-subtle)",
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 500,
                  cursor: "pointer",
                  transition: "background 200ms var(--ease-expo)",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
                aria-label="Submit new background task"
                onClick={() => setShowNewTask(!showNewTask)}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                New Task
              </button>
              {showNewTask && (
                <form
                  className="flex items-center gap-2 ml-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!taskDescription.trim()) return;
                    try {
                      await spawnAgent(taskDescription.trim());
                      addNotification({ type: "task_complete", title: "Task submitted", message: taskDescription.trim() });
                      setTaskDescription("");
                      setShowNewTask(false);
                    } catch (err) {
                      addNotification({ type: "error", title: "Task failed", message: String(err) });
                    }
                  }}
                >
                  <input
                    type="text"
                    value={taskDescription}
                    onChange={(e) => setTaskDescription(e.target.value)}
                    placeholder="Describe the task..."
                    autoFocus
                    className="depth-input-container"
                    style={{ padding: "6px 12px", fontSize: "var(--font-size-xs)", flex: 1, minWidth: 200, color: "var(--color-text-primary)", background: "var(--surface-1)" }}
                  />
                  <button type="submit" className="depth-ghost-btn" style={{ padding: "6px 12px", fontSize: "var(--font-size-xs)", fontWeight: 600, borderRadius: "var(--radius-sm)", cursor: "pointer" }}>
                    Submit
                  </button>
                </form>
              )}
            </div>
            <div className="flex-1 overflow-hidden">
              <TaskMonitor />
            </div>
          </div>
        )}
        {activeTab === "workers" && <AgentFleetDashboard />}
        {activeTab === "inbox" && <DispatchInbox />}
        {activeTab === "scheduled" && <ScheduledTasks />}
        {activeTab === "playground" && <CodePlayground />}
        {activeTab === "workflows" && <WorkflowsPanel />}
        {activeTab === "canvases" && <CanvasesPanel />}
        {activeTab === "config" && <AgentConfigPanel />}
      </div>
    </div>
  );
}

// ── Canvases Panel ────────────────────────────────────────
//
// Port of Cursor 3 "Canvases" — agent output rendered as interactive
// React components, not just markdown. The panel takes a source of
// agent output (today: a paste-in text area; tomorrow: a streamed
// transcript from the engine bridge) and mounts the matching canvas
// from `components/canvases/` per block.
//
// A small "Sample" menu seeds common canvas-block snippets so users
// can validate each canvas renderer without wiring up a full agent
// run — honest scaffolding for a feature whose real consumer (the
// engine bridge) lands in a later phase.

type SampleKey = "pr-review" | "data-explorer" | "eval-comparison" | "memory-palace";

const CANVAS_SAMPLES: Readonly<Record<SampleKey, string>> = {
  "pr-review": '```canvas:pr-review\n' + JSON.stringify({
    title: "Fix race condition in websocket bridge",
    description: "Eliminates the intermittent 'message after close' error when the daemon restarts mid-frame.",
    riskScore: 0.32,
    prUrl: "wotann/wotann#812",
    files: [
      { path: "src/daemon/bridge.ts", additions: 18, deletions: 6, diff: "@@ -45,7 +45,18 @@\n-  ws.send(payload);\n+  if (ws.readyState === WebSocket.OPEN) {\n+    ws.send(payload);\n+  }" },
      { path: "tests/daemon/bridge.test.ts", additions: 24, deletions: 0, diff: "@@ +1,24 @@\n+it('drops frames after close', async () => {\n+  // ...\n+});" },
    ],
    comments: [
      { id: "c1", file: "src/daemon/bridge.ts", line: 48, body: "Guard the send path. Good defense; matches the fix I was going to suggest.", suggestion: { hunkIds: ["h-bridge-send"] } },
      { id: "c2", file: "tests/daemon/bridge.test.ts", line: 12, body: "Nit: assert the error log was NOT emitted after the close.", suggestion: { hunkIds: [] } },
    ],
  }, null, 2) + '\n```',

  "data-explorer": '```canvas:data-explorer\n' + JSON.stringify({
    title: "Last 7 days of daemon health",
    schema: [
      { name: "date", type: "string" },
      { name: "uptimePct", type: "number" },
      { name: "p95LatencyMs", type: "number" },
      { name: "errorCount", type: "number" },
      { name: "restartCount", type: "number" },
    ],
    rows: [
      { date: "2026-04-13", uptimePct: 99.8, p95LatencyMs: 42, errorCount: 3, restartCount: 0 },
      { date: "2026-04-14", uptimePct: 99.4, p95LatencyMs: 58, errorCount: 11, restartCount: 1 },
      { date: "2026-04-15", uptimePct: 99.9, p95LatencyMs: 39, errorCount: 1, restartCount: 0 },
      { date: "2026-04-16", uptimePct: 98.7, p95LatencyMs: 112, errorCount: 27, restartCount: 2 },
      { date: "2026-04-17", uptimePct: 99.5, p95LatencyMs: 48, errorCount: 8, restartCount: 0 },
      { date: "2026-04-18", uptimePct: 99.9, p95LatencyMs: 37, errorCount: 2, restartCount: 0 },
      { date: "2026-04-19", uptimePct: 100.0, p95LatencyMs: 35, errorCount: 0, restartCount: 0 },
    ],
  }, null, 2) + '\n```',

  "eval-comparison": '```canvas:eval-comparison\n' + JSON.stringify({
    title: "TerminalBench subset (N=8) — WOTANN vs Cursor",
    models: [
      { id: "wotann-free", label: "WOTANN (Gemma-4 bundled)" },
      { id: "wotann-sonnet", label: "WOTANN (Sonnet)" },
      { id: "cursor-claude", label: "Cursor 3 (Claude)" },
    ],
    tasks: [
      { id: "t1", name: "cron-timer: convert Cron to durable timer", results: { "wotann-free": { passed: true, latencyMs: 13200, tokens: 4300, costUsd: 0 }, "wotann-sonnet": { passed: true, latencyMs: 9800, tokens: 3600, costUsd: 0.0132 }, "cursor-claude": { passed: true, latencyMs: 11200, tokens: 4100, costUsd: 0.0148 } } },
      { id: "t2", name: "audit-gap: ordered-chain flaky retries", results: { "wotann-free": { passed: false, latencyMs: 28400, tokens: 8100, costUsd: 0, trajectory: "failed on step 4: missing Rust trait import" }, "wotann-sonnet": { passed: true, latencyMs: 18200, tokens: 5900, costUsd: 0.0201 }, "cursor-claude": { passed: true, latencyMs: 19800, tokens: 6200, costUsd: 0.0215 } } },
      { id: "t3", name: "perf-win: SQLite-FTS5 N+1 scan", results: { "wotann-free": { passed: true, latencyMs: 7300, tokens: 2400, costUsd: 0 }, "wotann-sonnet": { passed: true, latencyMs: 5600, tokens: 2100, costUsd: 0.0079 }, "cursor-claude": { passed: false, latencyMs: 9200, tokens: 3500, costUsd: 0.0124, trajectory: "misidentified the N+1 location" } } },
    ],
  }, null, 2) + '\n```',

  "memory-palace": '```canvas:memory-palace\n' + JSON.stringify({
    title: "Gabriel's palace",
    wings: [
      {
        id: "projects",
        name: "Projects",
        description: "Everything I'm actively building.",
        halls: [
          {
            id: "wotann",
            name: "WOTANN",
            rooms: [
              { id: "r1", title: "Phase G3 shipped", summary: "Canvas registry + 4 seed canvases mounted in Workshop.", tags: ["phase-g3", "canvas"], updatedAt: Date.now() - 1000 * 60 * 5, observationCount: 3 },
              { id: "r2", title: "Sprint 78 closed 10 audit gaps", summary: "Phase-1 audit gaps closed in session 5.", tags: ["audit", "sprint-78"], updatedAt: Date.now() - 1000 * 60 * 60 * 72, observationCount: 10 },
            ],
          },
        ],
      },
      {
        id: "patterns",
        name: "Patterns",
        halls: [
          {
            id: "ui",
            name: "UI patterns",
            rooms: [
              { id: "r3", title: "Liquid Glass tier system", summary: "subtle / medium / strong tiers for backdrop-filter surfaces.", tags: ["ui", "glass"], observationCount: 1 },
            ],
          },
        ],
      },
    ],
  }, null, 2) + '\n```',
};

function CanvasesPanel() {
  const [source, setSource] = useState("");
  const blockCount = parseCanvasBlocks(source).length;

  const loadSample = useCallback((key: SampleKey) => {
    setSource(CANVAS_SAMPLES[key]);
  }, []);

  const loadAllSamples = useCallback(() => {
    const keys: readonly SampleKey[] = [
      "pr-review",
      "data-explorer",
      "eval-comparison",
      "memory-palace",
    ];
    const combined = keys
      .map((k) => CANVAS_SAMPLES[k])
      .join("\n\nBetween-canvas prose. The agent can narrate like markdown, and the canvases slot in where the agent emitted blocks.\n\n");
    setSource(combined);
  }, []);

  const clearSource = useCallback(() => {
    setSource("");
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Controls */}
      <div
        style={{
          padding: "var(--space-sm) var(--space-md)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-dim)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Samples
        </span>
        {(["pr-review", "data-explorer", "eval-comparison", "memory-palace"] as const).map(
          (key) => (
            <button
              key={key}
              type="button"
              onClick={() => loadSample(key)}
              className="btn-press"
              style={{
                padding: "4px 10px",
                fontSize: "var(--font-size-2xs)",
                fontWeight: 500,
                borderRadius: "var(--radius-sm, 6px)",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-2)",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              {key}
            </button>
          ),
        )}
        <button
          type="button"
          onClick={loadAllSamples}
          className="btn-press"
          style={{
            padding: "4px 10px",
            fontSize: "var(--font-size-2xs)",
            fontWeight: 500,
            borderRadius: "var(--radius-sm, 6px)",
            border: "1px dashed var(--border-subtle)",
            background: "transparent",
            color: "var(--color-text-muted)",
            cursor: "pointer",
          }}
        >
          all
        </button>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs)",
            color: "var(--color-text-dim)",
          }}
        >
          {blockCount} block{blockCount === 1 ? "" : "s"} detected
        </span>
        {source ? (
          <button
            type="button"
            onClick={clearSource}
            className="btn-press"
            style={{
              padding: "4px 10px",
              fontSize: "var(--font-size-2xs)",
              fontWeight: 500,
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Split: source textarea | rendered canvases */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(280px, 1fr) minmax(0, 2fr)",
          gap: 0,
        }}
      >
        {/* Source */}
        <div
          style={{
            borderRight: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          <label
            htmlFor="canvas-source"
            style={{
              padding: "var(--space-sm) var(--space-md)",
              fontSize: "var(--font-size-2xs)",
              color: "var(--color-text-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            Agent output
          </label>
          <textarea
            id="canvas-source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder={"Paste agent output here. Recognized blocks:\n\n```canvas:<type>\n{ ...json... }\n```\n\nor\n\ncanvas: <type>\ndata: { ...json... }\n---"}
            spellCheck={false}
            style={{
              flex: 1,
              width: "100%",
              padding: "var(--space-md)",
              background: "var(--bg-base)",
              color: "var(--color-text-secondary)",
              border: "none",
              outline: "none",
              resize: "none",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-2xs)",
              lineHeight: 1.5,
              minHeight: 0,
            }}
          />
        </div>

        {/* Preview */}
        <div
          style={{
            overflow: "auto",
            padding: "var(--space-md)",
            minHeight: 0,
          }}
        >
          {blockCount === 0 ? (
            <div
              style={{
                padding: "var(--space-lg)",
                textAlign: "center",
                color: "var(--color-text-muted)",
                fontSize: "var(--font-size-xs)",
              }}
            >
              {source.trim().length === 0 ? (
                <>
                  <div
                    style={{
                      fontWeight: 600,
                      color: "var(--color-text-secondary)",
                      marginBottom: 6,
                    }}
                  >
                    No agent output
                  </div>
                  <div>Choose a sample above or paste a transcript.</div>
                </>
              ) : (
                <>
                  <div
                    style={{
                      fontWeight: 600,
                      color: "var(--color-text-secondary)",
                      marginBottom: 6,
                    }}
                  >
                    No canvas blocks found
                  </div>
                  <div>
                    The source has no <code>canvas:</code> blocks. Canvases only
                    render when the agent emits a fenced{" "}
                    <code>canvas:&lt;type&gt;</code> block or the{" "}
                    <code>canvas:…\ndata:…\n---</code> variant.
                  </div>
                </>
              )}
            </div>
          ) : (
            <CanvasStream source={source} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Workflows Panel ──────────────────────────────────────

interface WorkflowTemplate {
  readonly name: string;
  readonly description: string;
  readonly nodes: readonly WorkflowNodeDef[];
}

const BUILTIN_WORKFLOWS: readonly WorkflowTemplate[] = [
  {
    name: "idea-to-pr",
    description: "Transform an idea into a complete pull request",
    nodes: [
      { id: "research", type: "agent", prompt: "Research the idea and gather context", dependencies: [] },
      { id: "plan", type: "agent", prompt: "Create an implementation plan", dependencies: ["research"] },
      { id: "implement", type: "agent", prompt: "Write the code", dependencies: ["plan"] },
      { id: "test", type: "shell", command: "npm test", dependencies: ["implement"], prompt: "" },
      { id: "review", type: "approval", approvalPrompt: "Review changes before PR", dependencies: ["test"], prompt: "" },
    ],
  },
  {
    name: "fix-issue",
    description: "Investigate and fix a reported issue",
    nodes: [
      { id: "investigate", type: "agent", prompt: "Analyze the issue and identify root cause", dependencies: [] },
      { id: "fix", type: "agent", prompt: "Implement the fix", dependencies: ["investigate"] },
      { id: "verify", type: "shell", command: "npm test", dependencies: ["fix"], prompt: "" },
      { id: "approve", type: "approval", approvalPrompt: "Confirm fix resolves the issue", dependencies: ["verify"], prompt: "" },
    ],
  },
  {
    name: "refactor",
    description: "Refactor code with safety verification",
    nodes: [
      { id: "analyze", type: "agent", prompt: "Analyze code for refactoring opportunities", dependencies: [] },
      { id: "refactor", type: "loop", prompt: "Apply refactoring", maxIterations: 3, exitCondition: "all tests pass", dependencies: ["analyze"] },
      { id: "test", type: "shell", command: "npm test", dependencies: ["refactor"], prompt: "" },
      { id: "review", type: "approval", approvalPrompt: "Review refactored code", dependencies: ["test"], prompt: "" },
    ],
  },
  {
    name: "code-review",
    description: "Multi-perspective code review",
    nodes: [
      { id: "security", type: "agent", prompt: "Review for security vulnerabilities", dependencies: [] },
      { id: "quality", type: "agent", prompt: "Review code quality and patterns", dependencies: [] },
      { id: "perf", type: "agent", prompt: "Review for performance issues", dependencies: [] },
      { id: "summary", type: "agent", prompt: "Synthesize all review findings", dependencies: ["security", "quality", "perf"] },
    ],
  },
];

function WorkflowsPanel() {
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowTemplate | null>(null);
  const [workflowName, setWorkflowName] = useState("");

  const handleSelectTemplate = useCallback((template: WorkflowTemplate) => {
    setActiveWorkflow(template);
    setWorkflowName(template.name);
  }, []);

  const handleNewBlank = useCallback(() => {
    setActiveWorkflow({ name: "new-workflow", description: "Blank workflow", nodes: [] });
    setWorkflowName("new-workflow");
  }, []);

  const handleBack = useCallback(() => {
    setActiveWorkflow(null);
    setWorkflowName("");
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Template Picker */}
      <div
        style={{
          padding: "var(--space-sm) var(--space-md)",
          borderBottom: "1px solid var(--border-subtle)",
          flexShrink: 0,
        }}
      >
        <div className="flex items-center" style={{ gap: "var(--space-sm)", flexWrap: "wrap" }}>
          {activeWorkflow && (
            <button
              className="btn-press"
              onClick={handleBack}
              style={{
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                background: "var(--surface-2)",
                color: "var(--color-text-secondary)",
                border: "1px solid var(--border-subtle)",
                fontSize: "var(--font-size-2xs)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M6 2L3 5l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
          )}
          {BUILTIN_WORKFLOWS.map((wf) => (
            <button
              key={wf.name}
              className="btn-press"
              onClick={() => handleSelectTemplate(wf)}
              style={{
                padding: "6px 12px",
                borderRadius: "var(--radius-sm)",
                border: `1px solid ${activeWorkflow?.name === wf.name ? "var(--accent)" : "var(--border-subtle)"}`,
                background: activeWorkflow?.name === wf.name ? "var(--bg-surface)" : "var(--surface-2)",
                color: activeWorkflow?.name === wf.name ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                fontSize: "var(--font-size-2xs)",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {wf.name}
              <span style={{ marginLeft: 6, color: "var(--color-text-dim)" }}>
                {wf.nodes.length}
              </span>
            </button>
          ))}
          <button
            className="btn-press"
            onClick={handleNewBlank}
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px dashed var(--border-subtle)",
              background: "transparent",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-2xs)",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            New Blank
          </button>
        </div>
      </div>

      {/* Builder or Welcome */}
      <div className="flex-1 overflow-hidden">
        {activeWorkflow ? (
          <WorkflowBuilder
            initialNodes={activeWorkflow.nodes}
            workflowName={workflowName}
            onNameChange={setWorkflowName}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              gap: 12,
              padding: "var(--space-md)",
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-dim)" strokeWidth="1">
              <circle cx="12" cy="4" r="2.5" />
              <circle cx="5" cy="20" r="2.5" />
              <circle cx="19" cy="20" r="2.5" />
              <circle cx="12" cy="12" r="2.5" />
              <path d="M12 6.5v3M9.5 13.5L7 17.5M14.5 13.5L17 17.5" />
            </svg>
            <div style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)", fontWeight: 500 }}>
              Visual Workflow Builder
            </div>
            <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)", textAlign: "center", maxWidth: 360 }}>
              Select a template above or create a blank workflow to start building DAG-based agent pipelines.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
