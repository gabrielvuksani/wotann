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
import type { WorkflowNodeDef } from "../workflow/dag-layout";

type WorkshopTab =
  | "active"
  | "workers"
  | "inbox"
  | "scheduled"
  | "playground"
  | "workflows"
  | "config";

const TABS: readonly { readonly id: WorkshopTab; readonly label: string }[] = [
  { id: "active", label: "Active" },
  { id: "workers", label: "Workers" },
  { id: "inbox", label: "Inbox" },
  { id: "scheduled", label: "Scheduled" },
  { id: "playground", label: "Playground" },
  { id: "workflows", label: "Workflows" },
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
        {activeTab === "config" && <AgentConfigPanel />}
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
