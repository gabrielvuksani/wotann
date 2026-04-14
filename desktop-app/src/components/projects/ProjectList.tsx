/**
 * Project List — workspace browser with project cards.
 * Each project has custom instructions, knowledge files, and persistent memory.
 */

import { useState, useEffect } from "react";
import { getWorkspaces } from "../../store/engine";
import type { WorkspaceInfo } from "../../hooks/useTauriCommand";

export function ProjectList() {
  const [projects, setProjects] = useState<readonly WorkspaceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspaces() {
      setLoading(true);
      const result = await getWorkspaces();
      if (!cancelled) {
        setProjects(result);
        setLoading(false);
      }
    }
    loadWorkspaces();
    return () => { cancelled = true; };
  }, []);

  const filtered = search
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  const pinned = filtered.filter((p) => p.pinned);
  const recent = filtered.filter((p) => !p.pinned);

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search projects..."
          className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none"
          style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-primary)" }}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
            <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: "var(--color-text-dim)", borderTopColor: "var(--color-primary)" }} />
            Discovering workspaces...
          </div>
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 rounded-xl border flex items-center justify-center mx-auto mb-3" style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}>
            <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }}>
              <path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 8v6M2 5l6 3 6-3" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No projects found</p>
          <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
            Open a project folder to get started
          </p>
        </div>
      ) : (
        <>
          {/* Pinned */}
          {pinned.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-muted)" }}>Pinned</h3>
              <div className="space-y-2">
                {pinned.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            </div>
          )}

          {/* Recent */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-muted)" }}>Recent</h3>
            {recent.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: "var(--color-text-muted)" }}>No projects found</p>
            ) : (
              <div className="space-y-2">
                {recent.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* New Project Button */}
      <button
        className="w-full mt-4 px-4 py-3 border border-dashed rounded-xl text-sm transition-colors"
        style={{ borderColor: "var(--border-default)", color: "var(--color-text-muted)", cursor: "pointer", background: "transparent" }}
        onClick={async () => {
          try {
            const { invoke } = await import("@tauri-apps/api/core");
            const selected = await invoke<string | null>("open_folder_dialog");
            if (selected) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (window as any).__wotannToast?.({ type: "success", title: "Project opened", message: selected });
            }
          } catch {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).__wotannToast?.({ type: "error", title: "Could not open folder", message: "Tauri dialog unavailable" });
          }
        }}
        aria-label="Open a project folder"
      >
        + Open Project
      </button>
    </div>
  );
}

function ProjectCard({ project }: { readonly project: WorkspaceInfo }) {
  const timeAgo = formatTimeAgo(project.lastAccessed);

  return (
    <button
      className="w-full text-left rounded-xl border p-3 transition-all group card-interactive"
      style={{ background: "var(--surface-2)", borderColor: "var(--border-subtle)" }}
      onClick={() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__wotannToast?.({ type: "agent", title: "Project selected", message: project.name });
      }}
      aria-label={`Open project: ${project.name}`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{project.name}</h4>
            {project.pinned && (
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ color: "var(--color-warning)", flexShrink: 0 }}>
                <path d="M9.5 1.5L14.5 6.5L10 11L8.5 9.5L5 13V11L2 8H4L6.5 5.5L5 4L9.5 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <p className="text-xs truncate mt-0.5" style={{ color: "var(--color-text-muted)" }}>{project.description}</p>
        </div>
        <span className="text-[10px] flex-shrink-0 ml-2" style={{ color: "var(--color-text-muted)" }}>{timeAgo}</span>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>{project.conversationCount} conversations</span>
        <span className="text-[10px] truncate" style={{ color: "var(--color-text-muted)" }}>{project.path}</span>
      </div>
    </button>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
