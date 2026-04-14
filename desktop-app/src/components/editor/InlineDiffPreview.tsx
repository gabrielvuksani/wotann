/**
 * InlineDiffPreview -- Shows agent-proposed code changes as inline decorations in Monaco.
 * Tab = accept all changes, Cmd+Right = accept next word, Esc = dismiss.
 * Works alongside InlineSuggestions (FIM ghost text) without conflict.
 *
 * This component manages Monaco decorations directly via the editor API.
 * It marks the original range with a deletion style (red strikethrough),
 * shows proposed lines as green ghost-text decorations below, and renders
 * a status bar at the bottom with keyboard shortcut hints.
 *
 * Integration point: EditorPanel dispatches DiffProposal objects via
 * custom event or state; this component receives them as props.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

// ---- Public Types --------------------------------------------------------

/** A single proposed code change from the agent. All fields are readonly. */
export interface DiffProposal {
  readonly filePath: string;
  /** 1-based start line of the region being replaced. */
  readonly startLine: number;
  /** 1-based end line of the region being replaced (inclusive). */
  readonly endLine: number;
  readonly originalContent: string;
  readonly proposedContent: string;
  readonly description?: string;
}

// ---- Internal Types (Monaco narrowing) -----------------------------------

/** Monaco editor instance type, derived from @monaco-editor/react OnMount. */
type MonacoEditor = Parameters<OnMount>[0];

/** Monaco decoration type used by deltaDecorations. */
type DecorationEntry = editor.IModelDeltaDecoration;

// ---- Component Props -----------------------------------------------------

interface InlineDiffPreviewProps {
  /** The Monaco editor instance. Passed as the generic Parameters<OnMount>[0]. */
  readonly editor: MonacoEditor | null;
  /** The current diff proposal to preview, or null when none is active. */
  readonly proposal: DiffProposal | null;
  /** Called when the user accepts the proposal (Tab). */
  readonly onAccept: (proposal: DiffProposal) => void;
  /** Called when the user dismisses the proposal (Esc). */
  readonly onDismiss: () => void;
}

// ---- Constants -----------------------------------------------------------

/** Monaco KeyCode values used for keyboard interception. */
const KEY_TAB = 2;
const KEY_ESCAPE = 9;

/** Maximum column value to cover a whole line in a range. */
const MAX_COLUMN = 1000;

// ---- Decoration Builders -------------------------------------------------

function buildDeletionDecoration(
  startLine: number,
  endLine: number,
): DecorationEntry {
  return {
    range: {
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: MAX_COLUMN,
    },
    options: {
      isWholeLine: true,
      className: "wotann-diff-deletion",
      glyphMarginClassName: "wotann-diff-glyph-delete",
      overviewRuler: { color: "rgba(239, 68, 68, 0.5)", position: 1 },
    },
  };
}

function buildHintDecoration(
  endLine: number,
  description: string | undefined,
): DecorationEntry {
  return {
    range: {
      startLineNumber: endLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: 1,
    },
    options: {
      after: {
        content: ` // ${description ?? "Agent suggestion"} [Tab to accept, Esc to dismiss]`,
        inlineClassName: "wotann-diff-hint",
      },
    },
  };
}

function buildAdditionDecorations(
  endLine: number,
  proposedLines: readonly string[],
): readonly DecorationEntry[] {
  return proposedLines.map((line, i) => ({
    range: {
      startLineNumber: endLine + i,
      startColumn: 1,
      endLineNumber: endLine + i,
      endColumn: 1,
    },
    options: {
      after: {
        content: line,
        inlineClassName: "wotann-diff-addition",
      },
    },
  }));
}

function buildAllDecorations(proposal: DiffProposal): readonly DecorationEntry[] {
  const proposedLines = proposal.proposedContent.split("\n");
  return [
    buildDeletionDecoration(proposal.startLine, proposal.endLine),
    buildHintDecoration(proposal.endLine, proposal.description),
    ...buildAdditionDecorations(proposal.endLine, proposedLines),
  ];
}

// ---- Component -----------------------------------------------------------

export function InlineDiffPreview({
  editor,
  proposal,
  onAccept,
  onDismiss,
}: InlineDiffPreviewProps) {
  const decorationsRef = useRef<string[]>([]);
  const [accepted, setAccepted] = useState(false);

  // Reset accepted state when a new proposal arrives
  useEffect(() => {
    setAccepted(false);
  }, [proposal]);

  // Stable callback to clear all active decorations
  const clearDecorations = useCallback(() => {
    if (editor && decorationsRef.current.length > 0) {
      decorationsRef.current = editor.deltaDecorations(
        decorationsRef.current,
        [],
      );
    }
  }, [editor]);

  // Apply decorations when proposal changes
  useEffect(() => {
    if (!editor || !proposal) {
      clearDecorations();
      return;
    }

    // Build and apply decorations
    const decorations = buildAllDecorations(proposal);
    decorationsRef.current = editor.deltaDecorations(
      decorationsRef.current,
      // readonly -> mutable cast required by Monaco's deltaDecorations signature
      decorations as DecorationEntry[],
    );

    // Register keyboard handlers for Tab (accept) and Escape (dismiss)
    const keyDisposable = editor.onKeyDown(
      (e: {
        readonly keyCode: number;
        preventDefault: () => void;
        stopPropagation: () => void;
      }) => {
        if (e.keyCode === KEY_TAB) {
          e.preventDefault();
          e.stopPropagation();
          setAccepted(true);
          onAccept(proposal);
          clearDecorations();
        }

        if (e.keyCode === KEY_ESCAPE) {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
          clearDecorations();
        }
      },
    );

    return () => {
      keyDisposable.dispose();
      clearDecorations();
    };
  }, [editor, proposal, onAccept, onDismiss, clearDecorations]);

  // Nothing to render when no active proposal or already accepted
  if (!proposal || accepted) return null;

  // Status bar with keyboard shortcut hints
  const lineCount = proposal.endLine - proposal.startLine + 1;
  const summary = proposal.description ?? `${lineCount} line${lineCount === 1 ? "" : "s"} changed`;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "4px 12px",
        background: "rgba(10, 132, 255, 0.1)",
        borderTop: "1px solid rgba(10, 132, 255, 0.2)",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        fontSize: "11px",
        color: "var(--text-secondary)",
        zIndex: 10,
      }}
      role="status"
      aria-label="Agent diff preview active"
    >
      <span style={{ fontWeight: 600, color: "var(--color-primary)" }}>
        Agent Diff
      </span>
      <span>{summary}</span>
      <div style={{ flex: 1 }} />
      <kbd style={kbdStyle}>Tab</kbd>
      <span>Accept</span>
      <kbd style={kbdStyle}>Esc</kbd>
      <span>Dismiss</span>
    </div>
  );
}

/** Shared style for keyboard shortcut badges in the status bar. */
const kbdStyle: React.CSSProperties = {
  padding: "1px 4px",
  background: "var(--surface-2)",
  borderRadius: "3px",
  fontSize: "10px",
};
