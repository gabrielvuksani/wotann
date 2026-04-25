/**
 * V9 Tier 9 — deploy-adapter tests.
 *
 * Coverage:
 *   - 4 targets (Cloudflare Pages default, Vercel, Fly, self-host).
 *   - Cloudflare emits wrangler.toml + GHA workflow.
 *   - Vercel emits vercel.json with optional custom domain.
 *   - Fly emits fly.toml + Dockerfile.
 *   - Self-host emits Caddyfile + systemd unit.
 *   - Project name slugifier matches V9 integration matrix examples.
 *   - Unknown target refused honestly (QB #6).
 *   - Runtime=edge routes to Cloudflare; runtime=rn routes to Fly.
 */

import { describe, expect, it } from "vitest";
import {
  adaptDeploy,
  listDeployTargets,
  projectSlug,
  type DeployTarget,
} from "../../src/build/deploy-adapter.js";

describe("deploy-adapter: structure", () => {
  it("exposes exactly 6 targets in declared order", () => {
    // V9 T12.20 added coolify + dokploy as deploy targets so the
    // self-host VPS adapters in src/build/deploy-targets/ are reachable.
    expect(listDeployTargets()).toEqual([
      "cloudflare-pages",
      "vercel",
      "fly",
      "self-host",
      "coolify",
      "dokploy",
    ]);
  });

  it("slugifier lowercases, replaces, trims, and falls back to 'app'", () => {
    expect(projectSlug("My Todo App!")).toBe("my-todo-app");
    expect(projectSlug("---")).toBe("app");
    expect(projectSlug("")).toBe("app");
    expect(projectSlug("already-slug")).toBe("already-slug");
  });
});

describe("deploy-adapter: target emissions", () => {
  it("Cloudflare emits wrangler.toml + .github workflow", () => {
    const r = adaptDeploy({ pick: "cloudflare-pages", projectName: "todo app" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.plan.files.map((f) => f.path);
    expect(names).toContain("wrangler.toml");
    expect(names).toContain(".github/workflows/deploy.yml");
    const wrangler = r.plan.files.find((f) => f.path === "wrangler.toml");
    expect(wrangler?.contents).toContain('name = "todo-app"');
    expect(r.plan.envVars).toContain("CLOUDFLARE_API_TOKEN");
  });

  it("Vercel emits vercel.json with optional custom domain", () => {
    const r = adaptDeploy({
      pick: "vercel",
      projectName: "blog",
      customDomain: "blog.example.com",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vercel = r.plan.files.find((f) => f.path === "vercel.json");
    expect(vercel).toBeDefined();
    const json = JSON.parse(vercel!.contents);
    expect(json.name).toBe("blog");
    expect(json.alias).toEqual(["blog.example.com"]);
  });

  it("Vercel omits alias when no customDomain given", () => {
    const r = adaptDeploy({ pick: "vercel", projectName: "blog" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vercel = r.plan.files.find((f) => f.path === "vercel.json");
    const json = JSON.parse(vercel!.contents);
    expect(json.alias).toBeUndefined();
  });

  it("Fly emits fly.toml + Dockerfile", () => {
    const r = adaptDeploy({ pick: "fly", projectName: "api" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.plan.files.map((f) => f.path);
    expect(names).toContain("fly.toml");
    expect(names).toContain("Dockerfile");
    const toml = r.plan.files.find((f) => f.path === "fly.toml");
    expect(toml?.contents).toContain('app = "api"');
  });

  it("self-host emits Caddyfile + systemd unit", () => {
    const r = adaptDeploy({
      pick: "self-host",
      projectName: "myapp",
      customDomain: "myapp.example.com",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const names = r.plan.files.map((f) => f.path);
    expect(names).toContain("deploy/Caddyfile");
    expect(names).toContain("deploy/myapp.service");
    const caddy = r.plan.files.find((f) => f.path === "deploy/Caddyfile");
    expect(caddy?.contents).toContain("myapp.example.com");
  });
});

describe("deploy-adapter: runtime-aware defaults", () => {
  it("edge runtime -> cloudflare-pages default", () => {
    const r = adaptDeploy({ scaffoldRuntime: "edge", projectName: "edge-app" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.target).toBe("cloudflare-pages");
  });

  it("rn runtime -> fly default (companion API)", () => {
    const r = adaptDeploy({ scaffoldRuntime: "rn", projectName: "mobile" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.target).toBe("fly");
  });

  it("node runtime -> cloudflare-pages default", () => {
    const r = adaptDeploy({ scaffoldRuntime: "node", projectName: "web" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.target).toBe("cloudflare-pages");
  });
});

describe("deploy-adapter: honest refusals (QB #6)", () => {
  it("refuses missing projectName", () => {
    const r = adaptDeploy({ projectName: "   " });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("projectName");
  });

  it("refuses unknown pick", () => {
    const r = adaptDeploy({
      pick: "aws-beanstalk" as DeployTarget,
      projectName: "x",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("unknown deploy target");
  });
});
