/**
 * Scaffold registry — V9 Tier 9 core primitive.
 *
 * Given a product specification (free-form text), pick the best-fit
 * project scaffold from 4 blessed bases and emit a structured
 * description of what the scaffold materializes. The actual template
 * archives are external (docs/build-templates/*); this module is pure
 * routing + manifest emission and never touches disk.
 *
 * Four scaffolds (matches V9 §Tier-9):
 *   - nextjs-app-router  — server components + streaming, SSR default
 *   - hono-react-edge    — edge-first, minimal, sub-10ms cold start
 *   - astro-static       — content sites, zero JS by default
 *   - expo               — iOS + Android + web from one codebase
 *
 * Scoring is keyword + pattern based. Each scaffold contributes
 * positive signals (words that strongly suggest it) and a tie-break
 * prior. Specifications with no matches fall through to the documented
 * default (nextjs-app-router) — this is a positive default, not a
 * silent fallback, and is reflected in the result.matched === false
 * field so callers can surface the reason.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest refusal: empty/whitespace specs return
 *    `{ ok: false, error: "empty spec" }` rather than defaulting.
 *  - QB #7 per-call state: function-scoped scoring, no caches.
 *  - QB #13 env guard: zero process.env reads.
 *  - QB #14 commit-claim verification: `matched` reflects whether
 *    the pick was specification-driven (true) or the default (false).
 *  - QB #15 source-verified: keyword lists are exported so tests can
 *    grep them against the scoring path.
 */

// ═══ Types ═════════════════════════════════════════════════════════════

/** Canonical scaffold identifiers. Keep stable for registry consumers. */
export type ScaffoldId = "nextjs-app-router" | "hono-react-edge" | "astro-static" | "expo";

/** Immutable scaffold descriptor — serializable and test-friendly. */
export interface ScaffoldDescriptor {
  readonly id: ScaffoldId;
  /** Human-readable label for logs + TUI. */
  readonly label: string;
  /** One-line pitch for `wotann build --list`. */
  readonly summary: string;
  /** Root runtime runtime: node, deno, edge, rn. */
  readonly runtime: "node" | "edge" | "rn";
  /** Tie-break prior (higher = preferred on ties). */
  readonly prior: number;
  /** Positive keyword signals (lowercased). */
  readonly signals: readonly string[];
  /** Ordered list of top-level files the scaffold emits. */
  readonly files: readonly string[];
}

/** Per-scaffold scoring trace, for diagnostics and tests. */
export interface ScaffoldScore {
  readonly id: ScaffoldId;
  readonly score: number;
  readonly matchedSignals: readonly string[];
}

/** Emission plan: what files the registry would materialize. */
export interface EmissionPlan {
  readonly scaffoldId: ScaffoldId;
  /** Relative paths (POSIX) that will be written. */
  readonly files: readonly string[];
  /** Next-step commands to print. */
  readonly nextSteps: readonly string[];
}

/** Pure selection result. `matched=false` => fell through to default. */
export type ScaffoldSelection =
  | {
      readonly ok: true;
      readonly scaffold: ScaffoldDescriptor;
      readonly matched: boolean;
      readonly scores: readonly ScaffoldScore[];
      readonly spec: string;
    }
  | { readonly ok: false; readonly error: string };

// ═══ Registry data ═════════════════════════════════════════════════════

/**
 * Canonical scaffold list. Exported so tests can enforce the
 * "exactly four" invariant from MASTER_PLAN_V9 Tier 9.
 */
export const SCAFFOLDS: readonly ScaffoldDescriptor[] = [
  {
    id: "nextjs-app-router",
    label: "Next.js App Router",
    summary: "Full-stack React with server components, streaming, and edge/Node runtimes.",
    runtime: "node",
    prior: 3,
    signals: [
      "server component",
      "server components",
      "streaming",
      "rsc",
      "nextjs",
      "next.js",
      "app router",
      "full-stack",
      "fullstack",
      "saas",
      "dashboard",
      "admin panel",
      "stripe",
      "billing",
      "auth",
      "team collab",
      "team collaboration",
    ],
    files: [
      "package.json",
      "next.config.ts",
      "tsconfig.json",
      "app/layout.tsx",
      "app/page.tsx",
      "app/api/health/route.ts",
      ".gitignore",
      "README.md",
    ],
  },
  {
    id: "hono-react-edge",
    label: "Hono + React (edge)",
    summary: "Minimal edge-first app — Hono API + React SPA, sub-10ms cold start.",
    runtime: "edge",
    prior: 2,
    signals: [
      "edge",
      "edge runtime",
      "minimal",
      "lightweight",
      "tiny",
      "hono",
      "workers",
      "cloudflare workers",
      "cold start",
      "api only",
      "rest api",
      "json api",
    ],
    files: [
      "package.json",
      "wrangler.toml",
      "tsconfig.json",
      "src/index.tsx",
      "src/server.ts",
      "src/app.tsx",
      ".gitignore",
      "README.md",
    ],
  },
  {
    id: "astro-static",
    label: "Astro (static)",
    summary: "Content-first static site — zero JS by default, islands on demand.",
    runtime: "node",
    prior: 1,
    signals: [
      "static content",
      "content site",
      "blog",
      "marketing site",
      "landing page",
      "documentation site",
      "docs site",
      "astro",
      "zero js",
      "static export",
      "mdx",
    ],
    files: [
      "package.json",
      "astro.config.mjs",
      "tsconfig.json",
      "src/pages/index.astro",
      "src/layouts/Base.astro",
      ".gitignore",
      "README.md",
    ],
  },
  {
    id: "expo",
    label: "Expo (iOS + Android + Web)",
    summary: "Cross-platform mobile — React Native via Expo, single codebase.",
    runtime: "rn",
    prior: 0,
    signals: [
      "ios",
      "android",
      "mobile app",
      "react native",
      "expo",
      "cross-platform",
      "cross platform",
      "iphone",
      "phone app",
      "native",
    ],
    files: [
      "package.json",
      "app.json",
      "tsconfig.json",
      "App.tsx",
      "babel.config.js",
      ".gitignore",
      "README.md",
    ],
  },
];

/** Default scaffold when no signals match. Documented choice, not a silent fallback. */
export const DEFAULT_SCAFFOLD_ID: ScaffoldId = "nextjs-app-router";

// ═══ Scoring ═══════════════════════════════════════════════════════════

/** Normalize spec text for keyword matching. */
function normalizeSpec(spec: string): string {
  return spec.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Score a single scaffold against a normalized spec. Each matched
 * signal contributes `signal.length` points (weighted by specificity
 * — "react native" scores higher than "ios"). Prior breaks ties.
 */
function scoreScaffold(spec: string, scaffold: ScaffoldDescriptor): ScaffoldScore {
  const matched: string[] = [];
  let score = 0;
  for (const signal of scaffold.signals) {
    if (spec.includes(signal)) {
      matched.push(signal);
      score += signal.length;
    }
  }
  // Prior is in the decimal range so it only breaks ties — it never
  // outweighs a genuine signal match.
  score += scaffold.prior * 0.001;
  return { id: scaffold.id, score, matchedSignals: matched };
}

/**
 * Select the best-fit scaffold for a free-form specification.
 *
 * Pure function: (spec, overrides?) -> selection. `overrides.pick`
 * forces a specific scaffold (for CLI flag --scaffold=<id>), bypassing
 * the scorer but still returning the full trace for diagnostics.
 */
export function selectScaffold(
  spec: string,
  overrides: { readonly pick?: ScaffoldId } = {},
): ScaffoldSelection {
  if (typeof spec !== "string" || spec.trim().length === 0) {
    return { ok: false, error: "empty spec" };
  }

  const normalized = normalizeSpec(spec);
  const scores: readonly ScaffoldScore[] = SCAFFOLDS.map((s) => scoreScaffold(normalized, s));

  // Forced override: still compute scores for tracing, then override.
  if (overrides.pick !== undefined) {
    const forced = SCAFFOLDS.find((s) => s.id === overrides.pick);
    if (!forced) {
      return { ok: false, error: `unknown scaffold id: ${overrides.pick}` };
    }
    return { ok: true, scaffold: forced, matched: true, scores, spec: normalized };
  }

  // Pick the highest-scoring scaffold. If no scaffold got any signal
  // points (score < 0.01, i.e. only prior contribution), fall through
  // to the documented default and mark matched=false.
  const best = scores.reduce((acc, cur) => (cur.score > acc.score ? cur : acc), scores[0]!);
  const anyMatch = best.score >= 1; // a single 1-char signal would be > 1
  const pickedId = anyMatch ? best.id : DEFAULT_SCAFFOLD_ID;
  const scaffold = SCAFFOLDS.find((s) => s.id === pickedId);
  if (!scaffold) {
    // Defensive: this can only happen if SCAFFOLDS is mutated.
    return { ok: false, error: `registry missing scaffold ${pickedId}` };
  }
  return { ok: true, scaffold, matched: anyMatch, scores, spec: normalized };
}

// ═══ Emission planning ═════════════════════════════════════════════════

/**
 * Compute the file list and next-step hints for a selected scaffold.
 * Does NOT emit files — callers (CLI) own the write, so the function
 * remains referentially transparent and trivially testable.
 */
export function planEmission(selection: ScaffoldSelection): EmissionPlan | null {
  if (!selection.ok) return null;
  const scaffold = selection.scaffold;
  const nextSteps = buildNextSteps(scaffold.id);
  return {
    scaffoldId: scaffold.id,
    files: scaffold.files,
    nextSteps,
  };
}

/** Per-scaffold onboarding steps. Immutable lists — easy to assert. */
function buildNextSteps(id: ScaffoldId): readonly string[] {
  switch (id) {
    case "nextjs-app-router":
      return [
        "cd <project> && pnpm install",
        "pnpm run dev   # http://localhost:3000",
        "wotann deploy --to=cloudflare-pages",
      ];
    case "hono-react-edge":
      return [
        "cd <project> && pnpm install",
        "pnpm run dev   # http://localhost:8787",
        "wotann deploy --to=cloudflare-pages",
      ];
    case "astro-static":
      return [
        "cd <project> && pnpm install",
        "pnpm run dev   # http://localhost:4321",
        "wotann deploy --to=cloudflare-pages",
      ];
    case "expo":
      return [
        "cd <project> && pnpm install",
        "pnpm run ios     # open Expo Go on device",
        "wotann deploy --to=fly   # for any companion API",
      ];
  }
}

// ═══ Lookup helpers ════════════════════════════════════════════════════

/** Fetch a scaffold descriptor by id. Returns null on miss. */
export function getScaffold(id: ScaffoldId): ScaffoldDescriptor | null {
  return SCAFFOLDS.find((s) => s.id === id) ?? null;
}

/** Enumerate all scaffold ids in declaration order. */
export function listScaffoldIds(): readonly ScaffoldId[] {
  return SCAFFOLDS.map((s) => s.id);
}
