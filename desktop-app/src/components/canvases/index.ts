/**
 * Canvas seed set — registers the four built-in canvases against the
 * canvas registry. Each canvas is pulled in via React.lazy so the
 * Workshop bundle stays small; a canvas only costs code once it is
 * actually mounted.
 *
 * Registering here (module top-level import side-effect) lets the
 * Workshop consumer stay agnostic of which canvases exist — it just
 * calls `getCanvas(type)` and React.Suspense handles the async
 * component resolve.
 */

import { lazy } from "react";
import { registerCanvas } from "../../lib/canvas-registry";

// Each dynamic import() becomes its own Vite chunk. The paths use
// the explicit .tsx extension because `allowImportingTsExtensions`
// is on in tsconfig.app.json, keeping IDE jumps working. Vite strips
// the extension at build time, so the runtime fetches chunk files.

registerCanvas(
  "pr-review",
  lazy(() => import("./PRReviewCanvas")),
  "PR Review",
);

registerCanvas(
  "data-explorer",
  lazy(() => import("./DataExplorerCanvas")),
  "Data Explorer",
);

registerCanvas(
  "eval-comparison",
  lazy(() => import("./EvalComparisonCanvas")),
  "Eval Comparison",
);

registerCanvas(
  "memory-palace",
  lazy(() => import("./MemoryPalaceCanvas")),
  "Memory Palace",
);

/** No exports — registration happens for side effect. */
export {};
