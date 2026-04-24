/**
 * V9 Tier 9 — auth-provisioner tests.
 *
 * Coverage:
 *   - 5 providers (Lucia default + Clerk/Supabase-Auth/Auth.js/WorkOS via skills).
 *   - Lucia is zero-cloud (requiresSkill=false, skillId="").
 *   - Other 4 providers require skill packs (requiresSkill=true, skillId!="").
 *   - Spec signals route correctly per V9 integration matrix.
 *   - Unknown forced pick is refused (QB #6).
 *   - Pure: same input -> same config strings.
 */

import { describe, expect, it } from "vitest";
import {
  provisionAuth,
  listAuthProviders,
  type AuthProvider,
} from "../../src/build/auth-provisioner.js";

describe("auth-provisioner: structure", () => {
  it("exposes exactly 5 providers in declared order", () => {
    expect(listAuthProviders()).toEqual([
      "lucia",
      "clerk",
      "supabase-auth",
      "auth-js",
      "workos",
    ]);
  });
});

describe("auth-provisioner: default and skill boundary", () => {
  it("defaults to Lucia (zero-cloud) when no signals match", () => {
    const r = provisionAuth({ spec: "random unrelated words" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("lucia");
    expect(r.plan.matched).toBe(false);
    expect(r.plan.requiresSkill).toBe(false);
    expect(r.plan.skillId).toBe("");
    expect(r.plan.envVars).toEqual([]);
  });

  it("Clerk picks trigger requiresSkill=true + named skill pack", () => {
    const r = provisionAuth({ spec: "use Clerk for managed auth" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("clerk");
    expect(r.plan.requiresSkill).toBe(true);
    expect(r.plan.skillId).toBe("pack-clerk-auth");
    expect(r.plan.envVars).toContain("CLERK_PUBLISHABLE_KEY");
  });

  it("WorkOS picks on SSO / enterprise keywords", () => {
    const r = provisionAuth({ spec: "enterprise auth with SSO SAML" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("workos");
    expect(r.plan.requiresSkill).toBe(true);
    expect(r.plan.skillId).toBe("pack-workos-sso");
  });

  it("Supabase Auth picks on explicit mention", () => {
    const r = provisionAuth({ spec: "use supabase auth gotrue" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("supabase-auth");
    expect(r.plan.skillId).toBe("pack-supabase-auth");
  });

  it("Auth.js picks on next-auth / authjs keywords", () => {
    const r = provisionAuth({ spec: "use next-auth for authentication" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.provider).toBe("auth-js");
    expect(r.plan.skillId).toBe("pack-auth-js");
  });

  it("every non-Lucia provider has a non-empty skillId", () => {
    for (const id of listAuthProviders()) {
      const r = provisionAuth({ spec: "any", pick: id });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      if (id === "lucia") {
        expect(r.plan.requiresSkill).toBe(false);
        expect(r.plan.skillId).toBe("");
      } else {
        expect(r.plan.requiresSkill).toBe(true);
        expect(r.plan.skillId.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("auth-provisioner: honest refusals (QB #6)", () => {
  it("refuses unknown provider id", () => {
    const r = provisionAuth({ spec: "any", pick: "firebase-auth" as AuthProvider });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("unknown auth provider");
  });
});

describe("auth-provisioner: purity", () => {
  it("same input -> byte-identical config", () => {
    const a = provisionAuth({ spec: "use clerk" });
    const b = provisionAuth({ spec: "use clerk" });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.plan.authConfig).toBe(b.plan.authConfig);
    expect(a.plan.envVars).toEqual(b.plan.envVars);
  });
});
