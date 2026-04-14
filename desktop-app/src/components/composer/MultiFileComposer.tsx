/**
 * MultiFileComposer — Cursor-Composer-style multi-file edit UI.
 * User describes a multi-file edit ("refactor auth to use JWT"),
 * submits to `composer.plan` RPC, reviews proposed FileEdits per-hunk,
 * then applies via `composer.apply` RPC.
 */

import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ComposerApplyRequest,
  ComposerPlanResponse,
  FileEdit,
  Hunk,
} from "../../types";
import { FileDiffCard } from "./FileDiffCard";

const COLOR_BLUE = "#0A84FF";
const COLOR_ADD = "#30D158";
const BG_MAIN = "#000000";
const BG_CARD = "#1C1C1E";

type ComposerState =
  | { readonly kind: "idle" }
  | { readonly kind: "planning" }
  | { readonly kind: "reviewing"; readonly edits: readonly FileEdit[] }
  | { readonly kind: "applying" }
  | { readonly kind: "applied"; readonly count: number }
  | { readonly kind: "error"; readonly message: string };

export function MultiFileComposer() {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<ComposerState>({ kind: "idle" });

  const edits: readonly FileEdit[] = useMemo(
    () => (state.kind === "reviewing" ? state.edits : []),
    [state],
  );

  const { totalHunks, acceptedHunks } = useMemo(() => {
    let total = 0;
    let accepted = 0;
    for (const e of edits) {
      for (const h of e.hunks) {
        total++;
        if (h.accepted === true) accepted++;
      }
    }
    return { totalHunks: total, acceptedHunks: accepted };
  }, [edits]);

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0 || state.kind === "planning" || state.kind === "applying") {
      return;
    }

    setState({ kind: "planning" });
    try {
      const res = await invoke<ComposerPlanResponse>("composer.plan", {
        prompt: trimmed,
      });
      const seeded: readonly FileEdit[] = res.edits.map((e) => ({
        ...e,
        hunks: e.hunks.map((h) => ({ ...h })),
      }));
      setState({ kind: "reviewing", edits: seeded });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [prompt, state.kind]);

  const handleHunksChange = useCallback(
    (path: string, hunks: readonly Hunk[]) => {
      setState((prev) => {
        if (prev.kind !== "reviewing") return prev;
        const nextEdits = prev.edits.map((e) =>
          e.path === path ? { ...e, hunks } : e,
        );
        return { kind: "reviewing", edits: nextEdits };
      });
    },
    [],
  );

  const applyEdits = useCallback(
    async (onlyAccepted: boolean) => {
      if (state.kind !== "reviewing") return;
      setState({ kind: "applying" });

      const requests: ComposerApplyRequest[] = state.edits.map((e) => {
        const acceptedHunkIds = onlyAccepted
          ? e.hunks.filter((h) => h.accepted === true).map((h) => h.id)
          : e.hunks.map((h) => h.id);
        return {
          path: e.path,
          newContent: e.newContent,
          acceptedHunkIds,
        };
      });

      const filtered = onlyAccepted
        ? requests.filter((r) => r.acceptedHunkIds.length > 0)
        : requests;

      try {
        await invoke("composer.apply", { edits: filtered });
        setState({ kind: "applied", count: filtered.length });
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [state],
  );

  const handleReset = useCallback(() => {
    setState({ kind: "idle" });
    setPrompt("");
  }, []);

  const isBusy = state.kind === "planning" || state.kind === "applying";
  const canApplyAccepted = state.kind === "reviewing" && acceptedHunks > 0;
  const canApplyAll = state.kind === "reviewing" && totalHunks > 0;

  return (
    <div
      style={{
        background: BG_MAIN,
        minHeight: "100%",
        color: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Prompt input area */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: BG_MAIN,
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "rgba(255,255,255,0.5)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: "8px",
          }}
        >
          Composer
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          placeholder="Describe a multi-file edit… e.g. refactor auth to use JWT"
          disabled={isBusy}
          rows={3}
          style={{
            width: "100%",
            background: BG_CARD,
            color: "#FFFFFF",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "10px",
            padding: "12px 14px",
            fontSize: "14px",
            fontFamily:
              "ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            resize: "vertical",
            outline: "none",
            transition: "border-color 120ms ease",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = COLOR_BLUE;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
          }}
        />
        <div
          className="flex items-center justify-between"
          style={{ marginTop: "10px" }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            {state.kind === "planning" && "Planning edits…"}
            {state.kind === "applying" && "Applying edits…"}
            {state.kind === "reviewing" &&
              `${edits.length} file${edits.length === 1 ? "" : "s"} · ${acceptedHunks}/${totalHunks} hunks accepted`}
            {state.kind === "applied" &&
              `Applied ${state.count} file${state.count === 1 ? "" : "s"}`}
            {state.kind === "error" && (
              <span style={{ color: "#FF453A" }}>Error: {state.message}</span>
            )}
            {state.kind === "idle" && "⌘+Enter to plan edits"}
          </div>
          <div className="flex gap-2">
            {state.kind === "reviewing" && (
              <>
                <button
                  onClick={() => void applyEdits(true)}
                  disabled={!canApplyAccepted}
                  style={{
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "none",
                    cursor: canApplyAccepted ? "pointer" : "not-allowed",
                    background: canApplyAccepted
                      ? "rgba(48, 209, 88, 0.2)"
                      : "rgba(255,255,255,0.05)",
                    color: canApplyAccepted
                      ? COLOR_ADD
                      : "rgba(255,255,255,0.3)",
                    transition: "all 120ms ease",
                  }}
                >
                  Apply accepted
                </button>
                <button
                  onClick={() => void applyEdits(false)}
                  disabled={!canApplyAll}
                  style={{
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "none",
                    cursor: canApplyAll ? "pointer" : "not-allowed",
                    background: canApplyAll
                      ? COLOR_BLUE
                      : "rgba(255,255,255,0.05)",
                    color: canApplyAll ? "#FFFFFF" : "rgba(255,255,255,0.3)",
                    transition: "all 120ms ease",
                  }}
                >
                  Apply all
                </button>
              </>
            )}
            {(state.kind === "applied" || state.kind === "error") && (
              <button
                onClick={handleReset}
                style={{
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                  background: "transparent",
                  color: "#FFFFFF",
                }}
              >
                New plan
              </button>
            )}
            {state.kind === "idle" && (
              <button
                onClick={() => void handleSubmit()}
                disabled={prompt.trim().length === 0}
                style={{
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "none",
                  cursor:
                    prompt.trim().length === 0 ? "not-allowed" : "pointer",
                  background:
                    prompt.trim().length === 0
                      ? "rgba(255,255,255,0.05)"
                      : COLOR_BLUE,
                  color:
                    prompt.trim().length === 0
                      ? "rgba(255,255,255,0.3)"
                      : "#FFFFFF",
                }}
              >
                Plan edits
              </button>
            )}
          </div>
        </div>
      </div>

      {/* File edit cards */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
        }}
      >
        {state.kind === "reviewing" && edits.length === 0 && (
          <EmptyState message="No edits proposed." />
        )}
        {state.kind === "reviewing" &&
          edits.map((edit) => (
            <FileDiffCard
              key={edit.path}
              edit={edit}
              onHunksChange={handleHunksChange}
            />
          ))}
        {state.kind === "planning" && <LoadingState />}
        {state.kind === "applied" && (
          <EmptyState
            message={`Successfully applied ${state.count} file${
              state.count === 1 ? "" : "s"
            }.`}
          />
        )}
        {state.kind === "idle" && (
          <EmptyState message="Describe a multi-file edit above to get started." />
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { readonly message: string }) {
  return (
    <div
      style={{
        padding: "48px 16px",
        textAlign: "center",
        fontSize: "13px",
        color: "rgba(255,255,255,0.45)",
      }}
    >
      {message}
    </div>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        padding: "48px 16px",
        textAlign: "center",
        fontSize: "13px",
        color: "rgba(255,255,255,0.6)",
      }}
    >
      <div
        style={{
          display: "inline-block",
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          border: `2px solid rgba(255,255,255,0.15)`,
          borderTopColor: COLOR_BLUE,
          animation: "composer-spin 0.8s linear infinite",
          marginRight: "8px",
          verticalAlign: "middle",
        }}
      />
      Analyzing and planning edits…
      <style>{`@keyframes composer-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
