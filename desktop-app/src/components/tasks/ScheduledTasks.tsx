/**
 * Scheduled Tasks — manage recurring tasks (cron-style).
 * Connected to KAIROS daemon's cron system.
 */

import { useState, useEffect, useCallback } from "react";
import { getCronJobs } from "../../store/engine";
import type { CronJob } from "../../hooks/useTauriCommand";

const SCHEDULE_OPTIONS: readonly { readonly label: string; readonly cron: string }[] = [
  { label: "Every 5 minutes", cron: "*/5 * * * *" },
  { label: "Every 30 minutes", cron: "*/30 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Daily at 9am", cron: "0 9 * * *" },
  { label: "Weekly (Monday)", cron: "0 9 * * 1" },
];

export function ScheduledTasks() {
  const [tasks, setTasks] = useState<readonly CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewTask, setShowNewTask] = useState(false);
  const [newTaskName, setNewTaskName] = useState("");
  const [newTaskCommand, setNewTaskCommand] = useState("");
  const [newTaskSchedule, setNewTaskSchedule] = useState(SCHEDULE_OPTIONS[0]!.cron);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setNewTaskName("");
    setNewTaskCommand("");
    setNewTaskSchedule(SCHEDULE_OPTIONS[0]!.cron);
    setCreateError(null);
  }, []);

  const refreshTasks = useCallback(async () => {
    const result = await getCronJobs();
    setTasks(result);
  }, []);

  const handleCreate = useCallback(async () => {
    // Validate required fields
    if (!newTaskName.trim()) {
      setCreateError("Task name is required");
      return;
    }
    if (!newTaskCommand.trim()) {
      setCreateError("Command is required");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("create_cron_job", {
        name: newTaskName.trim(),
        command: newTaskCommand.trim(),
        schedule: newTaskSchedule,
      });
      // Refresh the task list after creation
      await refreshTasks();
      // Close form and reset
      resetForm();
      setShowNewTask(false);
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Failed to create task",
      );
    } finally {
      setCreating(false);
    }
  }, [newTaskName, newTaskCommand, newTaskSchedule, refreshTasks, resetForm]);

  useEffect(() => {
    let cancelled = false;
    async function loadTasks() {
      setLoading(true);
      const result = await getCronJobs();
      if (!cancelled) {
        setTasks(result);
        setLoading(false);
      }
    }
    loadTasks();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>Scheduled Tasks</h2>
        <button
          onClick={() => setShowNewTask(!showNewTask)}
          className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-colors"
          style={{ background: "var(--color-primary)" }}
          aria-label={showNewTask ? "Cancel new task" : "Create a new scheduled task"}
        >
          + New Task
        </button>
      </div>

      {showNewTask && (
        <div className="rounded-xl border p-4 mb-4 space-y-3" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
          <input
            placeholder="Task name"
            value={newTaskName}
            onChange={(e) => { setNewTaskName(e.target.value); setCreateError(null); }}
            className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none"
            style={{ background: "var(--surface-3)", borderColor: "var(--border-default)", color: "var(--color-text-primary)" }}
            aria-label="Task name"
          />
          <input
            placeholder="Command (e.g., npm test)"
            value={newTaskCommand}
            onChange={(e) => { setNewTaskCommand(e.target.value); setCreateError(null); }}
            className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none font-mono"
            style={{ background: "var(--surface-3)", borderColor: "var(--border-default)", color: "var(--color-text-primary)" }}
            aria-label="Task command"
          />
          <select
            value={newTaskSchedule}
            onChange={(e) => setNewTaskSchedule(e.target.value)}
            className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none"
            style={{ background: "var(--surface-3)", borderColor: "var(--border-default)", color: "var(--color-text-primary)" }}
            aria-label="Task schedule"
          >
            {SCHEDULE_OPTIONS.map((opt) => (
              <option key={opt.cron} value={opt.cron}>{opt.label}</option>
            ))}
          </select>
          {createError && (
            <p className="text-xs" style={{ color: "var(--color-error)" }}>{createError}</p>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowNewTask(false); resetForm(); }} className="px-3 py-1.5 text-xs rounded-lg" style={{ background: "var(--surface-3)", color: "var(--color-text-secondary)" }} aria-label="Cancel new task creation">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-3 py-1.5 text-xs text-white rounded-lg disabled:opacity-50"
              style={{ background: "var(--color-primary)" }}
              aria-label={creating ? "Creating scheduled task" : "Create scheduled task"}
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-primary)" }} />
            Loading scheduled tasks...
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 rounded-xl border flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v3l2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No scheduled tasks</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            Create a task above to run commands on a schedule
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className="rounded-xl border p-4" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }} role="article" aria-label={`Scheduled task: ${task.name}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ background: task.enabled ? "var(--color-success)" : "var(--color-text-dim)" }} />
                  <div>
                    <h3 className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>{task.name}</h3>
                    <p className="text-xs font-mono mt-0.5" style={{ color: "var(--color-text-muted)" }}>{task.command}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>{task.schedule}</p>
                  {task.lastRun && (
                    <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                      Last: {task.lastRun}
                      <span style={{ color: task.lastResult === "success" ? "var(--color-success)" : "var(--color-error)" }}>
                        {task.lastResult === "success" ? " pass" : " fail"}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
