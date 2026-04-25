/**
 * Tests for src/cli/tricks/completion-checklist.ts (T12.2).
 *
 * Asserts:
 *   - The canonical 6-item list matches the V9 spec verbatim.
 *   - The list AND each item are frozen (immutability QB #6).
 *   - Builder accepts well-formed extras and merges them.
 *   - Builder rejects malformed extras with honest-stub errors.
 *   - Renderer produces the documented Markdown shape.
 */

import { describe, it, expect } from "vitest";
import {
  COMPLETION_CHECKLIST_ITEMS,
  buildCompletionChecklist,
  renderChecklistMarkdown,
} from "../../../src/cli/tricks/completion-checklist.js";

// ── Canonical list shape ──────────────────────────────

describe("COMPLETION_CHECKLIST_ITEMS — canonical 6 (V9 line 1723)", () => {
  it("contains exactly 6 items", () => {
    expect(COMPLETION_CHECKLIST_ITEMS).toHaveLength(6);
  });

  it("ids are unique and stable", () => {
    const ids = COMPLETION_CHECKLIST_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toEqual([
      "tsc-noemit",
      "vitest-run",
      "lint",
      "pr-message",
      "no-todos",
      "doc-sync",
    ]);
  });

  it("every item has the documented question text", () => {
    const map = Object.fromEntries(
      COMPLETION_CHECKLIST_ITEMS.map((i) => [i.id, i.question]),
    );
    expect(map["tsc-noemit"]).toMatch(/tsc --noEmit/);
    expect(map["vitest-run"]).toMatch(/vitest run/);
    expect(map["lint"]).toMatch(/lint/);
    expect(map["pr-message"]).toMatch(/PR description|commit message/);
    expect(map["no-todos"]).toMatch(/TODO\/FIXME\/XXX/);
    expect(map["doc-sync"]).toMatch(/README|CHANGELOG|JSDoc/);
  });

  it("list and each item are frozen", () => {
    expect(Object.isFrozen(COMPLETION_CHECKLIST_ITEMS)).toBe(true);
    for (const item of COMPLETION_CHECKLIST_ITEMS) {
      expect(Object.isFrozen(item)).toBe(true);
    }
  });

  it("every canonical item is required:true", () => {
    for (const item of COMPLETION_CHECKLIST_ITEMS) {
      expect(item.required).toBe(true);
    }
  });
});

// ── Builder ───────────────────────────────────────────

describe("buildCompletionChecklist", () => {
  it("returns the canonical 6 when extras is empty", () => {
    const r = buildCompletionChecklist();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.id)).toEqual([
      "tsc-noemit",
      "vitest-run",
      "lint",
      "pr-message",
      "no-todos",
      "doc-sync",
    ]);
  });

  it("appends a well-formed extra, defaulting category=custom + required=true", () => {
    const r = buildCompletionChecklist([
      { id: "openapi-regen", question: "Did you regenerate the OpenAPI client?" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(7);
    const last = r.items[r.items.length - 1];
    expect(last?.id).toBe("openapi-regen");
    expect(last?.category).toBe("custom");
    expect(last?.required).toBe(true);
  });

  it("respects category + required overrides on extras", () => {
    const r = buildCompletionChecklist([
      {
        id: "soft-warn",
        question: "Did you double-check the migration plan?",
        category: "docs",
        required: false,
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const last = r.items[r.items.length - 1];
    expect(last?.category).toBe("docs");
    expect(last?.required).toBe(false);
  });

  it("rejects non-array extras (QB #6)", () => {
    // @ts-expect-error — runtime validation
    const r = buildCompletionChecklist({ id: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/array/);
  });

  it("rejects extras with missing id", () => {
    const r = buildCompletionChecklist([{ question: "test?" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/non-empty id/);
  });

  it("rejects extras with missing question", () => {
    const r = buildCompletionChecklist([{ id: "x" }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/non-empty question/);
  });

  it("rejects duplicate ids", () => {
    const r = buildCompletionChecklist([
      { id: "tsc-noemit", question: "Did you run tsc twice?" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/duplicate/);
  });

  it("rejects null/non-object extras", () => {
    // @ts-expect-error — runtime validation
    const r = buildCompletionChecklist([null]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/object/);
  });
});

// ── Renderer ──────────────────────────────────────────

describe("renderChecklistMarkdown", () => {
  it("produces a numbered list with [ ] for required items", () => {
    const out = renderChecklistMarkdown([...COMPLETION_CHECKLIST_ITEMS]);
    expect(out).toContain("## Completion Checklist");
    expect(out).toContain("1. [ ] Did you run `npx tsc --noEmit` and get rc=0?");
    // Sequential numbering through all 6.
    expect(out).toMatch(/6\. \[ \] /);
  });

  it("uses [?] for optional (required:false) items", () => {
    const out = renderChecklistMarkdown([
      {
        id: "soft",
        question: "Soft warn?",
        category: "custom",
        required: false,
      },
    ]);
    expect(out).toContain("1. [?] Soft warn?");
  });

  it("returns empty string for empty input", () => {
    expect(renderChecklistMarkdown([])).toBe("");
  });
});
