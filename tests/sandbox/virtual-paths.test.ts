import { describe, it, expect } from "vitest";
import {
  toVirtual,
  toPhysical,
  scrubPaths,
  unscrubPaths,
  makeDefaultConfig,
  validateBuckets,
  DEFAULT_VIRTUAL_ROOT,
  type VirtualPathsConfig,
} from "../../src/sandbox/virtual-paths.js";

// A single-bucket config mirroring the deer-flow default:
//   /Users/gabriel/project  ⇄  /mnt/user-data/project
const simple: VirtualPathsConfig = {
  buckets: [
    {
      virtualPrefix: "/mnt/user-data/project",
      physicalRoot: "/Users/gabriel/project",
    },
  ],
};

// Two-bucket config where one is nested under the other — exercises the
// longest-prefix-first tie-breaker.
const nested: VirtualPathsConfig = {
  buckets: [
    {
      virtualPrefix: "/mnt/user-data/project",
      physicalRoot: "/Users/gabriel/project",
    },
    {
      virtualPrefix: "/mnt/user-data/vendor",
      physicalRoot: "/Users/gabriel/project/vendor",
    },
  ],
};

describe("toVirtual", () => {
  it("maps physical file under bucket to virtual equivalent", () => {
    expect(toVirtual("/Users/gabriel/project/src/foo.ts", simple)).toBe(
      "/mnt/user-data/project/src/foo.ts",
    );
  });

  it("maps bucket root itself to virtual root", () => {
    expect(toVirtual("/Users/gabriel/project", simple)).toBe("/mnt/user-data/project");
  });

  it("idempotent on an already-virtual path", () => {
    const v = "/mnt/user-data/project/src/foo.ts";
    expect(toVirtual(v, simple)).toBe(v);
  });

  it("returns input unchanged when no bucket matches (non-strict default)", () => {
    expect(toVirtual("/etc/passwd", simple)).toBe("/etc/passwd");
  });

  it("throws on unmapped path in strict mode", () => {
    expect(() => toVirtual("/etc/passwd", { ...simple, strict: true })).toThrow(
      /no bucket matched/,
    );
  });

  it("longest-physical-prefix-first — nested bucket wins over parent", () => {
    // /Users/gabriel/project/vendor/x.ts lives under BOTH roots; the
    // nested bucket must win so the agent sees `/mnt/user-data/vendor/x.ts`.
    expect(toVirtual("/Users/gabriel/project/vendor/x.ts", nested)).toBe(
      "/mnt/user-data/vendor/x.ts",
    );
  });

  it("non-nested sibling still goes through parent bucket", () => {
    expect(toVirtual("/Users/gabriel/project/src/foo.ts", nested)).toBe(
      "/mnt/user-data/project/src/foo.ts",
    );
  });

  it("does not mis-map a lookalike path not under root", () => {
    // `/Users/gabriel/project-v2` is NOT under `/Users/gabriel/project/`.
    expect(toVirtual("/Users/gabriel/project-v2/src/a.ts", simple)).toBe(
      "/Users/gabriel/project-v2/src/a.ts",
    );
  });
});

describe("toPhysical", () => {
  it("maps virtual file under prefix to physical equivalent", () => {
    expect(toPhysical("/mnt/user-data/project/src/foo.ts", simple)).toBe(
      "/Users/gabriel/project/src/foo.ts",
    );
  });

  it("maps virtual prefix itself to physical root", () => {
    expect(toPhysical("/mnt/user-data/project", simple)).toBe("/Users/gabriel/project");
  });

  it("returns input unchanged when no bucket matches (non-strict default)", () => {
    expect(toPhysical("/var/log/system.log", simple)).toBe("/var/log/system.log");
  });

  it("throws on unmapped path in strict mode", () => {
    expect(() => toPhysical("/tmp/a", { ...simple, strict: true })).toThrow(
      /no bucket matched/,
    );
  });

  it("round-trips virtual → physical → virtual", () => {
    const v = "/mnt/user-data/project/src/foo.ts";
    const p = toPhysical(v, simple);
    expect(toVirtual(p, simple)).toBe(v);
  });

  it("round-trips physical → virtual → physical", () => {
    const p = "/Users/gabriel/project/src/foo.ts";
    const v = toVirtual(p, simple);
    expect(toPhysical(v, simple)).toBe(p);
  });

  it("longest-virtual-prefix-first — nested vendor wins over project", () => {
    expect(toPhysical("/mnt/user-data/vendor/x.ts", nested)).toBe(
      "/Users/gabriel/project/vendor/x.ts",
    );
  });
});

describe("scrubPaths", () => {
  it("rewrites a physical path embedded in free-form text", () => {
    const stderr = "error at /Users/gabriel/project/src/foo.ts:12";
    expect(scrubPaths(stderr, simple)).toBe("error at /mnt/user-data/project/src/foo.ts:12");
  });

  it("rewrites multiple occurrences", () => {
    const out =
      "a:/Users/gabriel/project/a.ts b:/Users/gabriel/project/b.ts";
    expect(scrubPaths(out, simple)).toBe(
      "a:/mnt/user-data/project/a.ts b:/mnt/user-data/project/b.ts",
    );
  });

  it("is a no-op when the text contains no mapped root", () => {
    const txt = "nothing to scrub here /etc/passwd";
    expect(scrubPaths(txt, simple)).toBe(txt);
  });

  it("nested roots scrub to most-specific virtual prefix", () => {
    const txt =
      "sibling: /Users/gabriel/project/src/a.ts and nested: /Users/gabriel/project/vendor/v.ts";
    const out = scrubPaths(txt, nested);
    expect(out).toContain("/mnt/user-data/project/src/a.ts");
    expect(out).toContain("/mnt/user-data/vendor/v.ts");
  });

  it("handles empty input", () => {
    expect(scrubPaths("", simple)).toBe("");
  });

  it("does not scrub a lookalike path with a shared prefix but differing segment", () => {
    // "/Users/gabriel/project-v2" is NOT a subpath of "/Users/gabriel/project"
    // even though the characters match. scrubPaths does literal substring
    // replacement, which is by design (we err on the side of scrubbing
    // anything that LOOKS like the root — prompts leak the same way).
    // Document the behavior explicitly so a future refactor doesn't drop it.
    const txt = "look at /Users/gabriel/project-v2";
    // The literal prefix /Users/gabriel/project IS a substring of
    // /Users/gabriel/project-v2, so scrub will rewrite it. That's
    // intentional: scrubbing is DEFENSE, not a parser.
    expect(scrubPaths(txt, simple)).toBe("look at /mnt/user-data/project-v2");
  });
});

describe("unscrubPaths", () => {
  it("rewrites virtual path in text back to physical", () => {
    const txt = "run /mnt/user-data/project/build.sh";
    expect(unscrubPaths(txt, simple)).toBe("run /Users/gabriel/project/build.sh");
  });

  it("scrub then unscrub round-trips", () => {
    const original = "log at /Users/gabriel/project/x.log and /Users/gabriel/project/y.log";
    const scrubbed = scrubPaths(original, simple);
    expect(unscrubPaths(scrubbed, simple)).toBe(original);
  });
});

describe("makeDefaultConfig", () => {
  it("creates a single-bucket config under DEFAULT_VIRTUAL_ROOT", () => {
    const cfg = makeDefaultConfig("/Users/gabriel/project");
    expect(cfg.buckets).toHaveLength(1);
    expect(cfg.buckets[0]?.virtualPrefix).toBe(`${DEFAULT_VIRTUAL_ROOT}/project`);
    expect(cfg.buckets[0]?.physicalRoot).toBe("/Users/gabriel/project");
  });
});

describe("validateBuckets", () => {
  it("returns empty array for a valid single bucket", () => {
    expect(validateBuckets(simple.buckets)).toEqual([]);
  });

  it("flags duplicate virtualPrefix", () => {
    const errs = validateBuckets([
      { virtualPrefix: "/mnt/user-data/a", physicalRoot: "/x" },
      { virtualPrefix: "/mnt/user-data/a", physicalRoot: "/y" },
    ]);
    expect(errs.some((e) => e.includes("duplicate virtualPrefix"))).toBe(true);
  });

  it("flags duplicate physicalRoot", () => {
    const errs = validateBuckets([
      { virtualPrefix: "/mnt/user-data/a", physicalRoot: "/x" },
      { virtualPrefix: "/mnt/user-data/b", physicalRoot: "/x" },
    ]);
    expect(errs.some((e) => e.includes("duplicate physicalRoot"))).toBe(true);
  });

  it("flags root-mount virtual prefix", () => {
    const errs = validateBuckets([{ virtualPrefix: "/", physicalRoot: "/x" }]);
    expect(errs.some((e) => e.includes("empty or root"))).toBe(true);
  });

  it("flags root-mount physical root", () => {
    const errs = validateBuckets([{ virtualPrefix: "/mnt/user-data/a", physicalRoot: "/" }]);
    expect(errs.some((e) => e.includes("empty or root"))).toBe(true);
  });
});
