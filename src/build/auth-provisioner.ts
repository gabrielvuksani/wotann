/**
 * Auth provisioner — V9 Tier 9 authentication wiring.
 *
 * Emits a plan for adding authentication to a scaffolded project.
 * Lucia is the zero-cloud default; Clerk, Supabase Auth, Auth.js, and
 * WorkOS are available via progressively-disclosed skill packs.
 *
 * The provisioner returns serializable strings (no disk I/O), so
 * callers (CLI, MCP server, tests) can assert exact contents. Skill
 * packs are referenced by name only — the plan says "load skill
 * pack-<id>" and the CLI layer decides when to load it. This keeps
 * the provisioner small and lets skills evolve independently.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest refusal: unknown provider ids return
 *    `{ ok: false, error: "unknown auth provider: ..." }`.
 *  - QB #7 per-call state: pure function; no caches.
 *  - QB #13 env guard: zero process.env reads.
 *  - QB #14 commit-claim verification: `requiresSkill` is true iff
 *    the provider needs a skill pack to materialize; tests enforce it.
 */

// ═══ Types ═════════════════════════════════════════════════════════════

export type AuthProvider = "lucia" | "clerk" | "supabase-auth" | "auth-js" | "workos";

export interface AuthProvisionerInput {
  /** Raw product spec text. */
  readonly spec: string;
  /** Optional explicit pick (--auth=<id>). */
  readonly pick?: AuthProvider;
}

export interface AuthProvisionPlan {
  readonly provider: AuthProvider;
  /** Was the pick spec-signal-driven or the default? */
  readonly matched: boolean;
  /** Lucia is zero-cloud; all others need a skill pack to materialize. */
  readonly requiresSkill: boolean;
  /** Skill pack id to load; empty when requiresSkill is false. */
  readonly skillId: string;
  /** `src/auth/config.ts` contents. */
  readonly authConfig: string;
  /** Env vars the app will read (names only — never values). */
  readonly envVars: readonly string[];
  /** Post-install hints printed by CLI. */
  readonly notes: readonly string[];
}

export type AuthProvisionResult =
  | { readonly ok: true; readonly plan: AuthProvisionPlan }
  | { readonly ok: false; readonly error: string };

// ═══ Registry ══════════════════════════════════════════════════════════

const PROVIDER_IDS: readonly AuthProvider[] = [
  "lucia",
  "clerk",
  "supabase-auth",
  "auth-js",
  "workos",
];

const SPEC_SIGNALS: Record<AuthProvider, readonly string[]> = {
  lucia: ["lucia", "zero cloud", "self hosted", "self-hosted auth", "own auth"],
  clerk: ["clerk", "managed auth", "clerk dev", "clerk.com"],
  "supabase-auth": ["supabase auth", "supabase authentication", "gotrue"],
  "auth-js": ["auth.js", "next-auth", "authjs"],
  workos: ["workos", "sso", "single sign on", "single sign-on", "saml", "enterprise auth"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function selectAuth(input: AuthProvisionerInput): { id: AuthProvider; matched: boolean } {
  if (input.pick !== undefined) {
    return { id: input.pick, matched: true };
  }
  const spec = normalize(input.spec ?? "");
  let best: { id: AuthProvider; score: number } = { id: "lucia", score: 0 };
  for (const id of PROVIDER_IDS) {
    let s = 0;
    for (const sig of SPEC_SIGNALS[id]) {
      if (spec.includes(sig)) s += sig.length;
    }
    if (s > best.score) best = { id, score: s };
  }
  if (best.score === 0) {
    return { id: "lucia", matched: false };
  }
  return { id: best.id, matched: true };
}

// ═══ Emitters ══════════════════════════════════════════════════════════

function configFor(provider: AuthProvider): string {
  switch (provider) {
    case "lucia":
      return `/**
 * Auth config — Lucia (zero-cloud, self-hosted).
 * Sessions are stored in the same DB as the application.
 */
import { Lucia } from "lucia";
import { adapter } from "./adapter";

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: { secure: true, sameSite: "lax" },
  },
  getUserAttributes: (attrs) => ({ email: attrs.email }),
});

export type Auth = typeof lucia;
`;
    case "clerk":
      return `/**
 * Auth config — Clerk.
 * Requires @clerk/nextjs or @clerk/clerk-react installed by skill pack.
 */
export const clerkConfig = {
  publishableKey: "<env:CLERK_PUBLISHABLE_KEY>",
  secretKey: "<env:CLERK_SECRET_KEY>",
};
`;
    case "supabase-auth":
      return `/**
 * Auth config — Supabase Auth (GoTrue).
 * Pairs with the Supabase DB provider.
 */
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  "<env:SUPABASE_URL>",
  "<env:SUPABASE_ANON_KEY>",
);
`;
    case "auth-js":
      return `/**
 * Auth config — Auth.js (formerly NextAuth.js).
 * Requires @auth/core installed by skill pack.
 */
import { Auth } from "@auth/core";

export const authConfig = {
  providers: [],
  session: { strategy: "database" as const },
};
`;
    case "workos":
      return `/**
 * Auth config — WorkOS (SSO / enterprise).
 * Requires @workos-inc/node installed by skill pack.
 */
import { WorkOS } from "@workos-inc/node";

export const workos = new WorkOS("<env:WORKOS_API_KEY>", {
  clientId: "<env:WORKOS_CLIENT_ID>",
});
`;
  }
}

function envVarsFor(provider: AuthProvider): readonly string[] {
  switch (provider) {
    case "lucia":
      return [];
    case "clerk":
      return ["CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"];
    case "supabase-auth":
      return ["SUPABASE_URL", "SUPABASE_ANON_KEY"];
    case "auth-js":
      return ["AUTH_SECRET"];
    case "workos":
      return ["WORKOS_API_KEY", "WORKOS_CLIENT_ID"];
  }
}

function notesFor(provider: AuthProvider): readonly string[] {
  switch (provider) {
    case "lucia":
      return [
        "Lucia is self-hosted: sessions live in your app DB.",
        "Run `pnpm drizzle-kit push` to apply the session table.",
      ];
    case "clerk":
      return [
        "Load skill: wotann skills load pack-clerk-auth",
        "Sign up at clerk.com and set env vars in .env.local.",
      ];
    case "supabase-auth":
      return [
        "Load skill: wotann skills load pack-supabase-auth",
        "Ensure your DB provider is set to `supabase` for RLS to work.",
      ];
    case "auth-js":
      return [
        "Load skill: wotann skills load pack-auth-js",
        "Generate AUTH_SECRET with `openssl rand -base64 32`.",
      ];
    case "workos":
      return [
        "Load skill: wotann skills load pack-workos-sso",
        "Configure your SSO connection in the WorkOS dashboard.",
      ];
  }
}

function skillIdFor(provider: AuthProvider): string {
  switch (provider) {
    case "lucia":
      return "";
    case "clerk":
      return "pack-clerk-auth";
    case "supabase-auth":
      return "pack-supabase-auth";
    case "auth-js":
      return "pack-auth-js";
    case "workos":
      return "pack-workos-sso";
  }
}

// ═══ Entry point ═══════════════════════════════════════════════════════

/** Build an auth provision plan. Pure function — safe to call in tests. */
export function provisionAuth(input: AuthProvisionerInput): AuthProvisionResult {
  if (input.pick !== undefined && !PROVIDER_IDS.includes(input.pick)) {
    return { ok: false, error: `unknown auth provider: ${input.pick}` };
  }
  const picked = selectAuth(input);
  const requiresSkill = picked.id !== "lucia";
  const plan: AuthProvisionPlan = {
    provider: picked.id,
    matched: picked.matched,
    requiresSkill,
    skillId: skillIdFor(picked.id),
    authConfig: configFor(picked.id),
    envVars: envVarsFor(picked.id),
    notes: notesFor(picked.id),
  };
  return { ok: true, plan };
}

/** Enumerate all auth provider ids. */
export function listAuthProviders(): readonly AuthProvider[] {
  return PROVIDER_IDS;
}
