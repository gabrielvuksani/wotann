/**
 * V9 Tier 9 — `wotann deploy --to=<target>` CLI command tests.
 *
 * Coverage:
 *   - Plan-only default returns the deploy plan without writing files.
 *   - emit=true writes the manifest files into the project tree.
 *   - Refuses to overwrite without --force.
 *   - Invalid target refused honestly.
 *   - Non-existent projectDir refused.
 *   - Derives projectName from package.json when present, else from
 *     directory basename.
 *   - parseDeployTarget narrows strings to typed targets.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runDeployCommand,
  parseDeployTarget,
} from "../../src/cli/commands/deploy.js";

let workRoot: string;
let projectDir: string;

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), "wotann-deploy-cli-"));
  projectDir = join(workRoot, "app");
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(workRoot)) rmSync(workRoot, { recursive: true, force: true });
});

describe("runDeployCommand: plan-only default", () => {
  it("returns a plan without writing files", async () => {
    const r = await runDeployCommand({
      to: "cloudflare-pages",
      projectDir,
      projectName: "testapp",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.target).toBe("cloudflare-pages");
    expect(r.emitted).toEqual([]);
    // No files created in projectDir.
    expect(existsSync(join(projectDir, "wrangler.toml"))).toBe(false);
    expect(r.commands.length).toBeGreaterThan(0);
  });
});

describe("runDeployCommand: emission", () => {
  it("writes wrangler.toml + workflow when --to=cloudflare-pages --emit", async () => {
    const r = await runDeployCommand({
      to: "cloudflare-pages",
      projectDir,
      projectName: "testapp",
      emit: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(existsSync(join(projectDir, "wrangler.toml"))).toBe(true);
    expect(
      existsSync(join(projectDir, ".github", "workflows", "deploy.yml")),
    ).toBe(true);

    const wrangler = readFileSync(join(projectDir, "wrangler.toml"), "utf-8");
    expect(wrangler).toContain('name = "testapp"');
  });

  it("refuses to overwrite existing manifest without --force", async () => {
    writeFileSync(join(projectDir, "wrangler.toml"), "# existing\n");
    const r = await runDeployCommand({
      to: "cloudflare-pages",
      projectDir,
      projectName: "testapp",
      emit: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("refusing to overwrite");
    expect(readFileSync(join(projectDir, "wrangler.toml"), "utf-8")).toBe(
      "# existing\n",
    );
  });

  it("overwrites with --force", async () => {
    writeFileSync(join(projectDir, "wrangler.toml"), "# existing\n");
    const r = await runDeployCommand({
      to: "cloudflare-pages",
      projectDir,
      projectName: "testapp",
      emit: true,
      force: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.emitted.length).toBeGreaterThan(0);
    const after = readFileSync(join(projectDir, "wrangler.toml"), "utf-8");
    expect(after).not.toBe("# existing\n");
  });
});

describe("runDeployCommand: honest refusals (QB #6)", () => {
  it("refuses unknown target", async () => {
    const r = await runDeployCommand({
      to: "aws-beanstalk" as unknown as "fly",
      projectDir,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("unknown deploy target");
  });

  it("refuses non-existent projectDir", async () => {
    const r = await runDeployCommand({
      to: "cloudflare-pages",
      projectDir: join(workRoot, "nope"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("does not exist");
  });

  it("refuses empty target string", async () => {
    const r = await runDeployCommand({
      to: "   " as unknown as "vercel",
      projectDir,
    });
    expect(r.ok).toBe(false);
  });
});

describe("runDeployCommand: project name derivation", () => {
  it("reads package.json .name when present", async () => {
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "derived-from-pkg" }),
    );
    const r = await runDeployCommand({
      to: "cloudflare-pages",
      projectDir,
      emit: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const toml = readFileSync(join(projectDir, "wrangler.toml"), "utf-8");
    expect(toml).toContain("derived-from-pkg");
  });

  it("falls back to directory basename when package.json missing", async () => {
    const r = await runDeployCommand({
      to: "cloudflare-pages",
      projectDir,
      emit: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const toml = readFileSync(join(projectDir, "wrangler.toml"), "utf-8");
    expect(toml).toContain('name = "app"');
  });
});

describe("parseDeployTarget", () => {
  it("narrows known targets", () => {
    expect(parseDeployTarget("cloudflare-pages")).toBe("cloudflare-pages");
    expect(parseDeployTarget("vercel")).toBe("vercel");
    expect(parseDeployTarget("fly")).toBe("fly");
    expect(parseDeployTarget("self-host")).toBe("self-host");
  });

  it("returns null for unknown", () => {
    expect(parseDeployTarget("aws")).toBeNull();
    expect(parseDeployTarget("")).toBeNull();
  });
});
