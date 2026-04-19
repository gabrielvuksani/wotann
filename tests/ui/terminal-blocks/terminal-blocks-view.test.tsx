/**
 * TerminalBlocksView tests — Ink render + keyboard behaviour.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { TerminalBlocksView } from "../../../src/ui/components/TerminalBlocksView.js";
import type { Block } from "../../../src/ui/terminal-blocks/block.js";

function makeBlock(overrides?: Partial<Block>): Block {
  return Object.freeze({
    id: "blk-1",
    promptText: "$ ",
    commandText: "echo hi",
    output: "hi\n",
    exitCode: 0,
    durationMs: 120,
    startedAt: 1000,
    endedAt: 1120,
    ...overrides,
  });
}

describe("TerminalBlocksView — empty state", () => {
  it("renders empty-state hint when no blocks", () => {
    const { lastFrame } = render(<TerminalBlocksView blocks={[]} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Terminal Blocks");
    expect(frame).toContain("wotann init --shell");
  });
});

describe("TerminalBlocksView — rendering", () => {
  it("shows block count and command text", () => {
    const blocks = [makeBlock()];
    const { lastFrame } = render(<TerminalBlocksView blocks={blocks} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Terminal Blocks");
    expect(frame).toContain("(1)");
    expect(frame).toContain("echo hi");
  });

  it("shows duration in header", () => {
    const blocks = [makeBlock({ durationMs: 1_500 })];
    const { lastFrame } = render(<TerminalBlocksView blocks={blocks} />);
    expect(lastFrame() ?? "").toContain("1.50s");
  });

  it("shows exit code only on non-zero", () => {
    const successBlock = [makeBlock({ exitCode: 0 })];
    const failBlock = [makeBlock({ id: "blk-2", exitCode: 127 })];
    const { lastFrame: okFrame } = render(<TerminalBlocksView blocks={successBlock} />);
    const { lastFrame: failFrame } = render(<TerminalBlocksView blocks={failBlock} />);
    expect(okFrame() ?? "").not.toContain("exit");
    expect(failFrame() ?? "").toContain("exit 127");
  });

  it("defaults to expanded most-recent block (shows output)", () => {
    const blocks = [
      makeBlock({ id: "blk-1", commandText: "older", output: "older output\n" }),
      makeBlock({ id: "blk-2", commandText: "newer", output: "newer output\n" }),
    ];
    const { lastFrame } = render(<TerminalBlocksView blocks={blocks} />);
    const frame = lastFrame() ?? "";
    // Newest block's output should be visible.
    expect(frame).toContain("newer output");
    // Older block's output should be collapsed.
    expect(frame).not.toContain("older output");
  });

  it("initiallyExpandAll shows output for every block", () => {
    const blocks = [
      makeBlock({ id: "blk-1", commandText: "a", output: "AAA\n" }),
      makeBlock({ id: "blk-2", commandText: "b", output: "BBB\n" }),
    ];
    const { lastFrame } = render(
      <TerminalBlocksView blocks={blocks} initiallyExpandAll={true} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("AAA");
    expect(frame).toContain("BBB");
  });

  it("truncates output beyond maxOutputLines", () => {
    const longOutput = Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n");
    const blocks = [
      makeBlock({ output: longOutput + "\n", commandText: "big" }),
    ];
    const { lastFrame } = render(
      <TerminalBlocksView blocks={blocks} maxOutputLines={10} />,
    );
    const frame = lastFrame() ?? "";
    // Last 10 lines should be shown (line-40 through line-49).
    expect(frame).toContain("line-49");
    expect(frame).toContain("line-40");
    // Early lines should be hidden.
    expect(frame).not.toContain("line-0\n");
    expect(frame).toContain("40 earlier lines hidden");
  });

  it("shows running indicator for unfinished blocks", () => {
    const runningBlock = Object.freeze({
      id: "blk-live",
      promptText: "",
      commandText: "sleep 10",
      output: "",
      startedAt: 1000,
      // No endedAt, no exitCode — block is running.
    }) satisfies Block;
    const { lastFrame } = render(
      <TerminalBlocksView blocks={[runningBlock]} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("sleep 10");
  });
});

// In ink-testing-library, state updates triggered by stdin.write are async.
// Use a short setTimeout tick to let React flush before reading the frame.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe("TerminalBlocksView — keyboard", () => {
  it("j key is bounded at the last block", async () => {
    const blocks = [
      makeBlock({ id: "blk-1", commandText: "first" }),
      makeBlock({ id: "blk-2", commandText: "second" }),
      makeBlock({ id: "blk-3", commandText: "third" }),
    ];
    const { stdin, lastFrame } = render(<TerminalBlocksView blocks={blocks} />);
    // Newest ("third") is selected by default — j should not advance past it.
    stdin.write("j");
    await tick();
    const frame = lastFrame() ?? "";
    // third should still be the selected marker.
    expect(frame).toContain("third");
  });

  it("k key navigates to the previous block and expands it via enter", async () => {
    const blocks = [
      makeBlock({ id: "blk-1", commandText: "first", output: "FIRST-OUTPUT\n" }),
      makeBlock({ id: "blk-2", commandText: "second", output: "SECOND-OUTPUT\n" }),
    ];
    const { stdin, lastFrame } = render(<TerminalBlocksView blocks={blocks} />);
    // Move up to "first".
    stdin.write("k");
    await tick();
    // Expand it (return).
    stdin.write("\r");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("FIRST-OUTPUT");
  });

  it("'e' key expands all, 'c' key collapses all", async () => {
    const blocks = [
      makeBlock({ id: "blk-1", commandText: "a", output: "AAA-OUT\n" }),
      makeBlock({ id: "blk-2", commandText: "b", output: "BBB-OUT\n" }),
      makeBlock({ id: "blk-3", commandText: "c_cmd", output: "CCC-OUT\n" }),
    ];
    const { stdin, lastFrame } = render(<TerminalBlocksView blocks={blocks} />);
    stdin.write("e");
    await tick();
    const expandedFrame = lastFrame() ?? "";
    expect(expandedFrame).toContain("AAA-OUT");
    expect(expandedFrame).toContain("BBB-OUT");
    expect(expandedFrame).toContain("CCC-OUT");

    stdin.write("c");
    await tick();
    const collapsedFrame = lastFrame() ?? "";
    expect(collapsedFrame).not.toContain("AAA-OUT");
    expect(collapsedFrame).not.toContain("BBB-OUT");
    expect(collapsedFrame).not.toContain("CCC-OUT");
  });
});
