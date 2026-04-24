import { describe, it, expect } from "vitest";
import {
  loadPlugins,
  buildBinInvocation,
  DEFAULT_BIN_TIMEOUT_MS,
  type PluginLoaderFs,
  type LoadedBin,
} from "../../src/marketplace/plugin-loader.js";

// ── In-memory fs stub ──────────────────────────────────────────────────

interface FakeFile {
  readonly kind: "file";
  readonly content: string;
  readonly mode: number;
}
interface FakeDir {
  readonly kind: "dir";
}
type FakeNode = FakeFile | FakeDir;

function makeFs(entries: Record<string, FakeNode>): PluginLoaderFs {
  // Normalize all keys: no trailing slash, forward-slash separators.
  const normalized: Record<string, FakeNode> = {};
  for (const [k, v] of Object.entries(entries)) {
    const key = k.replace(/\\/g, "/").replace(/\/+$/, "");
    normalized[key] = v;
  }

  const norm = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");

  return {
    existsSync: (p) => norm(p) in normalized,
    readFileSync: (p, _enc) => {
      const node = normalized[norm(p)];
      if (!node || node.kind !== "file") {
        throw new Error(`ENOENT: ${p}`);
      }
      return node.content;
    },
    readdirSync: (p) => {
      const prefix = norm(p) + "/";
      const children = new Set<string>();
      for (const key of Object.keys(normalized)) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first !== undefined && first.length > 0) children.add(first);
      }
      if (children.size === 0 && normalized[norm(p)]?.kind !== "dir") {
        throw new Error(`ENOTDIR: ${p}`);
      }
      return [...children];
    },
    statSync: (p) => {
      const node = normalized[norm(p)];
      if (!node) throw new Error(`ENOENT: ${p}`);
      return {
        isDirectory: () => node.kind === "dir",
        mode: node.kind === "file" ? node.mode : 0o755,
      };
    },
  };
}

function file(content: string, mode = 0o755): FakeFile {
  return { kind: "file", content, mode };
}
const DIR: FakeDir = { kind: "dir" };

const ROOT = "/fake/plugins";

// ── Tests ──────────────────────────────────────────────────────────────

describe("loadPlugins — roots", () => {
  it("missing root returns ok with empty arrays", () => {
    const fs = makeFs({});
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plugins).toEqual([]);
      expect(r.skipped).toEqual([]);
    }
  });

  it("empty root directory returns ok with no plugins", () => {
    const fs = makeFs({ [ROOT]: DIR });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plugins).toHaveLength(0);
    }
  });

  it("non-directory top-level entries are ignored", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/README.md`]: file("readme"),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plugins).toHaveLength(0);
      expect(r.skipped).toHaveLength(0);
    }
  });
});

describe("loadPlugins — single valid plugin", () => {
  it("loads a plugin with 1 bin", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/alpha`]: DIR,
      [`${ROOT}/alpha/plugin.json`]: file(
        JSON.stringify({
          name: "alpha",
          bins: [{ name: "alpha-cli", path: "bin/run.sh" }],
        }),
      ),
      [`${ROOT}/alpha/bin`]: DIR,
      [`${ROOT}/alpha/bin/run.sh`]: file("#!/bin/sh\necho hi", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins).toHaveLength(1);
    const p = r.plugins[0]!;
    expect(p.name).toBe("alpha");
    expect(p.bins).toHaveLength(1);
    const bin = p.bins[0]!;
    expect(bin.name).toBe("alpha-cli");
    expect(bin.pluginName).toBe("alpha");
    expect(bin.executable.endsWith("/alpha/bin/run.sh")).toBe(true);
    expect(bin.timeoutMs).toBe(DEFAULT_BIN_TIMEOUT_MS);
  });

  it("accepts manifest.json as an alternate filename", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/beta`]: DIR,
      [`${ROOT}/beta/manifest.json`]: file(
        JSON.stringify({ name: "beta", bins: [{ name: "b", path: "b.sh" }] }),
      ),
      [`${ROOT}/beta/b.sh`]: file("exec", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.manifestPath.endsWith("manifest.json")).toBe(true);
  });
});

describe("loadPlugins — multiple plugins", () => {
  it("loads multiple plugins independently", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/alpha`]: DIR,
      [`${ROOT}/alpha/plugin.json`]: file(
        JSON.stringify({ name: "alpha", bins: [{ name: "a", path: "a.sh" }] }),
      ),
      [`${ROOT}/alpha/a.sh`]: file("a", 0o755),
      [`${ROOT}/beta`]: DIR,
      [`${ROOT}/beta/plugin.json`]: file(
        JSON.stringify({ name: "beta", bins: [{ name: "b", path: "b.sh" }] }),
      ),
      [`${ROOT}/beta/b.sh`]: file("b", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins.map((p) => p.name).sort()).toEqual(["alpha", "beta"]);
    expect(r.plugins.every((p) => p.bins.length === 1)).toBe(true);
  });

  it("plugin without `bins` is valid with 0 loaded bins", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/noop`]: DIR,
      [`${ROOT}/noop/plugin.json`]: file(JSON.stringify({ name: "noop" })),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins).toHaveLength(1);
    expect(r.plugins[0]?.bins).toHaveLength(0);
  });
});

describe("loadPlugins — manifest errors produce skipped entries", () => {
  it("missing manifest → skipped, not failure", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/empty`]: DIR,
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.reason).toMatch(/no manifest/);
  });

  it("invalid JSON manifest → skipped with reason", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/broken`]: DIR,
      [`${ROOT}/broken/plugin.json`]: file("{not json"),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]?.reason).toMatch(/invalid manifest/);
  });

  it("manifest root not object → skipped", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/arr`]: DIR,
      [`${ROOT}/arr/plugin.json`]: file("[]"),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skipped[0]?.reason).toMatch(/not a JSON object/);
  });
});

describe("loadPlugins — path traversal defense", () => {
  it("rejects bin path containing `..`", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/evil`]: DIR,
      [`${ROOT}/evil/plugin.json`]: file(
        JSON.stringify({ name: "evil", bins: [{ name: "escape", path: "../escape" }] }),
      ),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
    expect(r.skipped.some((s) => /traverses outside/.test(s.reason))).toBe(true);
  });

  it("rejects absolute bin path", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/evil2`]: DIR,
      [`${ROOT}/evil2/plugin.json`]: file(
        JSON.stringify({ name: "evil2", bins: [{ name: "abs", path: "/etc/passwd" }] }),
      ),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
    expect(r.skipped.some((s) => /must be relative/.test(s.reason))).toBe(true);
  });

  it("rejects bin path with null byte", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/nullbyte`]: DIR,
      [`${ROOT}/nullbyte/plugin.json`]: file(
        JSON.stringify({
          name: "nullbyte",
          bins: [{ name: "nb", path: "bin/run .sh" }],
        }),
      ),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
    expect(r.skipped.some((s) => /null byte/.test(s.reason))).toBe(true);
  });

  it("rejects nested parent traversal like a/../../b", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/nested`]: DIR,
      [`${ROOT}/nested/plugin.json`]: file(
        JSON.stringify({
          name: "nested",
          bins: [{ name: "n", path: "a/../../b" }],
        }),
      ),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
  });
});

describe("loadPlugins — name validation", () => {
  it("rejects bin name with uppercase", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/upper`]: DIR,
      [`${ROOT}/upper/plugin.json`]: file(
        JSON.stringify({ name: "upper", bins: [{ name: "BadName", path: "x.sh" }] }),
      ),
      [`${ROOT}/upper/x.sh`]: file("x", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
    expect(r.skipped.some((s) => /invalid name/.test(s.reason))).toBe(true);
  });

  it("rejects bin name with dot", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/dotty`]: DIR,
      [`${ROOT}/dotty/plugin.json`]: file(
        JSON.stringify({ name: "dotty", bins: [{ name: "a.b", path: "x.sh" }] }),
      ),
      [`${ROOT}/dotty/x.sh`]: file("x", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
  });

  it("rejects bin name with slash", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/slashy`]: DIR,
      [`${ROOT}/slashy/plugin.json`]: file(
        JSON.stringify({ name: "slashy", bins: [{ name: "a/b", path: "x.sh" }] }),
      ),
      [`${ROOT}/slashy/x.sh`]: file("x", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
  });

  it("accepts kebab-case name", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/kebab`]: DIR,
      [`${ROOT}/kebab/plugin.json`]: file(
        JSON.stringify({ name: "kebab", bins: [{ name: "a-b-c", path: "x.sh" }] }),
      ),
      [`${ROOT}/kebab/x.sh`]: file("x", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins[0]?.name).toBe("a-b-c");
  });
});

describe("loadPlugins — qualifyNames flag", () => {
  it("qualifyNames:true produces `<plugin>.<bin>` names", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/qp`]: DIR,
      [`${ROOT}/qp/plugin.json`]: file(
        JSON.stringify({ name: "qp", bins: [{ name: "run", path: "r.sh" }] }),
      ),
      [`${ROOT}/qp/r.sh`]: file("r", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs, qualifyNames: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins[0]?.name).toBe("qp.run");
  });

  it("qualifyNames:false (default) keeps bare names", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/qp`]: DIR,
      [`${ROOT}/qp/plugin.json`]: file(
        JSON.stringify({ name: "qp", bins: [{ name: "run", path: "r.sh" }] }),
      ),
      [`${ROOT}/qp/r.sh`]: file("r", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs, qualifyNames: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins[0]?.name).toBe("run");
  });
});

describe("loadPlugins — executable checks", () => {
  it("missing executable → skipped with 'not found'", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/miss`]: DIR,
      [`${ROOT}/miss/plugin.json`]: file(
        JSON.stringify({ name: "miss", bins: [{ name: "ghost", path: "nope.sh" }] }),
      ),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
    expect(r.skipped.some((s) => /not found/.test(s.reason))).toBe(true);
  });

  it("missing user-exec bit → bin still loaded + skipped warning emitted", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/nox`]: DIR,
      [`${ROOT}/nox/plugin.json`]: file(
        JSON.stringify({ name: "nox", bins: [{ name: "maybe", path: "m.sh" }] }),
      ),
      [`${ROOT}/nox/m.sh`]: file("m", 0o644), // no exec bit
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(1);
    expect(r.skipped.some((s) => /lacks user-exec bit/.test(s.reason))).toBe(true);
  });

  it("bin path pointing to a directory → skipped", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/dirbin`]: DIR,
      [`${ROOT}/dirbin/plugin.json`]: file(
        JSON.stringify({ name: "dirbin", bins: [{ name: "d", path: "sub" }] }),
      ),
      [`${ROOT}/dirbin/sub`]: DIR,
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
    expect(r.skipped.some((s) => /directory, not a file/.test(s.reason))).toBe(true);
  });
});

describe("loadPlugins — bin entry fields", () => {
  it("custom timeout_ms is preserved", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/timed`]: DIR,
      [`${ROOT}/timed/plugin.json`]: file(
        JSON.stringify({
          name: "timed",
          bins: [{ name: "t", path: "t.sh", timeout_ms: 5000 }],
        }),
      ),
      [`${ROOT}/timed/t.sh`]: file("t", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins[0]?.timeoutMs).toBe(5000);
  });

  it("default timeout is DEFAULT_BIN_TIMEOUT_MS (60000)", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/notime`]: DIR,
      [`${ROOT}/notime/plugin.json`]: file(
        JSON.stringify({ name: "notime", bins: [{ name: "t", path: "t.sh" }] }),
      ),
      [`${ROOT}/notime/t.sh`]: file("t", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins[0]?.timeoutMs).toBe(60_000);
    expect(DEFAULT_BIN_TIMEOUT_MS).toBe(60_000);
  });

  it("argv and env are copied from manifest", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/pre`]: DIR,
      [`${ROOT}/pre/plugin.json`]: file(
        JSON.stringify({
          name: "pre",
          bins: [
            {
              name: "p",
              path: "p.sh",
              argv: ["--safe-mode", "--quiet"],
              env: { FOO: "1" },
              description: "prefix demo",
            },
          ],
        }),
      ),
      [`${ROOT}/pre/p.sh`]: file("p", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bin = r.plugins[0]?.bins[0]!;
    expect(bin.argv).toEqual(["--safe-mode", "--quiet"]);
    expect(bin.env).toEqual({ FOO: "1" });
    expect(bin.description).toBe("prefix demo");
  });

  it("invalid argv type → skipped", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/bada`]: DIR,
      [`${ROOT}/bada/plugin.json`]: file(
        JSON.stringify({
          name: "bada",
          bins: [{ name: "b", path: "b.sh", argv: "not-an-array" }],
        }),
      ),
      [`${ROOT}/bada/b.sh`]: file("b", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
    expect(r.skipped.some((s) => /argv must be/.test(s.reason))).toBe(true);
  });

  it("invalid timeout (negative/zero) → skipped", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/badt`]: DIR,
      [`${ROOT}/badt/plugin.json`]: file(
        JSON.stringify({
          name: "badt",
          bins: [{ name: "b", path: "b.sh", timeout_ms: -1 }],
        }),
      ),
      [`${ROOT}/badt/b.sh`]: file("b", 0o755),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins[0]?.bins).toHaveLength(0);
    expect(r.skipped.some((s) => /timeout_ms/.test(s.reason))).toBe(true);
  });
});

describe("buildBinInvocation", () => {
  const baseBin: LoadedBin = {
    pluginName: "demo",
    name: "cli",
    executable: "/fake/plugins/demo/run.sh",
    argv: ["--safe-mode"],
    env: { BASE: "base", SHARED: "from-bin" },
    timeoutMs: 5000,
  };

  it("concatenates bin.argv then userArgs", () => {
    const inv = buildBinInvocation({
      bin: baseBin,
      userArgs: ["--user", "flag"],
    });
    expect(inv.args).toEqual(["--safe-mode", "--user", "flag"]);
    expect(inv.command).toBe(baseBin.executable);
  });

  it("no userArgs → just bin.argv", () => {
    const inv = buildBinInvocation({ bin: baseBin });
    expect(inv.args).toEqual(["--safe-mode"]);
  });

  it("extraEnv wins over bin.env on key conflict", () => {
    const inv = buildBinInvocation({
      bin: baseBin,
      extraEnv: { SHARED: "from-extra", NEW: "x" },
    });
    expect(inv.env).toEqual({
      BASE: "base",
      SHARED: "from-extra",
      NEW: "x",
    });
  });

  it("preserves timeoutMs from the bin", () => {
    const inv = buildBinInvocation({ bin: baseBin });
    expect(inv.timeoutMs).toBe(5000);
  });

  it("empty extraEnv keeps bin.env intact", () => {
    const inv = buildBinInvocation({ bin: baseBin, extraEnv: {} });
    expect(inv.env).toEqual({ BASE: "base", SHARED: "from-bin" });
  });
});

describe("loadPlugins — hidden directories", () => {
  it("ignores hidden dotfile dirs at top level", () => {
    const fs = makeFs({
      [ROOT]: DIR,
      [`${ROOT}/.cache`]: DIR,
      [`${ROOT}/.cache/plugin.json`]: file(
        JSON.stringify({ name: ".cache", bins: [] }),
      ),
      [`${ROOT}/real`]: DIR,
      [`${ROOT}/real/plugin.json`]: file(
        JSON.stringify({ name: "real", bins: [] }),
      ),
    });
    const r = loadPlugins({ pluginsRoot: ROOT, fs });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plugins.map((p) => p.name)).toEqual(["real"]);
  });
});
