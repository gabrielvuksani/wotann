/**
 * PROVIDER-AGNOSTIC TEST — exercises PluginLifecycle hook ordering and
 * payload mutation. Provider/model in mockContext are unused by the
 * lifecycle dispatch logic. Wave DH-3: tier helper.
 */
import { describe, it, expect } from "vitest";
import { PluginLifecycle, PromptQueue } from "../../src/plugins/lifecycle.js";
import type { LifecycleContext, PreLLMCallPayload } from "../../src/plugins/lifecycle.js";
import { getTierModel } from "../_helpers/model-tier.js";

const _tier = getTierModel("strong");

const mockContext: LifecycleContext = {
  sessionId: "test-session",
  provider: _tier.provider,
  model: _tier.model,
  mode: "code",
  timestamp: Date.now(),
};

describe("PluginLifecycle", () => {
  it("registers and fires hooks", async () => {
    const lifecycle = new PluginLifecycle();
    let called = false;

    lifecycle.register("on_session_start", async () => {
      called = true;
    });

    await lifecycle.fire("on_session_start", {}, mockContext);
    expect(called).toBe(true);
  });

  it("fires hooks in priority order", async () => {
    const lifecycle = new PluginLifecycle();
    const order: number[] = [];

    lifecycle.register("post_llm_call", async () => { order.push(3); }, { priority: 300 });
    lifecycle.register("post_llm_call", async () => { order.push(1); }, { priority: 100 });
    lifecycle.register("post_llm_call", async () => { order.push(2); }, { priority: 200 });

    await lifecycle.fire("post_llm_call", {}, mockContext);
    expect(order).toEqual([1, 2, 3]);
  });

  it("pre_llm_call hooks can modify payload", async () => {
    const lifecycle = new PluginLifecycle();

    lifecycle.register("pre_llm_call", async (_event, payload) => {
      const p = payload as PreLLMCallPayload;
      return { ...p, prompt: p.prompt + " [injected]" };
    });

    const result = await lifecycle.fire("pre_llm_call", { prompt: "Hello" } as PreLLMCallPayload, mockContext);
    expect((result as PreLLMCallPayload).prompt).toContain("[injected]");
  });

  it("chains multiple pre_llm_call hooks", async () => {
    const lifecycle = new PluginLifecycle();

    lifecycle.register("pre_llm_call", async (_e, p) => {
      const payload = p as PreLLMCallPayload;
      return { ...payload, prompt: payload.prompt + " A" };
    }, { priority: 10 });

    lifecycle.register("pre_llm_call", async (_e, p) => {
      const payload = p as PreLLMCallPayload;
      return { ...payload, prompt: payload.prompt + " B" };
    }, { priority: 20 });

    const result = await lifecycle.fire("pre_llm_call", { prompt: "Start" } as PreLLMCallPayload, mockContext);
    expect((result as PreLLMCallPayload).prompt).toBe("Start A B");
  });

  it("unregisters hooks by ID", async () => {
    const lifecycle = new PluginLifecycle();
    let callCount = 0;

    const hookId = lifecycle.register("on_tool_call", async () => { callCount++; });
    await lifecycle.fire("on_tool_call", {}, mockContext);
    expect(callCount).toBe(1);

    const removed = lifecycle.unregister(hookId);
    expect(removed).toBe(true);

    await lifecycle.fire("on_tool_call", {}, mockContext);
    expect(callCount).toBe(1); // Not called again
  });

  it("catches hook errors and fires on_error", async () => {
    const lifecycle = new PluginLifecycle();
    let errorCaught = false;

    lifecycle.register("post_llm_call", async () => {
      throw new Error("Hook failed!");
    });

    lifecycle.register("on_error", async () => {
      errorCaught = true;
    });

    // Should not throw
    await lifecycle.fire("post_llm_call", {}, mockContext);
    expect(errorCaught).toBe(true);
  });

  it("reports hook stats", () => {
    const lifecycle = new PluginLifecycle();
    lifecycle.register("pre_llm_call", async () => {});
    lifecycle.register("pre_llm_call", async () => {});
    lifecycle.register("on_error", async () => {});

    const stats = lifecycle.getStats();
    expect(stats.pre_llm_call).toBe(2);
    expect(stats.on_error).toBe(1);
    expect(stats.post_llm_call).toBe(0);
  });

  it("clears all hooks", () => {
    const lifecycle = new PluginLifecycle();
    lifecycle.register("pre_llm_call", async () => {});
    lifecycle.register("on_error", async () => {});

    lifecycle.clear();
    const stats = lifecycle.getStats();
    expect(stats.pre_llm_call).toBe(0);
    expect(stats.on_error).toBe(0);
  });
});

describe("PromptQueue", () => {
  it("enqueues and dequeues prompts", () => {
    const queue = new PromptQueue();
    queue.enqueue("Task A");
    queue.enqueue("Task B");

    const first = queue.dequeue();
    expect(first).not.toBeNull();
    expect(first!.prompt).toBe("Task A");

    const second = queue.dequeue();
    expect(second!.prompt).toBe("Task B");
  });

  it("respects priority ordering", () => {
    const queue = new PromptQueue();
    queue.enqueue("Low priority", 1);
    queue.enqueue("High priority", 10);
    queue.enqueue("Medium priority", 5);

    expect(queue.dequeue()!.prompt).toBe("High priority");
    expect(queue.dequeue()!.prompt).toBe("Medium priority");
    expect(queue.dequeue()!.prompt).toBe("Low priority");
  });

  it("peeks without removing", () => {
    const queue = new PromptQueue();
    queue.enqueue("Task A");

    expect(queue.peek()!.prompt).toBe("Task A");
    expect(queue.size()).toBe(1); // Still there
  });

  it("removes by ID", () => {
    const queue = new PromptQueue();
    const entry = queue.enqueue("Cancel me");
    expect(queue.size()).toBe(1);

    const removed = queue.remove(entry.id);
    expect(removed).toBe(true);
    expect(queue.size()).toBe(0);
  });

  it("clears the queue", () => {
    const queue = new PromptQueue();
    queue.enqueue("A");
    queue.enqueue("B");
    queue.enqueue("C");

    queue.clear();
    expect(queue.size()).toBe(0);
    expect(queue.dequeue()).toBeNull();
  });

  it("returns null for empty queue", () => {
    const queue = new PromptQueue();
    expect(queue.dequeue()).toBeNull();
    expect(queue.peek()).toBeNull();
  });

  it("supports metadata", () => {
    const queue = new PromptQueue();
    const entry = queue.enqueue("Task", 0, { source: "cli", mode: "code" });
    expect(entry.metadata).toEqual({ source: "cli", mode: "code" });
  });
});
