/**
 * V9 SB-07 dual-auth mode tests.
 *
 * Covers:
 *   - detectIntendedAuthMode happy paths for each scenario
 *   - bannerTextForMode returns distinct strings per mode
 *   - login refuses business mode with only OAuth creds
 *   - login persists config with correct perms (0600)
 *
 * Quality bars honoured:
 *   - QB#13 env-guard friendly: tests pass env snapshots, never mutate
 *     real process.env outside vi.stubEnv.
 *   - QB#7 per-call state: each test creates its own tmp dir.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import {
  detectIntendedAuthMode,
  bannerTextForMode,
  bannerLabelForMode,
  bannerToneForMode,
  refuseReasonForMode,
  createAuthModeConfig,
  type AuthMode,
} from "../../src/auth/auth-mode.js";
import {
  authModeFromCliArg,
  checkAuthModeGate,
  persistAuthModeConfig,
} from "../../src/auth/login.js";

describe("detectIntendedAuthMode", () => {
  it("returns personal-oauth when invocation is explicitly personal", () => {
    expect(
      detectIntendedAuthMode({
        hasClaudeCliCreds: false,
        hasAnthropicApiKey: false,
        userInvocation: "personal",
      }),
    ).toBe("personal-oauth");
    // Even when both creds present — the explicit user choice wins.
    expect(
      detectIntendedAuthMode({
        hasClaudeCliCreds: true,
        hasAnthropicApiKey: true,
        userInvocation: "personal",
      }),
    ).toBe("personal-oauth");
  });

  it("returns business-api-key when invocation is explicitly business", () => {
    expect(
      detectIntendedAuthMode({
        hasClaudeCliCreds: true,
        hasAnthropicApiKey: false,
        userInvocation: "business",
      }),
    ).toBe("business-api-key");
  });

  it("infers business-api-key when only API key is present and invocation is unknown", () => {
    expect(
      detectIntendedAuthMode({
        hasClaudeCliCreds: false,
        hasAnthropicApiKey: true,
        userInvocation: "unknown",
      }),
    ).toBe("business-api-key");
  });

  it("infers personal-oauth when only CC creds are present and invocation is unknown", () => {
    expect(
      detectIntendedAuthMode({
        hasClaudeCliCreds: true,
        hasAnthropicApiKey: false,
        userInvocation: "unknown",
      }),
    ).toBe("personal-oauth");
  });

  it("returns null when both creds present and invocation unknown (genuinely ambiguous)", () => {
    expect(
      detectIntendedAuthMode({
        hasClaudeCliCreds: true,
        hasAnthropicApiKey: true,
        userInvocation: "unknown",
      }),
    ).toBeNull();
  });

  it("returns null when no creds present and invocation unknown (caller must guide login)", () => {
    expect(
      detectIntendedAuthMode({
        hasClaudeCliCreds: false,
        hasAnthropicApiKey: false,
        userInvocation: "unknown",
      }),
    ).toBeNull();
  });
});

describe("bannerTextForMode", () => {
  it("returns distinct strings per mode", () => {
    const personal = bannerTextForMode("personal-oauth");
    const business = bannerTextForMode("business-api-key");
    expect(personal).not.toEqual(business);
    expect(personal.length).toBeGreaterThan(0);
    expect(business.length).toBeGreaterThan(0);
  });

  it("personal-oauth banner mentions personal use only and the policy basis", () => {
    const text = bannerTextForMode("personal-oauth");
    expect(text.toLowerCase()).toContain("personal");
    // Policy reference — must mention Claude Code (the credential
    // holder) so the user knows why this mode is restricted. We
    // accept either "claude code" or "claude-code" since the copy
    // uses both forms (product name vs CLI binary).
    const lower = text.toLowerCase();
    expect(lower.includes("claude code") || lower.includes("claude-code")).toBe(true);
  });

  it("business-api-key banner mentions API key and TOS compliance", () => {
    const text = bannerTextForMode("business-api-key");
    expect(text.toLowerCase()).toContain("api key");
    expect(text.toLowerCase()).toContain("tos");
  });

  it("each mode has a distinct label and tone", () => {
    expect(bannerLabelForMode("personal-oauth")).not.toEqual(
      bannerLabelForMode("business-api-key"),
    );
    expect(bannerToneForMode("personal-oauth")).toBe("yellow");
    expect(bannerToneForMode("business-api-key")).toBe("green");
  });
});

describe("refuseReasonForMode", () => {
  it("returns null when business mode has API key", () => {
    expect(
      refuseReasonForMode({
        mode: "business-api-key",
        hasClaudeCliCreds: false,
        hasAnthropicApiKey: true,
      }),
    ).toBeNull();
  });

  it("returns refusal reason when business mode has only OAuth creds", () => {
    const reason = refuseReasonForMode({
      mode: "business-api-key",
      hasClaudeCliCreds: true,
      hasAnthropicApiKey: false,
    });
    expect(reason).not.toBeNull();
    expect(reason!.toLowerCase()).toContain("anthropic_api_key");
    expect(reason!).toContain("2026-01-09");
  });

  it("returns null for personal mode regardless of cred combo", () => {
    for (const hasCc of [true, false]) {
      for (const hasApi of [true, false]) {
        expect(
          refuseReasonForMode({
            mode: "personal-oauth",
            hasClaudeCliCreds: hasCc,
            hasAnthropicApiKey: hasApi,
          }),
        ).toBeNull();
      }
    }
  });
});

describe("authModeFromCliArg", () => {
  it("maps personal -> personal-oauth", () => {
    expect(authModeFromCliArg("personal")).toBe<AuthMode>("personal-oauth");
  });
  it("maps business -> business-api-key", () => {
    expect(authModeFromCliArg("business")).toBe<AuthMode>("business-api-key");
  });
});

describe("checkAuthModeGate", () => {
  it("refuses business mode with only OAuth creds (no API key)", () => {
    // We can't easily fake `hasClaudeCliCreds()` (it reads ~/.claude),
    // but we *can* control hasAnthropicApiKey by passing an empty env
    // snapshot. The refusal hits whenever business mode + no API key
    // — which is exactly the policy-rejected combo.
    const result = checkAuthModeGate({
      mode: "business-api-key",
      env: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("ANTHROPIC_API_KEY");
    }
  });

  it("admits business mode with API key set", () => {
    const result = checkAuthModeGate({
      mode: "business-api-key",
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
    });
    expect(result.ok).toBe(true);
  });

  it("admits personal mode regardless of API key presence", () => {
    expect(checkAuthModeGate({ mode: "personal-oauth", env: {} }).ok).toBe(true);
    expect(
      checkAuthModeGate({
        mode: "personal-oauth",
        env: { ANTHROPIC_API_KEY: "sk-ant-x" },
      }).ok,
    ).toBe(true);
  });

  it("ignores empty-string API key (treated as unset)", () => {
    const result = checkAuthModeGate({
      mode: "business-api-key",
      env: { ANTHROPIC_API_KEY: "   " },
    });
    expect(result.ok).toBe(false);
  });
});

describe("persistAuthModeConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wotann-auth-mode-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the config JSON to the given path", () => {
    const target = join(tmpDir, "auth-mode.json");
    const cfg = createAuthModeConfig({
      mode: "business-api-key",
      userAcknowledgedTos: true,
      setAt: 1_700_000_000_000,
    });
    const written = persistAuthModeConfig(cfg, target);
    expect(written).toBe(target);
    expect(existsSync(target)).toBe(true);

    const loaded = JSON.parse(readFileSync(target, "utf-8"));
    expect(loaded.mode).toBe("business-api-key");
    expect(loaded.userAcknowledgedTos).toBe(true);
    expect(loaded.setAt).toBe(1_700_000_000_000);
  });

  it("creates the parent directory when missing", () => {
    const nested = join(tmpDir, "deep", "nested", "auth-mode.json");
    const cfg = createAuthModeConfig({
      mode: "personal-oauth",
      userAcknowledgedTos: true,
    });
    persistAuthModeConfig(cfg, nested);
    expect(existsSync(nested)).toBe(true);
  });

  it("persists with mode-0600 perms (Unix only)", () => {
    if (platform() === "win32") {
      // Windows POSIX-mode bits are not meaningful — skip.
      return;
    }
    const target = join(tmpDir, "auth-mode.json");
    const cfg = createAuthModeConfig({
      mode: "business-api-key",
      userAcknowledgedTos: true,
    });
    persistAuthModeConfig(cfg, target);
    const stat = statSync(target);
    // Mask out the file-type bits — only check the permission bits.
    // 0o600 = user rw only. Tests fail if the perms are looser
    // (e.g. 0o644 from a default umask).
    const perms = stat.mode & 0o777;
    expect(perms).toBe(0o600);
  });

  it("re-tightens perms when overwriting an existing file", () => {
    if (platform() === "win32") return;
    const target = join(tmpDir, "auth-mode.json");
    // First write with 0600.
    persistAuthModeConfig(
      createAuthModeConfig({ mode: "personal-oauth", userAcknowledgedTos: true }),
      target,
    );
    // Loosen perms to simulate an attacker / accidental chmod.
    const { chmodSync } = require("node:fs") as typeof import("node:fs");
    chmodSync(target, 0o644);
    expect(statSync(target).mode & 0o777).toBe(0o644);
    // Re-persist — the helper must restore 0600.
    persistAuthModeConfig(
      createAuthModeConfig({ mode: "business-api-key", userAcknowledgedTos: true }),
      target,
    );
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});

describe("createAuthModeConfig", () => {
  it("defaults setAt to current time", () => {
    const before = Date.now();
    const cfg = createAuthModeConfig({
      mode: "personal-oauth",
      userAcknowledgedTos: false,
    });
    const after = Date.now();
    expect(cfg.setAt).toBeGreaterThanOrEqual(before);
    expect(cfg.setAt).toBeLessThanOrEqual(after);
  });

  it("preserves explicit setAt", () => {
    const cfg = createAuthModeConfig({
      mode: "business-api-key",
      userAcknowledgedTos: true,
      setAt: 42,
    });
    expect(cfg.setAt).toBe(42);
  });

  it("returns immutable shape (readonly type contract)", () => {
    const cfg = createAuthModeConfig({
      mode: "personal-oauth",
      userAcknowledgedTos: true,
    });
    // The TypeScript readonly check is compile-time only, but we can
    // assert the shape of returned object matches the contract.
    expect(Object.keys(cfg).sort()).toEqual(["mode", "setAt", "userAcknowledgedTos"]);
  });
});
