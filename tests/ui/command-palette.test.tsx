import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { CommandPalette } from "../../src/ui/components/CommandPalette.js";
import { CommandRegistry, type Command } from "../../src/ui/command-registry.js";

// ink-testing-library state updates from stdin.write are async.
const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeCmd(partial: Partial<Command> & { id: string }): Command {
  return {
    id: partial.id,
    label: partial.label ?? partial.id,
    description: partial.description,
    keywords: partial.keywords,
    handler: partial.handler ?? ((): void => {}),
  };
}

describe("CommandPalette", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it("renders header, prompt, and all registered commands on open", () => {
    registry.register(makeCmd({ id: "a", label: "Alpha Action" }));
    registry.register(makeCmd({ id: "b", label: "Beta Action" }));

    const { lastFrame } = render(
      <CommandPalette registry={registry} onClose={() => {}} />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Command Palette");
    expect(frame).toContain("Alpha Action");
    expect(frame).toContain("Beta Action");
  });

  it("shows empty-state message when no commands match", async () => {
    registry.register(makeCmd({ id: "a", label: "Alpha" }));

    const { stdin, lastFrame } = render(
      <CommandPalette registry={registry} onClose={() => {}} />,
    );
    // Type a query that doesn't match.
    stdin.write("zzzz");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("No matching commands");
  });

  it("filters the list as the user types", async () => {
    registry.register(makeCmd({ id: "git", label: "Git Status" }));
    registry.register(makeCmd({ id: "chat", label: "New Conversation" }));

    const { stdin, lastFrame } = render(
      <CommandPalette registry={registry} onClose={() => {}} />,
    );
    stdin.write("git");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Git Status");
    expect(frame).not.toContain("New Conversation");
  });

  it("Enter executes the selected command and closes the palette", async () => {
    const handler = vi.fn();
    registry.register(makeCmd({ id: "fire", label: "Fire", handler }));

    const onClose = vi.fn();
    const { stdin } = render(
      <CommandPalette registry={registry} onClose={onClose} />,
    );
    stdin.write("\r"); // Enter
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    // Give microtasks a moment to flush execute().
    await tick();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("Esc closes without executing anything", async () => {
    const handler = vi.fn();
    registry.register(makeCmd({ id: "fire", label: "Fire", handler }));

    const onClose = vi.fn();
    const { stdin } = render(
      <CommandPalette registry={registry} onClose={onClose} />,
    );
    stdin.write("\u001B"); // Escape
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("Arrow down changes the selected command", async () => {
    let firedId = "";
    registry.register(
      makeCmd({
        id: "first",
        label: "First",
        handler: () => {
          firedId = "first";
        },
      }),
    );
    registry.register(
      makeCmd({
        id: "second",
        label: "Second",
        handler: () => {
          firedId = "second";
        },
      }),
    );

    const { stdin } = render(
      <CommandPalette registry={registry} onClose={() => {}} />,
    );
    stdin.write("\u001B[B"); // Down arrow
    await tick();
    stdin.write("\r"); // Enter
    await tick(20);
    expect(firedId).toBe("second");
  });

  it("Arrow up moves selection back toward the top", async () => {
    let firedId = "";
    registry.register(
      makeCmd({ id: "a", label: "A", handler: () => (firedId = "a") }),
    );
    registry.register(
      makeCmd({ id: "b", label: "B", handler: () => (firedId = "b") }),
    );

    const { stdin } = render(
      <CommandPalette registry={registry} onClose={() => {}} />,
    );
    // Down twice (past the end, clamps), then up once — selects index 0.
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\u001B[A"); // Up arrow
    await tick();
    stdin.write("\r");
    await tick(20);
    expect(firedId).toBe("a");
  });

  it("handler errors surface via onError, palette still closes", async () => {
    registry.register(
      makeCmd({
        id: "boom",
        label: "Boom",
        handler: () => {
          throw new Error("handler exploded");
        },
      }),
    );

    const onClose = vi.fn();
    const onError = vi.fn();
    const { stdin } = render(
      <CommandPalette registry={registry} onClose={onClose} onError={onError} />,
    );
    stdin.write("\r");
    // Palette should close immediately.
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    // Error surfaces asynchronously after execute() rejects.
    await tick(30);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toContain("handler exploded");
  });

  it("backspace shrinks the query", async () => {
    registry.register(makeCmd({ id: "git", label: "Git Status" }));
    registry.register(makeCmd({ id: "chat", label: "New Conversation" }));

    const { stdin, lastFrame } = render(
      <CommandPalette registry={registry} onClose={() => {}} />,
    );
    stdin.write("git");
    await tick();
    expect(lastFrame() ?? "").not.toContain("New Conversation");

    // Backspace x3 should restore all matches.
    stdin.write("\u0008");
    stdin.write("\u0008");
    stdin.write("\u0008");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Git Status");
    expect(frame).toContain("New Conversation");
  });

  it("Enter with no results is a no-op (closes without error)", async () => {
    registry.register(makeCmd({ id: "a", label: "Alpha" }));

    const onClose = vi.fn();
    const onError = vi.fn();
    const { stdin } = render(
      <CommandPalette registry={registry} onClose={onClose} onError={onError} />,
    );
    stdin.write("zzzz");
    await tick();
    stdin.write("\r");
    await tick(20);
    // Per the component contract, Enter on empty results is a no-op —
    // it does NOT call onClose and does NOT call onError.
    expect(onClose).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
