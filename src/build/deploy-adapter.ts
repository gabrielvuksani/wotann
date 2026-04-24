/**
 * Deploy adapter — V9 Tier 9 deployment target selection.
 *
 * Emits a structured plan for deploying a scaffolded project to one
 * of four blessed targets (matches V9 §Tier-9):
 *
 *   - cloudflare-pages  — default (free tier, global edge, 500 builds/mo)
 *   - vercel            — fast DX, Next.js-optimized
 *   - fly               — long-lived containers, regions-near-users
 *   - self-host         — Caddy + systemd, user-owned infra
 *
 * The adapter returns deployment manifests (wrangler.toml, vercel.json,
 * fly.toml, or Caddyfile + systemd unit) as immutable strings. It does
 * NOT call any CLI or cloud API — the CLI shell owns shelling out to
 * wrangler / vercel / flyctl / rsync. This split keeps the adapter
 * trivially testable and cloud-free for test golden matrices.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest refusal: unknown targets return `{ ok: false, error }`.
 *  - QB #7 per-call state: pure function; no caches.
 *  - QB #13 env guard: zero process.env reads; secrets are threaded
 *    by callers as opaque names, never emitted into the manifest.
 *  - QB #14 commit-claim verification: the returned `target` is
 *    exactly what the selector chose; no post-hoc relabeling.
 *  - QB #15 source-verified: the set of emitted files is the single
 *    source of truth that tests enforce end-to-end.
 */

// ═══ Types ═════════════════════════════════════════════════════════════

export type DeployTarget = "cloudflare-pages" | "vercel" | "fly" | "self-host";

export type ScaffoldRuntime = "node" | "edge" | "rn";

export interface DeployAdapterInput {
  /** Scaffold runtime — affects default target (edge -> cloudflare). */
  readonly scaffoldRuntime?: ScaffoldRuntime;
  /** Optional explicit pick (--to=<id>). */
  readonly pick?: DeployTarget;
  /** Project name (lowercased, hyphenated) — lands in manifests. */
  readonly projectName: string;
  /** Optional custom domain (e.g. "app.example.com"). */
  readonly customDomain?: string;
}

export interface DeployFile {
  /** Relative POSIX path in the project tree. */
  readonly path: string;
  /** File contents — assumed UTF-8. */
  readonly contents: string;
}

export interface DeployPlan {
  readonly target: DeployTarget;
  /** Was the pick spec-driven or the default? */
  readonly matched: boolean;
  /** Manifests the caller should write into the project tree. */
  readonly files: readonly DeployFile[];
  /** Shell commands the CLI should suggest (never auto-executes). */
  readonly commands: readonly string[];
  /** Env vars the app will need at deploy time (names only). */
  readonly envVars: readonly string[];
  /** Post-deploy notes printed to the terminal. */
  readonly notes: readonly string[];
}

export type DeployAdapterResult =
  | { readonly ok: true; readonly plan: DeployPlan }
  | { readonly ok: false; readonly error: string };

// ═══ Registry ══════════════════════════════════════════════════════════

const TARGET_IDS: readonly DeployTarget[] = [
  "cloudflare-pages",
  "vercel",
  "fly",
  "self-host",
];

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length === 0 ? "app" : s;
}

function pickDefault(runtime?: ScaffoldRuntime): DeployTarget {
  if (runtime === "edge") return "cloudflare-pages";
  if (runtime === "rn") return "fly"; // RN mobile companion APIs usually want persistent backends
  return "cloudflare-pages";
}

// ═══ Emitters ══════════════════════════════════════════════════════════

function cloudflareFiles(projectName: string): readonly DeployFile[] {
  const name = slugify(projectName);
  const wranglerToml = `name = "${name}"
pages_build_output_dir = "./dist"
compatibility_date = "2026-01-01"
compatibility_flags = ["nodejs_compat"]

[[env.production.routes]]
pattern = "${name}.pages.dev"
zone_name = ""
`;
  const workflowYml = `# .github/workflows/deploy.yml — Cloudflare Pages via wrangler
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy ./dist --project-name=${name}
`;
  return [
    { path: "wrangler.toml", contents: wranglerToml },
    { path: ".github/workflows/deploy.yml", contents: workflowYml },
  ];
}

function vercelFiles(projectName: string, customDomain?: string): readonly DeployFile[] {
  const name = slugify(projectName);
  const vercelJson =
    JSON.stringify(
      {
        name,
        version: 2,
        framework: null,
        buildCommand: "pnpm run build",
        outputDirectory: "dist",
        regions: ["iad1"],
        ...(customDomain ? { alias: [customDomain] } : {}),
      },
      null,
      2,
    ) + "\n";
  return [{ path: "vercel.json", contents: vercelJson }];
}

function flyFiles(projectName: string): readonly DeployFile[] {
  const name = slugify(projectName);
  const flyToml = `# fly.toml — generated by wotann deploy
app = "${name}"
primary_region = "sea"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[services.concurrency]]
  type = "requests"
  hard_limit = 200
  soft_limit = 150
`;
  const dockerfile = `# Auto-generated. Edit to suit — wotann build writes this once.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/server.js"]
`;
  return [
    { path: "fly.toml", contents: flyToml },
    { path: "Dockerfile", contents: dockerfile },
  ];
}

function selfHostFiles(projectName: string, customDomain?: string): readonly DeployFile[] {
  const name = slugify(projectName);
  const host = customDomain ?? `${name}.local`;
  const caddyfile = `# Caddyfile — generated by wotann deploy --to=self-host
${host} {
  reverse_proxy localhost:3000
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000"
    X-Content-Type-Options "nosniff"
  }
}
`;
  const systemdUnit = `# /etc/systemd/system/${name}.service
[Unit]
Description=${name}
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/${name}
ExecStart=/usr/bin/node dist/server.js
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
User=${name}
Group=${name}

[Install]
WantedBy=multi-user.target
`;
  return [
    { path: "deploy/Caddyfile", contents: caddyfile },
    { path: `deploy/${name}.service`, contents: systemdUnit },
  ];
}

function commandsFor(target: DeployTarget, projectName: string): readonly string[] {
  const name = slugify(projectName);
  switch (target) {
    case "cloudflare-pages":
      return [
        "pnpm run build",
        `npx wrangler pages deploy ./dist --project-name=${name}`,
      ];
    case "vercel":
      return ["pnpm run build", "npx vercel --prod"];
    case "fly":
      return ["flyctl launch --no-deploy", "flyctl deploy"];
    case "self-host":
      return [
        `rsync -az ./dist/ deploy@${name}.local:/opt/${name}/dist/`,
        `ssh deploy@${name}.local 'sudo systemctl restart ${name}'`,
      ];
  }
}

function envVarsFor(target: DeployTarget): readonly string[] {
  switch (target) {
    case "cloudflare-pages":
      return ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];
    case "vercel":
      return ["VERCEL_TOKEN"];
    case "fly":
      return ["FLY_API_TOKEN"];
    case "self-host":
      return [];
  }
}

function notesFor(target: DeployTarget): readonly string[] {
  switch (target) {
    case "cloudflare-pages":
      return [
        "Cloudflare Pages free tier: 500 builds/month, unlimited bandwidth.",
        "Set secrets in GitHub repo settings: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.",
      ];
    case "vercel":
      return [
        "Run `vercel link` once to associate your repo.",
        "Preview deploys ship on every PR; production ships on merge to main.",
      ];
    case "fly":
      return [
        "Run `fly auth login` then `fly launch` to bind a region.",
        "Scale with `fly scale count 2` or `fly scale vm shared-cpu-2x`.",
      ];
    case "self-host":
      return [
        "Install Caddy: https://caddyserver.com/docs/install",
        "Copy the unit file into /etc/systemd/system and run `systemctl daemon-reload`.",
      ];
  }
}

// ═══ Entry point ═══════════════════════════════════════════════════════

/** Produce a deploy plan. Pure: no shell, no network, no FS. */
export function adaptDeploy(input: DeployAdapterInput): DeployAdapterResult {
  if (typeof input.projectName !== "string" || input.projectName.trim() === "") {
    return { ok: false, error: "projectName required" };
  }
  if (input.pick !== undefined && !TARGET_IDS.includes(input.pick)) {
    return { ok: false, error: `unknown deploy target: ${input.pick}` };
  }

  const target: DeployTarget = input.pick ?? pickDefault(input.scaffoldRuntime);
  const matched = input.pick !== undefined;
  let files: readonly DeployFile[];
  switch (target) {
    case "cloudflare-pages":
      files = cloudflareFiles(input.projectName);
      break;
    case "vercel":
      files = vercelFiles(input.projectName, input.customDomain);
      break;
    case "fly":
      files = flyFiles(input.projectName);
      break;
    case "self-host":
      files = selfHostFiles(input.projectName, input.customDomain);
      break;
  }

  const plan: DeployPlan = {
    target,
    matched,
    files,
    commands: commandsFor(target, input.projectName),
    envVars: envVarsFor(target),
    notes: notesFor(target),
  };
  return { ok: true, plan };
}

/** Enumerate all deploy target ids. */
export function listDeployTargets(): readonly DeployTarget[] {
  return TARGET_IDS;
}

/** Stable slugifier export so tests can assert project naming. */
export function projectSlug(name: string): string {
  return slugify(name);
}
