#!/usr/bin/env node
/**
 * WOTANN design-token generator.
 *
 * Regenerates per-surface token artifacts from `src/design/tokens.ts`.
 *
 * Usage:
 *   npm run tokens:generate      # after adding script to package.json
 *   node scripts/generate-tokens.mjs
 *
 * Optional flags:
 *   --check    — fail (exit 1) if any generated file is out-of-date
 *   --quiet    — suppress per-file "wrote ..." logs
 *
 * Outputs:
 *   - desktop-app/src/design/tokens.generated.ts
 *   - desktop-app/src/design/tokens.generated.css
 *   - ios/WOTANN/DesignSystem/WotannTokens.swift  (if iOS target exists)
 *   - docs/internal/design-tokens.w3c.json
 *
 * Idempotent: running twice in a row produces byte-identical output.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const argv = new Set(process.argv.slice(2));
const checkMode = argv.has("--check");
const quiet = argv.has("--quiet");

function log(msg) {
  if (!quiet) process.stdout.write(msg + "\n");
}

async function loadTokens() {
  // Compile the TS tokens on-the-fly using tsx so this script has no build
  // step dependency. Fall back to a pre-built dist copy if available.
  const srcPath = resolve(ROOT, "src/design/tokens.ts");
  const distPath = resolve(ROOT, "dist/design/tokens.js");

  if (existsSync(distPath)) {
    return import(pathToFileURL(distPath).href);
  }

  // Use tsx to load the TypeScript source directly
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx/esm",
      "--eval",
      `import('${pathToFileURL(srcPath).href}').then(m => process.stdout.write(JSON.stringify({
        tokens: m.WOTANN_TOKENS,
        keys: m.COLOR_TOKEN_KEYS,
      }))).catch(e => { process.stderr.write(String(e)); process.exit(1); });`,
    ],
    { encoding: "utf-8" },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to load tokens.ts: ${result.stderr}`);
  }

  // We still need the emitters (which import tokens.ts internally).
  // Load them via tsx too.
  return { __loadedViaTsx: true, ...JSON.parse(result.stdout) };
}

async function loadEmittersAndGenerate() {
  // Run everything inside a tsx-powered subprocess so the emitters'
  // ESM-with-".js" imports resolve correctly against `.ts` sources.
  const bridgeCode = `
    import { WOTANN_TOKENS } from ${JSON.stringify(pathToFileURL(resolve(ROOT, "src/design/tokens.ts")).href)};
    import { emitDesktop } from ${JSON.stringify(pathToFileURL(resolve(ROOT, "src/design/token-emitters/desktop.ts")).href)};
    import { emitIos } from ${JSON.stringify(pathToFileURL(resolve(ROOT, "src/design/token-emitters/ios.ts")).href)};
    import { emitW3cTokensJson } from ${JSON.stringify(pathToFileURL(resolve(ROOT, "src/design/token-emitters/w3c-tokens.ts")).href)};

    const desktop = emitDesktop(WOTANN_TOKENS);
    const ios = emitIos(WOTANN_TOKENS);
    const w3c = emitW3cTokensJson(WOTANN_TOKENS);
    process.stdout.write(JSON.stringify({
      desktopCss: desktop.css,
      desktopTs: desktop.typescript,
      iosSwift: ios.swift,
      w3c,
    }));
  `;

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx/esm", "--eval", bridgeCode],
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
  );

  if (result.status !== 0) {
    throw new Error(`Emitter bridge failed: ${result.stderr || "unknown error"}`);
  }

  return JSON.parse(result.stdout);
}

function writeFileIfChanged(absPath, contents) {
  mkdirSync(dirname(absPath), { recursive: true });
  const prev = existsSync(absPath) ? readFileSync(absPath, "utf-8") : null;
  if (prev === contents) {
    log(`  unchanged  ${absPath.replace(ROOT + "/", "")}`);
    return false;
  }
  if (checkMode) {
    throw new Error(
      `Generated file out of date (check mode): ${absPath.replace(ROOT + "/", "")}. Run \`node scripts/generate-tokens.mjs\` and commit.`,
    );
  }
  writeFileSync(absPath, contents);
  log(`  wrote      ${absPath.replace(ROOT + "/", "")}`);
  return true;
}

async function main() {
  log("WOTANN tokens generator");
  log(`  mode       ${checkMode ? "check (no writes)" : "write"}`);
  log(`  source     src/design/tokens.ts`);

  const { desktopCss, desktopTs, iosSwift, w3c } = await loadEmittersAndGenerate();

  // Desktop artifacts — always call both writers (don't short-circuit).
  const desktopDir = resolve(ROOT, "desktop-app/src/design");
  const desktopTsPath = resolve(desktopDir, "tokens.generated.ts");
  const desktopCssPath = resolve(desktopDir, "tokens.generated.css");
  const tsChanged = writeFileIfChanged(desktopTsPath, desktopTs);
  const cssChanged = writeFileIfChanged(desktopCssPath, desktopCss);
  const anyChange = tsChanged || cssChanged;

  // iOS artifact — only emit if iOS source tree exists
  const iosDir = resolve(ROOT, "ios/WOTANN/DesignSystem");
  if (existsSync(iosDir)) {
    const iosPath = resolve(iosDir, "WotannTokens.swift");
    writeFileIfChanged(iosPath, iosSwift);
  } else {
    log(`  skipping   iOS (no ios/WOTANN/DesignSystem/ present)`);
  }

  // W3C tokens artifact (shared / design-tool interop)
  const w3cPath = resolve(ROOT, "docs/internal/design-tokens.w3c.json");
  writeFileIfChanged(w3cPath, w3c);

  if (checkMode) {
    log(`  ok         all generated files up-to-date`);
  } else {
    log(`  done       ${anyChange ? "(files updated)" : "(no changes)"}`);
  }
}

main().catch((e) => {
  process.stderr.write(`generate-tokens: ${e.message || e}\n`);
  process.exit(1);
});
