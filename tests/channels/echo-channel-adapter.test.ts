/**
 * EchoChannelAdapter test — locks in the BaseChannelAdapter pattern.
 *
 * Closes docs/FINAL_VERIFICATION_AUDIT_2026-04-19.md's
 * "BaseChannelAdapter has 0 subclasses" finding by exercising a real
 * subclass through its full lifecycle (connect → simulate inbound →
 * handler echoes → outbound recorded → disconnect).
 */

import { describe, it, expect } from "vitest";
import { EchoChannelAdapter } from "../../src/channels/echo-channel-adapter.js";

describe("EchoChannelAdapter — BaseChannelAdapter subclass", () => {
  it("connect + disconnect drives the state machine", async () => {
    const adapter = new EchoChannelAdapter("test-echo");
    expect(adapter.getState()).toBe("disconnected");

    const ok = await adapter.connect();
    expect(ok).toBe(true);
    expect(adapter.getState()).toBe("connected");

    await adapter.disconnect();
    expect(adapter.getState()).toBe("disconnected");
  });

  it("simulateInbound routes through the handler pipeline and echoes outbound", async () => {
    const adapter = new EchoChannelAdapter("test-roundtrip");
    adapter.setMessageHandler(async (msg) => `echo: ${msg.content}`);

    await adapter.connect();
    await adapter.simulateInbound("hello", "alice");

    const snap = adapter.getSnapshot();
    expect(snap.inbound.length).toBe(1);
    expect(snap.inbound[0]?.content).toBe("hello");
    expect(snap.outbound.length).toBe(1);
    expect(snap.outbound[0]?.content).toBe("echo: hello");
    expect(snap.outbound[0]?.recipientId).toBe("alice");

    await adapter.disconnect();
  });

  it("clearLogs resets both inbound and outbound traffic", async () => {
    const adapter = new EchoChannelAdapter();
    adapter.setMessageHandler(async (m) => m.content.toUpperCase());
    await adapter.connect();

    await adapter.simulateInbound("x");
    await adapter.simulateInbound("y");
    expect(adapter.getSnapshot().inbound.length).toBe(2);
    expect(adapter.getSnapshot().outbound.length).toBe(2);

    adapter.clearLogs();
    expect(adapter.getSnapshot().inbound.length).toBe(0);
    expect(adapter.getSnapshot().outbound.length).toBe(0);
  });

  it("getInfo reports name, type, state, retries", async () => {
    const adapter = new EchoChannelAdapter("named-channel");
    const info = adapter.getInfo();
    expect(info.name).toBe("named-channel");
    expect(info.type).toBe("echo");
    expect(info.state).toBe("disconnected");
    expect(info.retries).toBe(0);
  });
});
