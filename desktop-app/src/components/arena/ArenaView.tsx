/**
 * Compare view: side-by-side model comparison.
 */

import { useState, useCallback } from "react";
import { useStore } from "../../store";
import type { ArenaResponse } from "../../types";
import { MarkdownRenderer } from "../chat/MarkdownRenderer";
import { runArena } from "../../store/engine";
import { color } from "../../design/tokens.generated";

interface ArenaVote {
  readonly prompt: string;
  readonly winner: string;
  readonly loser: string;
  readonly isTie: boolean;
  readonly timestamp: number;
}

async function persistVote(vote: ArenaVote): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // Read existing votes, append, write back
    let votes: ArenaVote[] = [];
    try {
      const existing = await invoke<string>("read_file", { path: `~/.wotann/arena-votes.json` });
      if (existing) votes = JSON.parse(existing);
    } catch { /* no existing file */ }
    votes.push(vote);
    await invoke("write_file", {
      path: `~/.wotann/arena-votes.json`,
      content: JSON.stringify(votes, null, 2),
    });
  } catch { /* Not in Tauri context */ }
}

export function ArenaView() {
  const [prompt, setPrompt] = useState("");
  const [responses, setResponses] = useState<readonly ArenaResponse[]>([]);
  const [votedFor, setVotedFor] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = useStore((s) => s.providers);
  // Provider neutrality fix: was hardcoded ["claude-opus-4-6", "gpt-5.4"] —
  // Ollama-only / Gemini-only users got Arena suggestions they couldn't run.
  // Now starts empty; the model picker populates from discovered providers.
  const [selectedModels, setSelectedModels] = useState<readonly string[]>([]);

  const allModels = providers.flatMap((p) =>
    p.models.map((m) => ({ ...m, provider: p.name, providerId: p.id })),
  );

  const runComparison = useCallback(async () => {
    if (!prompt.trim() || selectedModels.length < 2) return;
    setIsRunning(true);
    setError(null);

    try {
      const results = await runArena(prompt, selectedModels);
      setResponses(results);
    } catch {
      setError("Failed to run comparison. Check engine connection.");
    } finally {
      setIsRunning(false);
    }
  }, [prompt, selectedModels]);

  const toggleModel = useCallback((modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((m) => m !== modelId)
        : [...prev, modelId],
    );
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="border-b animate-fadeIn" style={{ borderColor: "var(--border-subtle)", padding: "var(--space-md)" }}>
        <h2 style={{ fontSize: "var(--font-size-lg)", fontWeight: 600, color: "var(--color-text-primary)", marginBottom: "var(--space-xs)" }}>Compare Models</h2>
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>
          Send the same prompt to multiple models and compare responses side-by-side
        </p>
      </div>

      {/* Model selector */}
      <div className="border-b" style={{ borderColor: "var(--border-subtle)", padding: "var(--space-sm) var(--space-md)" }}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Select models to compare">
          {allModels.map((model) => (
            <button
              key={model.id}
              onClick={() => toggleModel(model.id)}
              style={{
                padding: "6px 14px",
                fontSize: "var(--font-size-xs)",
                borderRadius: "var(--radius-pill)",
                border: "1px solid",
                cursor: "pointer",
                fontWeight: 500,
                transition: "all 200ms var(--ease-expo)",
                ...(selectedModels.includes(model.id)
                  ? { background: "var(--accent-muted)", borderColor: "var(--border-focus)", color: "var(--color-primary)" }
                  : { background: "var(--surface-2)", borderColor: "var(--border-subtle)", color: "var(--color-text-secondary)" }
                ),
              }}
              aria-pressed={selectedModels.includes(model.id)}
            >
              {model.name}
              <span style={{ marginLeft: "var(--space-xs)", color: "var(--color-text-muted)" }}>({model.provider})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Prompt input */}
      <div className="border-b" style={{ borderColor: "var(--border-subtle)", padding: "var(--space-sm) var(--space-md)" }}>
        <div className="flex gap-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter a prompt to compare across models..."
            className="flex-1 resize-none"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 10,
              padding: "var(--space-sm) 12px",
              fontSize: "var(--font-size-sm)",
              color: "var(--color-text-primary)",
              outline: "none",
              transition: "border-color 200ms var(--ease-expo)",
            }}
            rows={2}
            aria-label="Prompt for model comparison"
          />
          <button
            onClick={runComparison}
            disabled={!prompt.trim() || selectedModels.length < 2 || isRunning}
            className="shrink-0 transition-colors btn-press"
            style={{
              padding: "8px 16px",
              borderRadius: "var(--radius-md)",
              fontSize: "var(--font-size-sm)",
              fontWeight: 500,
              border: "none",
              cursor: prompt.trim() && selectedModels.length >= 2 && !isRunning ? "pointer" : "not-allowed",
              ...(prompt.trim() && selectedModels.length >= 2 && !isRunning
                ? { background: "var(--gradient-accent)", color: "white" }
                : { background: "var(--surface-3)", color: "var(--color-text-muted)" }
              ),
            }}
            aria-label="Run model comparison"
          >
            {isRunning ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Comparing
              </span>
            ) : (
              "Compare"
            )}
          </button>
        </div>
        <div style={{ fontSize: "var(--font-size-2xs)", marginTop: "6px", color: "var(--color-text-muted)" }}>
          {selectedModels.length} model{selectedModels.length !== 1 ? "s" : ""} selected
          {selectedModels.length < 2 && " (need at least 2)"}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: "var(--space-sm) var(--space-md)",
            fontSize: "var(--font-size-xs)",
            background: "var(--color-error-muted)",
            borderBottom: "1px solid var(--color-error-muted)",
            color: "var(--color-error)",
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {responses.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div
                className="flex items-center justify-center mx-auto"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border-subtle)",
                  background: color("surface"),
                  marginBottom: "var(--space-sm)",
                }}
              >
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-muted)" }} aria-hidden="true">
                  <rect x="1" y="3" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="9" y="3" width="6" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
              <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
                Select 2+ models and enter a prompt to compare
              </p>
            </div>
          </div>
        ) : (
          <div
            className="grid h-full"
            style={{ gridTemplateColumns: `repeat(${responses.length}, 1fr)` }}
          >
            {responses.map((resp, i) => (
              <div
                key={resp.id}
                className="flex flex-col"
                style={i < responses.length - 1 ? { borderRight: "1px solid var(--border-subtle)" } : undefined}
              >
                {/* Response header */}
                <div
                  className="flex items-center justify-between"
                  style={{
                    padding: "12px var(--space-md)",
                    borderBottom: "1px solid var(--border-subtle)",
                    background: color("surface"),
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{
                      fontSize: "var(--font-size-xs)",
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      background: "var(--accent-muted)",
                      padding: "3px 10px",
                      borderRadius: "var(--radius-pill)",
                      letterSpacing: "0.01em",
                    }}>{resp.model}</span>
                    <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}>{resp.provider}</span>
                  </div>
                  <div className="flex items-center gap-3" style={{ fontSize: "var(--font-size-2xs)", color: "var(--color-text-muted)" }}>
                    <span>{resp.tokensUsed} tok</span>
                    <span>${resp.costUsd.toFixed(4)}</span>
                    <span>{(resp.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                </div>

                {/* Response content */}
                <div className="flex-1 overflow-y-auto" style={{ padding: "var(--space-md)" }}>
                  <MarkdownRenderer content={resp.content} />
                </div>

                {/* Vote buttons */}
                <div className="flex justify-center gap-2" style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px var(--space-sm)" }}>
                  <button
                    className="btn-press"
                    style={{
                      padding: "5px 14px",
                      fontSize: "var(--font-size-xs)",
                      fontWeight: 500,
                      borderRadius: "var(--radius-pill)",
                      border: "1px solid var(--color-success-muted)",
                      background: "var(--color-success-muted)",
                      color: "var(--color-success)",
                      cursor: votedFor !== null ? "default" : "pointer",
                      transition: "all 200ms var(--ease-expo)",
                      ...(votedFor === resp.model ? { outline: "2px solid var(--color-connected)", outlineOffset: 1 } : {}),
                    }}
                    aria-label={`Prefer ${resp.model} response`}
                    disabled={votedFor !== null}
                    onClick={() => {
                      setVotedFor(resp.model);
                      const others = responses.filter((r) => r.model !== resp.model);
                      for (const other of others) {
                        void persistVote({
                          prompt,
                          winner: resp.model,
                          loser: other.model,
                          isTie: false,
                          timestamp: Date.now(),
                        });
                      }
                    }}
                  >
                    {votedFor === resp.model ? "Preferred" : "Better"}
                  </button>
                  <button
                    className="btn-press"
                    style={{
                      padding: "5px 14px",
                      fontSize: "var(--font-size-xs)",
                      fontWeight: 500,
                      borderRadius: "var(--radius-pill)",
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-2)",
                      color: "var(--color-text-secondary)",
                      cursor: votedFor !== null ? "default" : "pointer",
                      transition: "all 200ms var(--ease-expo)",
                    }}
                    aria-label="Responses are equal"
                    disabled={votedFor !== null}
                    onClick={() => {
                      setVotedFor("tie");
                      for (let j = 0; j < responses.length - 1; j++) {
                        void persistVote({
                          prompt,
                          winner: responses[j]!.model,
                          loser: responses[j + 1]!.model,
                          isTie: true,
                          timestamp: Date.now(),
                        });
                      }
                    }}
                  >
                    Tie
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
