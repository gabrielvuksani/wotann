/**
 * Canvas seed set — registers the built-in canvases against the
 * canvas registry. Each canvas is pulled in via React.lazy so the
 * Workshop bundle stays small; a canvas only costs code once it is
 * actually mounted.
 *
 * Registering here (module top-level import side-effect) lets the
 * Workshop consumer stay agnostic of which canvases exist — it just
 * calls `getCanvas(type)` and React.Suspense handles the async
 * component resolve.
 *
 * Each canvas is wired up in its own subsequent commit so the repo
 * stays buildable at every commit boundary.
 */

// Intentionally empty until per-canvas commits register their types.

/** No exports — registration happens for side effect when canvases land. */
export {};
