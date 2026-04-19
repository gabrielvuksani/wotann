#!/usr/bin/env node
// esbuild-cjs.mjs — ESM → CJS bundler for Node SEA input.
//
// Why this exists:
//   Node's Single Executable Application (SEA) API requires a CommonJS main
//   script. wotann is authored in ESM (package.json "type":"module",
//   tsconfig "module":"Node16") so `dist/index.js` emits `import`/`export`
//   statements that SEA refuses with "Cannot use import statement outside a
//   module". This script bundles the ESM entry into a single CJS file that
//   SEA can ingest.
//
// Contract:
//   Input:   src/index.ts         (TypeScript ESM source)
//   Output:  dist-cjs/index.cjs   (bundled CommonJS, Node 22 target)
//
// Implementation notes:
//
// 1. Top-Level Await (TLA)
//    CJS output cannot contain TLA. src/index.ts has two TLA sites near the
//    bottom: `await import("./core/deep-link.js")` (inside an if-block) and
//    `await program.parseAsync()` (final line). The on-load plugin below
//    wraps both — everything from the "// ── Parse ─" marker onward — in an
//    async IIFE. Import statements at the top remain untouched so esbuild
//    can still hoist them into require() calls.
//
// 2. import.meta.url
//    In CJS, `import.meta` is empty. A few source files reference
//    `import.meta.url` (e.g. for `fileURLToPath(import.meta.url)` daemon
//    entry-point detection). We define `import.meta` as a shim object that
//    derives its `url` getter from `__filename` — faithful semantics for
//    bundled output. The shim object is injected via banner.
//
// 3. Externals — natives + ESM-only + optional deps
//    External modules aren't bundled; they're require()d at runtime. Four
//    categories must be external:
//      a) Native bindings (.node files): better-sqlite3, magika's onnxruntime
//         backend, sharp. These ship platform-specific binaries.
//      b) ESM-only packages using TLA: ink, yoga-layout. Bundling them into
//         CJS would surface the same TLA errors from sub-modules.
//      c) Optional peer deps: react-devtools-core (only used when NODE_ENV
//         points to react devtools; safe to skip).
//      d) Optional model runtimes: @xenova/transformers (heavy, optional).
//
//    Because natives remain external, the SEA binary has a non-trivial
//    install-time dependency — the caller (sea-bundle.sh) is responsible
//    for emitting BLOCKED-NATIVE-BINDINGS when the natives can't resolve
//    at runtime, and recommending the install.sh fallback path.
//
// Honest failure model (no silent skip):
//   - esbuild module not loadable → exit 1 with FIXUP hint
//   - src/index.ts missing → exit 1 with FIXUP hint
//   - TLA wrap-marker absent → exit 2 (entry was refactored — update plugin)
//   - esbuild reports errors → exit 2, surface each with file:line
//   - output absent after "success" → exit 2 (catches silent I/O failure)
//
// Exit codes:
//   0 — success, dist-cjs/index.cjs written
//   1 — prerequisite missing (esbuild, source file)
//   2 — bundling error (marker missing, build errors, output missing)

import { access, stat, readFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Paths ────────────────────────────────────────────────────────────
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..", "..");
const ENTRY = resolve(ROOT, "src", "index.ts");
const OUTFILE = resolve(ROOT, "dist-cjs", "index.cjs");

// ── Logging ──────────────────────────────────────────────────────────
const log = (msg) => process.stdout.write(`[esbuild-cjs] ${msg}\n`);
const err = (msg) => process.stderr.write(`[esbuild-cjs:ERROR] ${msg}\n`);

// ── Prereq: entry file must exist ────────────────────────────────────
try {
  await access(ENTRY, FS.R_OK);
} catch {
  err(`entry file missing or unreadable: ${ENTRY}`);
  err(`FIXUP: ensure you are running from the wotann project root and src/index.ts exists`);
  process.exit(1);
}

// ── Prereq: esbuild module must be installed ─────────────────────────
let esbuild;
try {
  esbuild = await import("esbuild");
} catch (loadErr) {
  const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
  err(`failed to import 'esbuild': ${msg}`);
  err(`FIXUP: run 'npm install --save-dev esbuild@^0.27.0' then retry`);
  process.exit(1);
}

// ── External modules (see rationale in header comment) ───────────────
const EXTERNAL = [
  // Native bindings — require platform-specific .node files.
  "better-sqlite3",
  "magika",
  "onnxruntime-node",
  "sharp",
  // ESM-only with top-level await — can't be inlined into CJS.
  "ink",
  "yoga-layout",
  // Optional peer deps — only resolved under specific runtime flags.
  "react-devtools-core",
  // Heavy optional runtime — only loaded when configured.
  "@xenova/transformers",
];

// ── TLA wrap plugin ──────────────────────────────────────────────────
// Transforms src/index.ts at load time: keeps all `import` statements at
// top (so esbuild can still hoist them to require() calls), wraps the
// trailing "// ── Parse ─" section in an async IIFE so TLA becomes legal.
const TLA_MARKER = "// ── Parse ─";

const wrapTlaPlugin = {
  name: "wrap-entry-tla",
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/]index\.ts$/ }, async (args) => {
      let src = await readFile(args.path, "utf8");
      // Strip shebang — banner will emit a fresh one for the bundle.
      src = src.replace(/^#![^\n]*\n/, "");
      const idx = src.indexOf(TLA_MARKER);
      if (idx === -1) {
        throw new Error(
          `wrap-entry-tla: marker "${TLA_MARKER}" not found in ${args.path}. ` +
            `Entry was refactored — update the marker in esbuild-cjs.mjs to match the new TLA boundary, ` +
            `or wrap the new TLA sites manually in an async IIFE.`,
        );
      }
      const head = src.slice(0, idx);
      const tail = src.slice(idx);
      const wrapped =
        head +
        "(async () => {\n" +
        tail +
        '\n})().catch((e) => { console.error(e); process.exit(1); });\n';
      return { contents: wrapped, loader: "ts" };
    });
  },
};

// ── Banner: shebang + import.meta shim ───────────────────────────────
// The shim uses a getter so `__filename` (which esbuild fills in per-file)
// resolves correctly at the call site rather than at banner-load time.
const BANNER_JS = [
  "#!/usr/bin/env node",
  "// WOTANN CJS bundle for Node SEA",
  'const __wotann_import_meta = { get url() { return require("node:url").pathToFileURL(__filename).href; } };',
].join("\n");

// ── Build ────────────────────────────────────────────────────────────
log(`entry:    ${ENTRY}`);
log(`output:   ${OUTFILE}`);
log(`format:   cjs  target: node22`);
log(`external: ${EXTERNAL.join(", ")}`);

const started = Date.now();
let result;
try {
  result = await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    external: EXTERNAL,
    minify: false,
    sourcemap: "inline",
    logLevel: "warning",
    plugins: [wrapTlaPlugin],
    banner: { js: BANNER_JS },
    // Replace `import.meta` with our CJS shim. Done as a whole-object
    // replacement rather than `import.meta.url` specifically because some
    // files reference `new URL(".", import.meta.url)` — the shim's `url`
    // getter covers both forms.
    define: {
      "import.meta": "__wotann_import_meta",
    },
    metafile: true,
  });
} catch (buildErr) {
  const msg = buildErr instanceof Error ? buildErr.message : String(buildErr);
  err(`esbuild build failed: ${msg}`);
  if (buildErr && typeof buildErr === "object" && "errors" in buildErr) {
    const errors = /** @type {Array<{text?: string, location?: {file?: string, line?: number}}>} */ (
      buildErr.errors
    );
    if (Array.isArray(errors)) {
      for (const e of errors) {
        const loc = e?.location ? ` @ ${e.location.file}:${e.location.line}` : "";
        err(`  - ${e?.text ?? "unknown"}${loc}`);
      }
    }
  }
  process.exit(2);
}

// ── Post-build verification ──────────────────────────────────────────
if (result.warnings && result.warnings.length > 0) {
  for (const w of result.warnings) {
    const loc = w.location ? ` @ ${w.location.file}:${w.location.line}` : "";
    log(`WARN: ${w.text}${loc}`);
  }
}

// Verify the file actually exists on disk (defense against silent I/O).
let outSize;
try {
  const st = await stat(OUTFILE);
  if (!st.isFile() || st.size === 0) {
    err(`output file invalid (size=${st.size}, isFile=${st.isFile()}): ${OUTFILE}`);
    process.exit(2);
  }
  outSize = st.size;
} catch (statErr) {
  const msg = statErr instanceof Error ? statErr.message : String(statErr);
  err(`output file not found after successful build: ${OUTFILE}`);
  err(`stat error: ${msg}`);
  process.exit(2);
}

// ── Summary ──────────────────────────────────────────────────────────
const elapsed = Date.now() - started;
const moduleCount = result.metafile ? Object.keys(result.metafile.inputs).length : -1;
log(`SUCCESS`);
log(`  bundle:   ${OUTFILE}`);
log(`  size:     ${outSize} bytes (~${Math.round(outSize / 1024 / 1024)} MB)`);
log(`  modules:  ${moduleCount}`);
log(`  elapsed:  ${elapsed}ms`);
log(`  external: ${EXTERNAL.length} packages resolved at runtime`);
