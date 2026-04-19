import { describe, it, expect } from "vitest";
import {
  EXTENDED_EXECUTION_ENVIRONMENTS,
  detectAvailableBackends,
  fallbackChain,
  allBackends,
} from "../../src/sandbox/extended-backends.js";

describe("EXTENDED_EXECUTION_ENVIRONMENTS", () => {
  it("exports 5 backends", () => {
    expect(Object.keys(EXTENDED_EXECUTION_ENVIRONMENTS)).toHaveLength(5);
  });

  it("each has required fields", () => {
    for (const env of Object.values(EXTENDED_EXECUTION_ENVIRONMENTS)) {
      expect(env.name).toBeTruthy();
      expect(env.label).toBeTruthy();
      expect(env.description).toBeTruthy();
      expect(["none", "filesystem", "full"]).toContain(env.isolation);
      expect(typeof env.startupCostMs).toBe("number");
      expect(typeof env.supportsRollback).toBe("boolean");
      expect(env.tradeoffs.length).toBeGreaterThan(0);
    }
  });

  it("daytona + modal + singularity are 'full' isolation", () => {
    expect(EXTENDED_EXECUTION_ENVIRONMENTS.daytona.isolation).toBe("full");
    expect(EXTENDED_EXECUTION_ENVIRONMENTS.modal.isolation).toBe("full");
    expect(EXTENDED_EXECUTION_ENVIRONMENTS.singularity.isolation).toBe("full");
  });

  it("ssh + landlock are 'filesystem' isolation", () => {
    expect(EXTENDED_EXECUTION_ENVIRONMENTS.ssh.isolation).toBe("filesystem");
    expect(EXTENDED_EXECUTION_ENVIRONMENTS.landlock.isolation).toBe("filesystem");
  });
});

describe("detectAvailableBackends", () => {
  it("daytona requires DAYTONA_API_KEY", () => {
    const result = detectAvailableBackends({});
    const daytona = result.find((r) => r.name === "daytona");
    expect(daytona?.available).toBe(false);
    expect(daytona?.reason).toContain("DAYTONA_API_KEY");
  });

  it("daytona detected when DAYTONA_API_KEY set", () => {
    const result = detectAvailableBackends({ DAYTONA_API_KEY: "x" });
    const daytona = result.find((r) => r.name === "daytona");
    expect(daytona?.available).toBe(true);
  });

  it("modal requires both tokens", () => {
    const onlyId = detectAvailableBackends({ MODAL_TOKEN_ID: "a" });
    expect(onlyId.find((r) => r.name === "modal")?.available).toBe(false);
    const both = detectAvailableBackends({ MODAL_TOKEN_ID: "a", MODAL_TOKEN_SECRET: "b" });
    expect(both.find((r) => r.name === "modal")?.available).toBe(true);
  });

  it("landlock requires Linux + explicit env flag", () => {
    const result = detectAvailableBackends({});
    const landlock = result.find((r) => r.name === "landlock");
    expect(landlock?.available).toBe(false); // not explicitly enabled
  });

  it("returns exactly 5 entries", () => {
    const result = detectAvailableBackends({});
    expect(result).toHaveLength(5);
  });
});

describe("fallbackChain", () => {
  it("prefers same isolation level first", () => {
    const chain = fallbackChain("daytona");
    // Next should be another 'full' (modal/singularity)
    const first = chain[0];
    expect(["modal", "singularity"]).toContain(first);
  });

  it("excludes the preferred backend from the chain", () => {
    const chain = fallbackChain("daytona");
    expect(chain).not.toContain("daytona");
  });

  it("produces stable ordering", () => {
    const a = fallbackChain("daytona");
    const b = fallbackChain("daytona");
    expect(a).toEqual(b);
  });
});

describe("allBackends", () => {
  it("includes 3 core + 5 extended", () => {
    const list = allBackends();
    expect(list).toContain("local");
    expect(list).toContain("worktree");
    expect(list).toContain("docker");
    expect(list).toContain("daytona");
    expect(list).toContain("modal");
    expect(list).toContain("singularity");
    expect(list).toContain("ssh");
    expect(list).toContain("landlock");
    expect(list).toHaveLength(8);
  });
});
