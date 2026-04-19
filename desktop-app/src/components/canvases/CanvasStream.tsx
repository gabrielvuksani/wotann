/**
 * CanvasStream — take a string of agent output, extract every canvas
 * block, and render the matching canvas components interleaved with
 * the surrounding markdown residue.
 *
 * This is the only consumer that WorkshopView (or ChatView, later)
 * needs to mount. It handles:
 *   - Parsing via `parseCanvasBlocks` from canvas-registry.
 *   - Registry lookup per block.
 *   - React.Suspense fallback while a lazy canvas loads.
 *   - Graceful UnknownCanvas fallback when no renderer is registered.
 *   - A thin error boundary per block so a broken canvas never takes
 *     the whole stream down.
 *
 * Side-effect import of ./index.ts ensures the four seed canvases are
 * registered once, on first mount. Subsequent mounts reuse the
 * singleton registry.
 */

import {
  Component,
  Suspense,
  createElement,
  useMemo,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  getCanvas,
  parseCanvasBlocks,
  type CanvasBlock,
} from "../../lib/canvas-registry";
import { CanvasLoading, UnknownCanvas } from "./CanvasFallback";

// Register built-in canvases on first import. The module is a no-op
// beyond its side effects.
import "./index";

// ────────────────────────────────────────────────────────────
// Per-block error boundary
// ────────────────────────────────────────────────────────────

interface BoundaryProps {
  readonly blockId: string;
  readonly type: string;
  readonly children: ReactNode;
}

interface BoundaryState {
  readonly error: Error | null;
}

class CanvasErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(
      `[canvas:${this.props.type}] render error in block ${this.props.blockId}`,
      error,
      info,
    );
  }
  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          className="liquid-glass"
          data-glass-tier="subtle"
          style={{
            padding: "var(--space-md)",
            borderRadius: "var(--radius-md, 10px)",
            margin: "var(--space-sm) 0",
            color: "var(--color-error)",
          }}
          role="alert"
        >
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Canvas crashed: {this.props.type}
          </div>
          <div
            style={{
              fontSize: "var(--font-size-2xs)",
              color: "var(--color-text-muted)",
            }}
          >
            {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ────────────────────────────────────────────────────────────
// Main stream component
// ────────────────────────────────────────────────────────────

export interface CanvasStreamProps {
  /** Raw agent output to scan for canvas blocks. */
  readonly source: string;
  /**
   * Renderer for the markdown residue between canvases. Default is a
   * plain <pre> block so we never silently drop content — callers can
   * pass a real markdown renderer if they have one.
   */
  readonly renderResidue?: (residue: string, key: string) => ReactNode;
  /**
   * Prefix for the generated block ids so multiple streams (e.g.
   * multiple chat messages) do not collide. Default is "canvas".
   */
  readonly idPrefix?: string;
}

interface Segment {
  readonly kind: "text" | "block";
  readonly key: string;
  readonly content: string | CanvasBlock;
}

function buildSegments(
  source: string,
  blocks: readonly CanvasBlock[],
  idPrefix: string,
): readonly Segment[] {
  if (blocks.length === 0) {
    return source
      ? [{ kind: "text", key: `${idPrefix}-text-0`, content: source }]
      : [];
  }
  const segments: Segment[] = [];
  let cursor = 0;
  blocks.forEach((block, i) => {
    if (block.start > cursor) {
      const residue = source.slice(cursor, block.start);
      if (residue) {
        segments.push({
          kind: "text",
          key: `${idPrefix}-text-${i}`,
          content: residue,
        });
      }
    }
    segments.push({
      kind: "block",
      key: `${idPrefix}-block-${i}`,
      content: block,
    });
    cursor = block.end;
  });
  if (cursor < source.length) {
    const tail = source.slice(cursor);
    if (tail) {
      segments.push({
        kind: "text",
        key: `${idPrefix}-text-tail`,
        content: tail,
      });
    }
  }
  return segments;
}

export function CanvasStream({
  source,
  renderResidue,
  idPrefix = "canvas",
}: CanvasStreamProps) {
  const blocks = useMemo(() => parseCanvasBlocks(source), [source]);
  const segments = useMemo(
    () => buildSegments(source, blocks, idPrefix),
    [source, blocks, idPrefix],
  );

  // No canvas blocks — return null so the caller can keep rendering
  // markdown itself. We don't render anything when there's nothing
  // to interleave; the caller decides how to show the raw message.
  if (blocks.length === 0) return null;

  return (
    <div data-canvas-stream="true">
      {segments.map((seg) => {
        if (seg.kind === "text") {
          const residue = seg.content as string;
          if (renderResidue) return renderResidue(residue, seg.key);
          return (
            <pre
              key={seg.key}
              style={{
                margin: 0,
                padding: "var(--space-sm) 0",
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                fontSize: "inherit",
                color: "var(--color-text-secondary)",
                background: "transparent",
                border: "none",
              }}
            >
              {residue}
            </pre>
          );
        }
        const block = seg.content as CanvasBlock;
        const entry = getCanvas(block.type);
        if (!entry) {
          return (
            <UnknownCanvas
              key={seg.key}
              type={block.type}
              data={block.data}
            />
          );
        }
        return (
          <CanvasErrorBoundary
            key={seg.key}
            blockId={seg.key}
            type={block.type}
          >
            <Suspense fallback={<CanvasLoading label={entry.label} />}>
              {createElement(entry.component, {
                data: block.data,
                blockId: seg.key,
              })}
            </Suspense>
          </CanvasErrorBoundary>
        );
      })}
    </div>
  );
}
