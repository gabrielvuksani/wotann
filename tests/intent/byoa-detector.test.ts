/**
 * Tests for Bring Your Own Anthropic (BYOA) detection + validation.
 *
 * BYOA = end user supplies their own Anthropic API key
 * (from console.anthropic.com) instead of routing through a pooled
 * provider. The detector checks, in priority order:
 *   1. `ANTHROPIC_API_KEY` env var
 *   2. `~/.claude.json` or similar CLI config
 *
 * Safety bar: the *actual* key bytes must never appear in any
 * user-visible output, log line, or thrown error message. Only a
 * masked form `sk-ant-…<last4>` is allowed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getTierModel } from "../_helpers/model-tier.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectByoa,
  maskApiKey,
  validateByoaKey,
  ByoaKeyInvalidError,
  ByoaValidationUnreachableError,
  type ByoaEnv,
  type ByoaValidator,
} from "../../src/intent/byoa-detector.js";

describe("BYOA detector — Bring Your Own Anthropic", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "wotann-byoa-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe("detectByoa", () => {
    it("finds ANTHROPIC_API_KEY in env", () => {
      const env: ByoaEnv = {
        envVars: { ANTHROPIC_API_KEY: "sk-ant-api03-xyz0123456789abcd" },
        homeDir: tmpHome,
      };
      const result = detectByoa(env);
      expect(result.detected).toBe(true);
      expect(result.apiKey).toBe("sk-ant-api03-xyz0123456789abcd");
      expect(result.source).toBe("env-var");
    });

    it("finds ~/.claude.json when env var missing", () => {
      writeFileSync(
        join(tmpHome, ".claude.json"),
        JSON.stringify({
          anthropicApiKey: "sk-ant-api03-from-config-file-1234",
        }),
        "utf-8",
      );
      const env: ByoaEnv = { envVars: {}, homeDir: tmpHome };
      const result = detectByoa(env);
      expect(result.detected).toBe(true);
      expect(result.apiKey).toBe("sk-ant-api03-from-config-file-1234");
      expect(result.source).toBe("claude-cli-config");
    });

    it("prefers env var over config file", () => {
      writeFileSync(
        join(tmpHome, ".claude.json"),
        JSON.stringify({ anthropicApiKey: "sk-ant-file-key-xxxx" }),
        "utf-8",
      );
      const env: ByoaEnv = {
        envVars: { ANTHROPIC_API_KEY: "sk-ant-env-key-yyyy" },
        homeDir: tmpHome,
      };
      const result = detectByoa(env);
      expect(result.apiKey).toBe("sk-ant-env-key-yyyy");
      expect(result.source).toBe("env-var");
    });

    it("returns detected=false when neither source has a key", () => {
      const env: ByoaEnv = { envVars: {}, homeDir: tmpHome };
      const result = detectByoa(env);
      expect(result.detected).toBe(false);
      expect(result.apiKey).toBeUndefined();
      expect(result.source).toBe("none");
    });

    it("ignores malformed ~/.claude.json without throwing", () => {
      writeFileSync(join(tmpHome, ".claude.json"), "{not json", "utf-8");
      const env: ByoaEnv = { envVars: {}, homeDir: tmpHome };
      const result = detectByoa(env);
      expect(result.detected).toBe(false);
      expect(result.source).toBe("none");
    });

    it("ignores empty-string env var", () => {
      const env: ByoaEnv = {
        envVars: { ANTHROPIC_API_KEY: "" },
        homeDir: tmpHome,
      };
      const result = detectByoa(env);
      expect(result.detected).toBe(false);
    });
  });

  describe("maskApiKey", () => {
    it("shows prefix + last 4 chars", () => {
      const masked = maskApiKey("sk-ant-api03-abcdefghijklmnop");
      expect(masked).toBe("sk-ant-…mnop");
    });

    it("handles short keys safely (no substring leak)", () => {
      const masked = maskApiKey("abcd");
      expect(masked).not.toContain("abcd");
      expect(masked.length).toBeLessThanOrEqual("sk-ant-…****".length + 4);
    });

    it("never echoes the full key", () => {
      const secret = "sk-ant-api03-SECRET-DATA-NEVER-SEEN-12345";
      const masked = maskApiKey(secret);
      expect(masked).not.toContain("SECRET-DATA-NEVER-SEEN");
    });
  });

  describe("validateByoaKey", () => {
    it("returns success when validator responds 200", async () => {
      // PROVIDER-AGNOSTIC: model id is fixture data inside the validator
      // response body; the test asserts on `result.ok` and key masking,
      // not the model id itself.
      const validator: ByoaValidator = async () => ({
        status: 200,
        body: { data: [{ id: getTierModel("balanced").model }] },
      });
      const result = await validateByoaKey(
        "sk-ant-api03-good-key-aaaabbbb",
        validator,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.maskedKey).toBe("sk-ant-…bbbb");
      }
    });

    it("throws ByoaKeyInvalidError on 401, masks the key in the message", async () => {
      const validator: ByoaValidator = async () => ({
        status: 401,
        body: { error: { type: "authentication_error", message: "invalid x-api-key" } },
      });
      const secret = "sk-ant-api03-BAD-SECRET-KEY-wxyz";
      try {
        await validateByoaKey(secret, validator);
        expect.fail("expected ByoaKeyInvalidError");
      } catch (err) {
        expect(err).toBeInstanceOf(ByoaKeyInvalidError);
        const msg = (err as Error).message;
        expect(msg).not.toContain(secret);
        expect(msg).not.toContain("BAD-SECRET-KEY");
        expect(msg).toContain("sk-ant-…wxyz");
      }
    });

    it("throws ByoaValidationUnreachableError on network failure", async () => {
      const validator: ByoaValidator = async () => {
        throw new Error("ECONNREFUSED api.anthropic.com:443");
      };
      const secret = "sk-ant-api03-network-fail-qqqq";
      try {
        await validateByoaKey(secret, validator);
        expect.fail("expected ByoaValidationUnreachableError");
      } catch (err) {
        expect(err).toBeInstanceOf(ByoaValidationUnreachableError);
        const msg = (err as Error).message;
        expect(msg).not.toContain(secret);
        expect(msg).not.toContain("network-fail-qqqq");
      }
    });

    it("distinguishes invalid-key (401) from unreachable (network)", async () => {
      const invalidValidator: ByoaValidator = async () => ({
        status: 401,
        body: {},
      });
      const unreachableValidator: ByoaValidator = async () => {
        throw new Error("timeout");
      };
      let sawInvalid = false;
      let sawUnreachable = false;
      try {
        await validateByoaKey("sk-ant-test-1234", invalidValidator);
      } catch (err) {
        if (err instanceof ByoaKeyInvalidError) sawInvalid = true;
      }
      try {
        await validateByoaKey("sk-ant-test-5678", unreachableValidator);
      } catch (err) {
        if (err instanceof ByoaValidationUnreachableError) sawUnreachable = true;
      }
      expect(sawInvalid).toBe(true);
      expect(sawUnreachable).toBe(true);
    });

    it("surfaces non-401 API errors (5xx) as unreachable-ish", async () => {
      const validator: ByoaValidator = async () => ({
        status: 503,
        body: { error: "service unavailable" },
      });
      await expect(
        validateByoaKey("sk-ant-api03-503-test-aaaa", validator),
      ).rejects.toBeInstanceOf(ByoaValidationUnreachableError);
    });
  });

  describe("key-masking security posture", () => {
    it("detector never throws an error containing the full key", () => {
      const secret = "sk-ant-api03-DO-NOT-LEAK-ABCDEFGHIJ";
      writeFileSync(join(tmpHome, ".claude.json"), "not json at all", "utf-8");
      // force a parsing path — which should *not* throw
      const env: ByoaEnv = {
        envVars: { ANTHROPIC_API_KEY: secret },
        homeDir: tmpHome,
      };
      const result = detectByoa(env);
      expect(result.detected).toBe(true);
      expect(result.apiKey).toBe(secret);
      // Result should carry a masked form too so callers never touch apiKey for UI
      expect(result.masked).toBe("sk-ant-…GHIJ");
      expect(result.masked).not.toContain("DO-NOT-LEAK");
    });
  });
});
