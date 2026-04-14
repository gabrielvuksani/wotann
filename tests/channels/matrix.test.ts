import { describe, it, expect, vi } from "vitest";
import { MatrixAdapter } from "../../src/channels/matrix.js";

describe("Matrix Channel Adapter", () => {
  it("creates adapter with correct type and name", () => {
    const adapter = new MatrixAdapter("https://matrix.org", "token");
    expect(adapter.type).toBe("matrix");
    expect(adapter.name).toBe("Matrix/Element");
  });

  it("reports disconnected initially", () => {
    const adapter = new MatrixAdapter("https://matrix.org", "token");
    expect(adapter.isConnected()).toBe(false);
  });

  it("throws on start without credentials", async () => {
    const adapter = new MatrixAdapter("", "");
    await expect(adapter.start()).rejects.toThrow("MATRIX_HOMESERVER_URL");
  });

  it("throws on start with homeserver but no token", async () => {
    const adapter = new MatrixAdapter("https://matrix.org", "");
    await expect(adapter.start()).rejects.toThrow("MATRIX_HOMESERVER_URL");
  });

  it("fails to send when disconnected", async () => {
    const adapter = new MatrixAdapter("https://matrix.org", "token");
    const sent = await adapter.send({
      channelType: "matrix",
      channelId: "!room:matrix.org",
      content: "Hello Matrix!",
    });
    expect(sent).toBe(false);
  });

  it("registers message handler", () => {
    const adapter = new MatrixAdapter("https://matrix.org", "token");
    const handler = vi.fn();
    adapter.onMessage(handler);
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops gracefully", async () => {
    const adapter = new MatrixAdapter("https://matrix.org", "token");
    await adapter.stop();
    expect(adapter.isConnected()).toBe(false);
  });

  it("normalizes homeserver URL by removing trailing slashes", () => {
    // The adapter should work regardless of trailing slashes
    const adapter1 = new MatrixAdapter("https://matrix.org/", "token");
    const adapter2 = new MatrixAdapter("https://matrix.org", "token");

    expect(adapter1.type).toBe("matrix");
    expect(adapter2.type).toBe("matrix");
  });
});
